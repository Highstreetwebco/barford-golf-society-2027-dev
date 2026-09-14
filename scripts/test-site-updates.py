"""Real-browser cache migration, gateway, and live deployment checks.
Run: python scripts/test-site-updates.py [--live https://.../]
No accounts are created and no production data is written.
"""
import argparse
import functools
import http.server
import json
import os
from pathlib import Path
import shutil
import tempfile
import threading
import time
from urllib.request import Request, urlopen
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'test-results' / 'site-updates'
OUT.mkdir(parents=True, exist_ok=True)
REPORT = []
OLD_HTML = '''<!doctype html><html><head><title>Previous Barford homepage</title></head><body><h1>Great golf. Better company.</h1><p>Previous release</p><script>navigator.serviceWorker.register('./sw.js?v=78',{updateViaCache:'none'});</script></body></html>'''
# Deliberately reproduces the shipped v80 bug: cached HTML wins and queries vanish.
OLD_WORKER = '''const CACHE='barford-golf-2027-offline-v80-regression';
const root=new URL('./',self.location.href);
self.addEventListener('install',e=>e.waitUntil((async()=>{const c=await caches.open(CACHE);await c.add(new URL('index.html',root));await self.skipWaiting();})()));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.origin!==root.origin||!u.pathname.startsWith(root.pathname)||!['index.html',''].includes(u.pathname.slice(root.pathname.length)))return;e.respondWith(caches.open(CACHE).then(c=>c.match(new URL('index.html',root))));});'''


def record(name, **details):
    REPORT.append({'test': name, 'passed': True, **details})
    print('PASS:', name, flush=True)


def browser(pw):
    executable = os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium')
    return pw.chromium.launch(**({'executable_path': executable} if executable else {}), args=['--no-sandbox'])


def gateway(page):
    expect(page.locator('#visitorGateway')).to_be_visible(timeout=20000)
    expect(page.get_by_role('link', name='Create a Barford members account', exact=True)).to_be_visible()
    expect(page.get_by_role('link', name='Continue as a guest', exact=True)).to_be_visible()
    expect(page.get_by_role('link', name='Already have an account? Sign in', exact=True)).to_be_visible()
    assert page.locator('#visitorGateway .visitor-gateway-actions a').count() == 2
    assert not page.get_by_text('Great golf.', exact=True).count()
    assert page.locator('.mobile-quick-nav:visible,.desktop-primary:visible,.site-nav:visible').count() == 0
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')


def seed_scores(page):
    page.evaluate('''async()=>{
      localStorage.setItem('barford-update-test-session','keep-session');
      const db=await new Promise((ok,no)=>{const r=indexedDB.open('barford-update-test',1);r.onupgradeneeded=()=>r.result.createObjectStore('pending');r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});
      await new Promise((ok,no)=>{const t=db.transaction('pending','readwrite');t.objectStore('pending').put({hole:7,strokes:5},'score');t.oncomplete=ok;t.onerror=()=>no(t.error);});db.close();
    }''')


def saved_scores(page):
    assert page.evaluate("localStorage.getItem('barford-update-test-session')") == 'keep-session'
    data = page.evaluate('''async()=>{const db=await new Promise(ok=>{const r=indexedDB.open('barford-update-test',1);r.onsuccess=()=>ok(r.result);});return await new Promise(ok=>{const r=db.transaction('pending').objectStore('pending').get('score');r.onsuccess=()=>{db.close();ok(r.result);};});}''')
    assert data == {'hole': 7, 'strokes': 5}


