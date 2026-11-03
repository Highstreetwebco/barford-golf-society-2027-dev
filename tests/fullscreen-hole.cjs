const { chromium } = require('playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { mocks, fixture, server, base, backend } = require('./baseline.cjs');
const { installMap } = require('./fixtures/hole-browser.cjs');
const out = path.join(__dirname, '..', 'test-results');
const layout = { name: 'Test course', tee_name: 'Yellow', source: { attribution: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' }, holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, yards: 380, stroke_index: i + 1, reviewed: true, tee: { lat: 52.0001 + i * .0001, lng: -1.5 }, green: { lat: 52.0031 + i * .0001, lng: -1.5 } })) };

(async () => {
  await new Promise(resolve => server.listen(8765, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  try {
    for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1365, height: 900 }]) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block', locale: 'en-GB' });
      const model = await mocks(context, { signedIn: true });
      model.events = [{ ...fixture, event_type: 'league', round_number: 1 }];
      await context.addInitScript(() => sessionStorage.setItem('barford-2027-preview-session', 'a'.repeat(64)));
      await context.route(backend + '/rest/v1/rpc/baseline_site_gate', route => route.fulfill({ json: { live: false, preview: true } }));
      await context.route(backend + '/rest/v1/rpc/baseline_course_layout', route => route.fulfill({ json: { layout } }));
      await installMap(context, { automatic: false });
      const page = await context.newPage(), errors = [];
      page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));
      await page.goto(base + 'event.html?id=999'); await page.locator('[data-hole-view]').click();
      await page.locator('[data-hole="1"]').waitFor(); assert.equal(await page.evaluate(() => gpsWatches), 0);
      await page.locator('[data-hole="1"]').click(); await page.waitForFunction(() => window.__maps.instances.length === 1);
      const dialog = page.locator('.hole-dialog'), map = page.locator('[data-hole-map]');
      assert.equal(await page.evaluate(() => gpsWatches), 1, 'Opening a hole automatically requests GPS once');
      assert.equal(await page.locator('[data-distances]').isVisible(), false, 'No made-up tee distance while GPS is pending');
      const box = await dialog.boundingBox(), mapBox = await map.boundingBox();
      assert.ok(box.x <= 1 && box.y <= 1 && box.width >= viewport.width - 1 && box.height >= viewport.height - 1);
      assert.ok(mapBox.height >= viewport.height * (viewport.height > 500 ? .74 : .61), JSON.stringify({ viewport, mapBox }));
      assert.ok(await dialog.evaluate(el => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1), 'The playing view must not scroll');
      for (const selector of ['[data-hole-next]', '[data-hole-prev]', '[data-hole-fit]', '[data-hole-grid-back]', '[data-hole-close]']) {
        const button = await page.locator(selector).boundingBox(); assert.ok(button.y >= 0 && button.y + button.height <= viewport.height + 1 && button.height >= 44);
      }
      assert.equal(await page.evaluate(() => window.__maps.instances[0].settings.cameraControl), false);
      assert.equal(await page.locator('.hole-stats,.hole-mode-choices,.hole-help').count(), 0);

      // At home, the map remains on its hole and no home-to-green yardage appears.
      const overview = await page.evaluate(() => window.__maps.instances[0].settings.center);
      await page.evaluate(() => emitGps({ latitude: 51.5, longitude: -.12, accuracy: 6 }));
      await page.locator('.hole-dialog[data-gps-state="away"]').waitFor();
      assert.equal(await page.locator('[data-distances]').isVisible(), false);
      assert.equal(await page.locator('.hole-map-pin-player').count(), 0);
      assert.deepEqual(await page.evaluate(() => window.__maps.instances[0].settings.center), overview);
      await dialog.screenshot({ path: path.join(out, `hole-overview-${viewport.width}x${viewport.height}.png`) });

      // Nearby movement drives the live green-centre distance.
      await page.evaluate(() => emitGps({ latitude: 52.001, longitude: -1.5, accuracy: 6 }));
      await page.locator('.hole-dialog[data-gps-state="live"]').waitFor();
      const before = Number(await page.locator('[data-distance="green"]').innerText());
      assert.ok(before > 200 && before < 300); assert.equal(await page.locator('.hole-map-pin-player').count(), 1);
      await page.evaluate(() => emitGps({ latitude: 52.002, longitude: -1.5, accuracy: 4 }));
      assert.ok(Number(await page.locator('[data-distance="green"]').innerText()) < before);
      assert.match(await page.locator('[data-gps-status]').innerText(), /GPS ±5 yd/);
      await dialog.screenshot({ path: path.join(out, `hole-live-${viewport.width}x${viewport.height}.png`) });
      await page.evaluate(() => google.maps.event.trigger(window.__maps.instances[0], 'click', { latLng: new google.maps.LatLng(52.0025, -1.5) }));
      const target = page.locator('[data-target-distances]'); await target.waitFor();
      const targetBox = await target.boundingBox();
      assert.ok(targetBox.x + targetBox.width <= viewport.width - 64, 'Tapped-target details must leave the map zoom controls clear');
      await page.locator('[data-clear-target]').click(); assert.equal(await target.isVisible(), false);
      await page.locator('[data-hole-next]').click(); assert.equal(await page.locator('[data-hole-title]').innerText(), 'Hole 2');
      assert.equal(await page.evaluate(() => gpsWatches), 1);

      for (const [accuracy, age, expected] of [[80, 0, 'inaccurate'], [5, 16000, 'stale'], [5, -10000, 'invalid']]) {
        await page.evaluate(({ accuracy, age }) => emitGps({ latitude: 52.002, longitude: -1.5, accuracy }, Date.now() - age), { accuracy, age });
        await page.locator(`.hole-dialog[data-gps-state="${expected}"]`).waitFor();
        assert.equal(await page.locator('[data-distances]').isVisible(), false);
        assert.equal(await page.locator('.hole-map-pin-player').count(), 0);
      }
      await page.evaluate(() => emitGpsError(1));
      await page.locator('[data-gps-status]').filter({ hasText: 'GPS blocked' }).waitFor();
      assert.equal(await page.evaluate(() => window.__gps.active.size), 0);
      await page.locator('[data-gps-toggle]').click(); assert.equal(await page.evaluate(() => gpsWatches), 2);
      await page.evaluate(() => emitGps({ latitude: 52.002, longitude: -1.5, accuracy: 5 }));
      await page.locator('[data-hole-grid-back]').click(); assert.equal(await page.evaluate(() => window.__gps.active.size), 0);
      await page.locator('[data-hole="1"]').click(); assert.equal(await page.evaluate(() => gpsWatches), 3);
      await page.evaluate(() => emitGps({ latitude: 52.001, longitude: -1.5, accuracy: 5 }));

      // A reading also expires when the device stops delivering updates.
      await page.evaluate(() => { window.realNow = Date.now; const future = Date.now() + 16000; Date.now = () => future; });
      await page.locator('.hole-dialog[data-gps-state="stale"]').waitFor();
      await page.evaluate(() => { Date.now = window.realNow; });
      assert.equal(await page.locator('[data-distances]').isVisible(), false);
      await page.evaluate(() => { window.testHidden = true; Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.testHidden }); document.dispatchEvent(new Event('visibilitychange')); });
      assert.equal(await page.evaluate(() => window.__gps.active.size), 0);
      await page.evaluate(() => { window.testHidden = false; document.dispatchEvent(new Event('visibilitychange')); });
      assert.equal(await page.evaluate(() => window.__gps.active.size), 1);
      await page.evaluate(() => emitGps({ latitude: 52.001, longitude: -1.5, accuracy: 5 }));
      await page.locator('[data-gps-toggle]').click();
      assert.equal(await page.evaluate(() => window.__gps.active.size), 0);
      await page.locator('[data-hole-next]').click();
      assert.equal(await page.evaluate(() => window.__gps.active.size), 0, 'A manual GPS pause survives switching holes');
      await page.locator('[data-gps-toggle]').click();
      await page.locator('[data-hole-close]').click(); await dialog.waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => window.__gps.active.size), 0);
      await page.evaluate(() => window.__gps.history[0].ok({ coords: { latitude: 52.001, longitude: -1.5, accuracy: 5 }, timestamp: Date.now() }));
      assert.equal(await page.locator('.hole-dialog').count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('has-hole-dialog')), false);
      assert.deepEqual(errors, []);
      for (const request of model.payloads) assert.doesNotMatch(JSON.stringify(request), /latitude|longitude|coords/, 'GPS must stay out of app writes');
      console.log(`PASS ${viewport.width}x${viewport.height}: fullscreen map, nearby/away GPS, movement, poor/stale fixes, permission retry, hole switching and cleanup`);
      await context.close();
    }
  } finally {
    for (const context of browser.contexts()) for (const page of context.pages()) await page.screenshot({ path: path.join(out, 'fullscreen-hole-failure.png'), fullPage: true }).catch(() => {});
    await browser.close(); server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
