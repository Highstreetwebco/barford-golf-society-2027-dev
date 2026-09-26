/* The 2027 replica has one database target and its own tables and storage. */
window.barfordReady = (async () => {
  const sdk = document.createElement('script');
  sdk.src = 'assets/vendor/supabase-2.116.0.js';
  await new Promise((resolve, reject) => { sdk.onload = resolve; sdk.onerror = reject; document.head.append(sdk); });
  const url = 'https://xspzmthygrajzktydvvj.supabase.co';
  const key = 'sb_publishable_xLM39PjQf4XdTVfNHFOzAQ_i4re6w_c';
  const raw = window.supabase.createClient(url, key);
  const tables = new Set(['events', 'rsvps', 'tee_times', 'players', 'scores', 'products', 'shop_orders', 'trip_events', 'trip_votes', 'signups']);
  const client = {
    auth: raw.auth,
    from(name) {
      if (!tables.has(name)) throw new Error('Unknown 2027 table: ' + name);
      return raw.from('baseline_' + name);
    },
    rpc(name, args) { return raw.rpc('baseline_' + name, args); },
    storage: { from(name) {
      if (!['gallery-images', 'trip-videos'].includes(name)) throw new Error('Unknown 2027 bucket');
      return raw.storage.from('baseline-' + name);
    } }
  };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let dialog;
  function signIn() {
    if (dialog) return dialog.pending;
    const el = document.createElement('dialog');
    el.style.cssText = 'width:min(420px,calc(100% - 32px));margin:auto;padding:28px;border:1px solid #d4af37;border-radius:14px;background:#fff;color:#222;box-shadow:0 20px 80px #0006;font:16px Inter,Arial,sans-serif;';
    el.innerHTML = '<form><h2 style="margin-bottom:16px">2027 account</h2><p style="margin-bottom:18px">Sign in with your 2027 account.</p><label>Email<input name="email" type="email" autocomplete="username" required style="display:block;width:100%;padding:12px;margin:6px 0 14px;color:#222;background:white;border:1px solid #aaa"></label><label>Password<input name="password" type="password" autocomplete="current-password" required minlength="6" style="display:block;width:100%;padding:12px;margin:6px 0 14px;color:#222;background:white;border:1px solid #aaa"></label><p role="status" style="color:#9b2727;min-height:24px;margin-bottom:12px"></p><div style="display:flex;gap:10px;flex-wrap:wrap"><button type="submit" style="padding:12px 20px;background:#173e2e;color:white;border:0;border-radius:6px">Sign in</button><button type="button" data-cancel style="padding:12px;border:1px solid #aaa;background:white;color:#222;border-radius:6px">Cancel</button></div></form>';
    document.body.append(el);
    const pending = new Promise(resolve => {
      const close = value => { el.close(); el.remove(); dialog = null; resolve(value); };
      el.querySelector('[data-cancel]').onclick = () => close(false);
      el.addEventListener('cancel', e => { e.preventDefault(); close(false); });
      el.querySelector('form').onsubmit = async e => {
        e.preventDefault();
        const button = el.querySelector('[type="submit"]'); button.disabled = true;
        const fields = new FormData(e.target);
        const {error} = await raw.auth.signInWithPassword({email:String(fields.get('email')).trim(),password:String(fields.get('password'))});
        button.disabled = false;
        if (error) { el.querySelector('[role="status"]').textContent = error.message; return; }
        close(true);
      };
    });
    dialog = {pending}; el.showModal(); return pending;
  }
  async function requireMember() {
    const {data:{session}} = await raw.auth.getSession();
    return !!session || await signIn();
  }
  async function isAdmin() {
    const {data,error} = await raw.rpc('is_admin');
    return !error && data === true;
  }
  async function requireAdmin() {
    if (await isAdmin()) return true;
    if (!await signIn()) return false;
    if (await isAdmin()) return true;
    alert('This account does not have administrator access.');
    return false;
  }
  window.barford = {client, raw, requireAdmin, requireMember, isAdmin, escape};
  // Highlight the current page, retaining the navigation and styling from live.
  const page = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.site-nav a').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === page);
    if (a.getAttribute('href') === page) a.setAttribute('aria-current', 'page');
  });
  if ('serviceWorker' in navigator) {
    const scope = new URL('./', location.href).href;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!sessionStorage.getItem('barford-baseline-reloaded')) {
        sessionStorage.setItem('barford-baseline-reloaded', 'true');
        location.reload();
      }
    });
    navigator.serviceWorker.register('sw.js', {scope, updateViaCache:'none'}).then(r => r.update()).catch(console.warn);
  }
  return window.barford;
})();
