// Real Kenilworth source geometry; synthetic accounts and API writes only.
const { chromium } = require('playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { mocks, fixture, server, base, backend } = require('./baseline.cjs');
const out = path.join(__dirname, '..', 'test-results');

(async () => {
  const { buildCourseMapping } = await import('../supabase/functions/baseline-services/course-mapping.ts');
  const { prepareCourseGps } = await import('../supabase/functions/baseline-services/course-preparation.ts');
  const k = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/kenilworth-course-source.json')));
  const prepared = await prepareCourseGps(k.course, { cards: [k.scorecard], warnings: [] }, {}, async (course, options) => buildCourseMapping(course, k.elements, options.scorecard));
  assert.equal(prepared.status, 'ready');
  await new Promise(resolve => server.listen(8765, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1365]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block', locale: 'en-GB' });
      const model = await mocks(context, { signedIn: true, admin: true });
      model.profile.is_admin = true;
      model.events = [{ ...fixture, name: 'Round 2 – Kenilworth Golf Club', event_type: 'league', round_number: 2, place_id: k.course.place_id, course_name: k.course.name, address: k.course.address, latitude: k.course.latitude, longitude: k.course.longitude, course_layout_id: null, member_price: 40, guest_price: 50 }];
      await context.addInitScript(() => sessionStorage.setItem('barford-2027-preview-session', 'a'.repeat(64)));
      await context.route(backend + '/rest/v1/rpc/baseline_site_gate', route => route.fulfill({ json: { live: false, preview: true } }));
      let lookups = 0, writes = 0, saved;
      await context.route(backend + '/functions/v1/baseline-services', route => {
        if (route.request().postDataJSON().action !== 'prepare_course') return route.fallback();
        lookups++; return route.fulfill({ json: prepared });
      });
      await context.route(backend + '/rest/v1/rpc/baseline_course_layout', route => {
        const { action, payload } = route.request().postDataJSON();
        if (action === 'save') { writes++; saved = { ...payload, id: '33333333-3333-4333-8333-333333333333', revision: 1, ready_count: 18 }; }
        return route.fulfill({ json: action === 'event' ? { layout: saved } : saved });
      });
      let failEventSave = true;
      await context.route(backend + '/rest/v1/baseline_events*', route => route.request().method() === 'PATCH' && failEventSave
        ? route.fulfill({ status: 503, json: { message: 'Temporary event save failure' } }) : route.fallback());
      const page = await context.newPage(), errors = [];
      page.setDefaultTimeout(12000); page.on('pageerror', e => errors.push(e.message));
      await page.goto(base + 'admin.html?event=999');
      await page.locator('[data-course-preparation]').filter({ hasText: 'All 18 hole maps are ready' }).waitFor();
      assert.equal(lookups, 1); assert.equal(writes, 0);
      assert.match(await page.locator('[data-map-source]').innerText(), /Hole 9 uses the selected scorecard’s par 4/);
      await page.locator('[data-preview-layout]').click();
      const preview = page.getByRole('dialog', { name: 'Course map preview', exact: true });
      assert.equal(await preview.locator('[data-hole]:enabled').count(), 18);
      await preview.locator('[data-hole-close]').click(); await preview.waitFor({ state: 'detached' });
      await page.locator('#saveEvent').click();
      await page.locator('.form-status').filter({ hasText: 'Temporary event save failure' }).waitFor();
      assert.equal(writes, 1); assert.equal(model.events[0].course_layout_id, null);
      failEventSave = false;
      await page.locator('#saveEvent').click();
      await page.locator('[data-layout-status]').filter({ hasText: 'Saved with this event' }).waitFor();
      assert.equal(writes, 1, 'An event-write retry must reuse the saved hole map');
      assert.equal(model.events[0].course_layout_id, saved.id);
      assert.equal(saved.holes[8].par, 4); assert.ok(saved.holes.every(h => h.reviewed && h.tee && h.green));
      await page.reload();
      await page.locator('[data-layout-status]').filter({ hasText: 'Saved with this event' }).waitFor();
      assert.equal(lookups, 1, 'Reloading the event must not repeat provider discovery');
      await page.locator('.hole-setup').screenshot({ path: path.join(out, `kenilworth-gps-saved-${width}.png`) });
      await page.goto(base + 'event.html?id=999'); await page.locator('[data-hole-view]').click();
      await page.locator('[data-hole-grid]').waitFor();
      assert.equal(await page.locator('[data-hole]:enabled').count(), 18);
      assert.equal(await page.locator('[data-find-green]').count(), 0);
      await page.getByRole('dialog').screenshot({ path: path.join(out, `kenilworth-hole-picker-${width}.png`) });
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px: Kenilworth preparation, save retry, reload without lookup, and 18 member hole maps`);
      await context.close();
    }
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