def local_tests(pw):
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        shutil.copytree(ROOT, root / 'golf', ignore=shutil.ignore_patterns('test-results', 'node_modules', '.git'))
        state = {'legacy': True}

        class Handler(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                path = self.path.split('?')[0]
                if state['legacy'] and path in ['/golf/index.html', '/golf/', '/golf/sw.js']:
                    text = OLD_WORKER if path.endswith('sw.js') else OLD_HTML
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/javascript' if path.endswith('.js') else 'text/html')
                    self.send_header('Cache-Control', 'no-store')
                    self.end_headers()
                    self.wfile.write(text.encode())
                else:
                    super().do_GET()

        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=tmp))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f'http://127.0.0.1:{server.server_port}/golf/'
        b = browser(pw)
        context = b.new_context(viewport={'width': 390, 'height': 844})
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda err: errors.append(str(err)))
        page.goto(base + 'index.html')
        page.wait_for_function('Boolean(navigator.serviceWorker.controller)')
        seed_scores(page)
        state['legacy'] = False
        # No network deployment problem is needed to reproduce the original fault.
        page.goto(base + 'index.html?v=fresh-but-still-stale')
        expect(page.get_by_role('heading', name='Great golf. Better company.')).to_be_visible()
        record('Legacy cache-first worker reproduces stale HTML despite a query string')
        page.goto(base + 'update.html')
        page.wait_for_url(base + 'index.html', timeout=65000)
        gateway(page)
        saved_scores(page)
        assert not errors, errors
        page.screenshot(path=str(OUT / 'local-upgrade-mobile.png'), full_page=True)
        record('Recovery upgrades an old worker and displays the new gateway without clearing saved data')
        page.reload()
        gateway(page)
        record('Normal reload stays on the latest homepage after recovery')
        current = root / 'golf/index.html'
        current.write_text(current.read_text().replace('Welcome to Barford', 'Welcome to Barford NEXT RELEASE'))
        page.reload()
        expect(page.get_by_role('heading', name='Welcome to Barford NEXT RELEASE')).to_be_visible()
        record('A later HTML edit is served on reload even when the worker version is unchanged')
        context.set_offline(True)
        page.reload()
        expect(page.get_by_role('heading', name='Welcome to Barford NEXT RELEASE')).to_be_visible()
        saved_scores(page)
        response = page.goto(base + 'scoring.html?event=cache-test&card=offline-test')
        assert response.status == 200
        assert 'scoring' in (response.text().lower())
        saved_scores(page)
        record('Offline shell fallback and saved score data survive the update')
        context.set_offline(False)
        context.close()
        b.close()
        server.shutdown()


def live_tests(pw, base):
    base = base.rstrip('/') + '/'
    expected = (ROOT / 'index.html').read_bytes()
    deadline = time.monotonic() + 600
    last_error = 'Waiting for deployment'
    while time.monotonic() < deadline:
        try:
            # This is the actual public site, not raw GitHub or a local substitute.
            with urlopen(Request(base + 'index.html', headers={'Cache-Control': 'no-cache'}), timeout=20) as r:
                html = r.read()
            with urlopen(Request(base + 'sw.js', headers={'Cache-Control': 'no-cache'}), timeout=20) as r:
                worker = r.read().decode()
            if html == expected and "const POLICY='network-first-v1'" in worker:
                break
            last_error = 'Public HTML or worker does not yet match this commit'
        except Exception as err:
            last_error = str(err)
        time.sleep(10)
    else:
        raise AssertionError(last_error)
    record('Live public HTML matches the checked-out commit byte for byte', url=base + 'index.html')
    b = browser(pw)
    for width, height, name in [(1440, 1000, 'desktop'), (390, 844, 'mobile')]:
        context = b.new_context(viewport={'width': width, 'height': height})
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda err: errors.append(str(err)))
        response = page.goto(base + 'index.html', wait_until='networkidle')
        assert response.status == 200
        gateway(page)
        page.wait_for_function('Boolean(navigator.serviceWorker.controller)', timeout=45000)
        assert not errors, errors
        page.screenshot(path=str(OUT / f'live-{name}.png'), full_page=True)
        record(f'Live {name}: two gateway buttons, login link, readable layout and no JavaScript errors')
        # Poison only this disposable browser's own cache to test the deployed worker.
        seed_scores(page)
        page.evaluate('''async(base)=>{const keys=await caches.keys();for(const key of keys){if(key.startsWith('barford-golf-2027-offline-')){const c=await caches.open(key);await c.put(base+'index.html',new Response('<h1>STALE CACHE MUST NOT WIN</h1>',{headers:{'Content-Type':'text/html'}}));}}}''', base)
        page.reload(wait_until='networkidle')
        gateway(page)
        saved_scores(page)
        record(f'Live {name}: a stale saved homepage is replaced by the network on normal reload')
        page.goto(base + 'update.html')
        page.wait_for_url(base + 'index.html', timeout=65000)
        gateway(page)
        saved_scores(page)
        record(f'Live {name}: one-time recovery URL returns to the current homepage')
        for relative in ['signup.html', 'account.html', 'events.html?guest=1']:
            response = context.request.get(base + relative)
            assert response.ok, f'{relative}: {response.status}'
        record(f'Live {name}: all three gateway destinations return HTTP 200 (not booking/payment tests)')
        context.close()
    b.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--live')
    args = parser.parse_args()
    try:
        with sync_playwright() as pw:
            local_tests(pw)
            if args.live:
                live_tests(pw, args.live)
    except Exception as error:
        REPORT.append({'test': 'run', 'passed': False, 'error': str(error)})
        raise
    finally:
        (OUT / 'results.json').write_text(json.dumps(REPORT, indent=2))
