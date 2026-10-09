/* Browser checks use the real member page with isolated API/map/location fixtures. */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const out = path.join(root, "test-results");
const backend = "https://xspzmthygrajzktydvvj.supabase.co";
const deployedOrigin = "https://highstreetwebco.github.io/barford-golf-society-2027-dev/";
const uid = "11111111-1111-4111-8111-111111111111";
const now = "2027-06-24T23:30:00Z"; // Already 25 June in Britain.
const user = { id: uid, aud: "authenticated", role: "authenticated", email: "hole-test@example.invalid", app_metadata: { provider: "email" }, user_metadata: { full_name: "Hole Test" } };
const jwt = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"), Buffer.from(JSON.stringify({ sub: uid, exp: 4102444800, role: "authenticated" })).toString("base64url"), "test"].join(".");
const session = { access_token: jwt, refresh_token: "fixture-refresh", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user };
const eventFixture = { id: 999, name: "Warwickshire test round", date: "2027-06-25", first_time: "10:00", location: "Warwickshire", event_type: "league", round_number: 1, max_players: 24, cancelled: false, tee_times_dirty: false, course_layout_id: "22222222-2222-4222-8222-222222222222" };
const layoutFixture = {
  id: eventFixture.course_layout_id, name: "Warwickshire", tee_name: "Yellow", revision: 1, ready_count: 17,
  holes: Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, stroke_index: index + 1, yards: 365, reviewed: index !== 17, tee: index === 17 ? null : { lat: 52.0001, lng: -1.5 }, green: index === 17 ? null : { lat: 52.0031, lng: -1.5 }, front: index ? null : { lat: 52.0029, lng: -1.5 }, back: index ? null : { lat: 52.0033, lng: -1.5 }, dogleg: index ? null : { lat: 52.0016, lng: -1.5002 } })),
};
const preparedLayoutFixture = {
  name: "Warwickshire", tee_name: "Yellow", place_id: "warwickshire-course-place", latitude: 52.001, longitude: -1.5, address: "Warwickshire test address",
  source: { attribution: "© OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright", validation: { status: "verified", mapped: 18, tee_anchors: 18, green_anchors: 18 } },
  holes: Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, stroke_index: index + 1, yards: 365, reviewed: false, tee: { lat: 52.0001 + index * 0.0001, lng: -1.5 }, green: { lat: 52.0031 + index * 0.0001, lng: -1.5 }, front: null, back: null, dogleg: null })),
};
const server = http.createServer((req, res) => {
  const target = path.resolve(root, "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname));
  if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) { res.writeHead(404); return res.end(); }
  res.setHeader("Content-Type", { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" }[path.extname(target)] || "application/octet-stream");
  fs.createReadStream(target).pipe(res);
});

async function fixture(browser, options = {}) {
  const context = await browser.newContext({ viewport: { width: options.width || 390, height: 844 }, serviceWorkers: "block", timezoneId: "America/Los_Angeles" });
  const model = { events: structuredClone(options.events || [eventFixture]), layout: options.layout === null ? null : structuredClone(options.layout || layoutFixture), requests: [], unexpected: [], errors: [], mapFailed: !!options.mapFailed, savedLayouts: [] };
  if (options.liveMap) {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    model.events.forEach(event => { event.date = today; event.name = options.liveMapName || "Google Maps smoke test — fixture coordinates"; });
    await context.route(deployedOrigin + "**", route => {
      const relative = new URL(route.request().url()).pathname.slice(new URL(deployedOrigin).pathname.length);
      const target = path.resolve(root, decodeURIComponent(relative));
      if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) return route.fulfill({ status: 404, body: "Missing app asset" });
      return route.fulfill({ path: target, contentType: { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" }[path.extname(target)] || "application/octet-stream" });
    });
  }
  await context.addInitScript(({ session, signedIn, instant, mapFailed, liveMap }) => {
    if (signedIn) localStorage.setItem("sb-xspzmthygrajzktydvvj-auth-token", JSON.stringify(session));
    const RealDate = Date;
    window.__now = new RealDate(instant).getTime();
    if (!liveMap) window.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [window.__now])); } static now() { return window.__now; } };
    const watches = new Map();
    window.__gps = {
      calls: 0, cleared: [],
      position(lat, lng, accuracy = 5, age = 0) { for (const watcher of watches.values()) watcher.ok({ coords: { latitude: lat, longitude: lng, accuracy }, timestamp: Date.now() - age }); },
      fail(code = 1) { for (const watcher of watches.values()) watcher.fail({ code, message: "Fixture location failure" }); },
      count() { return watches.size; },
    };
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
      watchPosition(ok, fail, settings) { const id = ++window.__gps.calls; watches.set(id, { ok, fail, settings }); return id; },
      clearWatch(id) { window.__gps.cleared.push(id); watches.delete(id); },
      getCurrentPosition(ok, fail, settings) { return this.watchPosition(ok, fail, settings); },
    } });
    if (liveMap) return; // The production Google loader and provider responses are untouched.
    window.__maps = { instances: [], lines: [] };
    class LatLng { constructor(a, b) { this.point = typeof a === "object" ? a : { lat: a, lng: b }; } lat() { return typeof this.point.lat === "function" ? this.point.lat() : this.point.lat; } lng() { return typeof this.point.lng === "function" ? this.point.lng() : this.point.lng; } toJSON() { return { lat: this.lat(), lng: this.lng() }; } }
    class MapMock {
      constructor(node, settings) { this.node = node; this.settings = { ...settings }; this.listeners = {}; this.pane = document.createElement("div"); this.pane.className = "mock-map-pane"; this.pane.style.cssText = "position:relative;overflow:hidden;width:100%;height:100%;background:#244c45"; node.append(this.pane); window.__maps.instances.push(this); }
      addListener(type, listener) { this.listeners[type] = listener; return { remove: () => delete this.listeners[type] }; }
      setOptions(settings) { Object.assign(this.settings, settings); }
      setCenter(center) { this.settings.center = center; }
      panTo(center) { this.settings.center = center; }
      setZoom(zoom) { this.settings.zoom = zoom; }
      getZoom() { return this.settings.zoom || 17; }
      setHeading(heading) { this.settings.heading = heading; }
      getHeading() { return this.settings.heading || 0; }
      setTilt(tilt) { this.settings.tilt = tilt; }
      getTilt() { return this.settings.tilt || 0; }
      getCenter() { return new LatLng(this.settings.center); }
      getDiv() { return this.node; }
      getProjection() { return { fromLatLngToPoint: point => ({ x: point.lng(), y: point.lat() }) }; }
      fitBounds(bounds) { this.bounds = bounds; }
      moveCamera(settings) { this.setOptions(settings); }
    }
    class OverlayView {
      setMap(map) { if (this.map && this.onRemove) this.onRemove(); this.map = map; if (map) { this.onAdd?.(); this.draw?.(); } }
      getMap() { return this.map; }
      getPanes() { return { overlayMouseTarget: this.map.pane, overlayLayer: this.map.pane, floatPane: this.map.pane }; }
      getProjection() { return { fromLatLngToDivPixel: p => ({ x: (p.lng() + 1.502) * 100000, y: (52.004 - p.lat()) * 100000 }), fromDivPixelToLatLng: p => new LatLng(52.004 - p.y / 100000, p.x / 100000 - 1.502) }; }
      static preventMapHitsAndGesturesFrom() {}
    }
    class Polyline { constructor(settings) { this.settings = settings; window.__maps.lines.push(this); } setMap(map) { this.settings.map = map; } setPath(points) { this.settings.path = points; } setOptions(settings) { Object.assign(this.settings, settings); } }
    class LatLngBounds { constructor() { this.points = []; } extend(point) { this.points.push(point); return this; } }
    const maps = { Map: MapMock, OverlayView, Polyline, LatLng, LatLngBounds, MapTypeId: { SATELLITE: "satellite" }, RenderingType: { VECTOR: "VECTOR", RASTER: "RASTER" }, event: { clearInstanceListeners() {}, removeListener(listener) { listener.remove?.(); }, trigger(obj, type, value) { obj.listeners?.[type]?.(value); } } };
    maps.importLibrary = async () => { if (mapFailed) throw new Error("Fixture map unavailable"); return maps; };
    window.google = { maps };
  }, { session, signedIn: options.signedIn !== false, instant: options.now || now, mapFailed: model.mapFailed, liveMap: !!options.liveMap });
  await context.route(backend + "/**", async route => {
    const request = route.request(), url = new URL(request.url());
    const body = request.postData() ? request.postDataJSON() : {};
    model.requests.push({ url: request.url(), method: request.method(), body });
    const reply = data => route.fulfill({ json: data });
    const rpc = url.pathname.split("/").pop();
    if (url.pathname === "/auth/v1/user") return reply(user);
    if (url.pathname === "/rest/v1/profiles") return reply({ id: uid, full_name: "Hole Test", phone: "07000000000", email: user.email, is_admin: !!options.admin });
    if (rpc === "is_admin") return reply(!!options.admin);
    if (["baseline_admin_accounts", "baseline_member_roster", "baseline_signups"].includes(rpc)) return reply([]);
    if (rpc === "baseline_league_admin") return reply({ revision: 0, players: [], rounds: [] });
    if (rpc === "baseline_finance") return reply({ pending: 0 });
    if (rpc === "baseline_league_board") return reply({ players: [], rounds: [], visible_rounds: 5 });
    if (rpc === "baseline_guest_invitations") return reply({ category: "member", links: [], bookings: [] });
    if (rpc === "baseline_operations") return reply({ settings: {}, charges: [], guests: [], pairs: [], players: [], changes: [] });
    if (rpc === "baseline_reservation_notices") return reply([]);
    if (rpc === "baseline_event_tee_groups") return reply({ status: "unpublished", groups: [] });
    if (rpc === "baseline_event_counts") return reply(model.events.map(ev => ({ event_id: ev.id, playing: 1, waiting: 0 })));
    if (rpc === "baseline_course_layout") {
      if (body.action === "event") { assert.equal(body.payload.event_id, 999); return reply({ event_id: 999, layout: model.layout }); }
      assert.equal(options.admin, true);
      if (body.action === "list") {
        if (model.failCourseList) return route.fulfill({ status: 503, json: { message: "Course list unavailable" } });
        return reply({ layouts: [model.layout, ...model.savedLayouts].filter(Boolean), legacy: [] });
      }
      if (body.action === "get") return reply([model.layout, ...model.savedLayouts].find(layout => layout.id === body.payload.id));
      if (body.action === "save") {
        const saved = { ...body.payload, id: body.payload.id || "33333333-3333-4333-8333-333333333333", revision: (body.payload.revision || 0) + 1, ready_count: body.payload.holes.filter(h => h.reviewed).length };
        model.savedLayouts = model.savedLayouts.filter(layout => layout.id !== saved.id).concat(saved);
        return reply(saved);
      }
    }
    if (rpc === "baseline_rsvps") return reply(options.admin ? [] : { id: 1, user_id: uid, event_id: 999, attending: true, reserve: false, buggy: false });
    if (rpc === "baseline_events") {
      const params = url.searchParams;
      if (request.method() === "PATCH") {
        const ev = model.events.find(ev => params.get("id") === "eq." + ev.id);
        Object.assign(ev, body); model.eventSave = body; return reply(ev);
      }
      let events = model.events.filter(ev => (!params.get("id") || params.get("id") === "eq." + ev.id) && (!params.get("cancelled") || params.get("cancelled") === "eq." + ev.cancelled) && (!params.get("date") || !params.get("date").startsWith("gte.") || ev.date >= params.get("date").slice(4)));
      events = events.sort((a, b) => a.date.localeCompare(b.date));
      if (params.get("limit")) events = events.slice(0, Number(params.get("limit")));
      return reply(request.headers().accept?.includes("vnd.pgrst.object") ? events[0] || null : events);
    }
    if (url.pathname === "/functions/v1/baseline-services") {
      if (body.action === "course") return reply({});
      if (body.action === "weather") return reply({ status: "too_early" });
    }
    model.unexpected.push(request.method() + " " + url.pathname + " " + JSON.stringify(body));
    return route.fulfill({ status: 500, json: { message: "Unexpected test request" } });
  });
  await options.prepare?.(context, model);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", err => model.errors.push(err.message));
  const actualRequests = [];
  page.on("request", req => actualRequests.push({ url: req.url(), method: req.method(), body: req.postData() }));
  model.actualRequests = actualRequests;
  await page.goto((options.liveMap ? deployedOrigin : "http://127.0.0.1:8766/") + (options.admin ? "admin.html" : "index.html"));
  if (options.admin) await page.locator("#adminContent").waitFor();
  else await page.waitForFunction(() => window.barford && !document.querySelector("#nextEvent")?.textContent.includes("Loading the next event"));
  return { context, page, model };
}

async function openHole(page, number = 1) {
  await page.getByRole("button", { name: "View hole", exact: true }).click();
  await page.locator("[data-hole-grid]").waitFor();
  assert.equal(await page.locator("[data-hole-grid] [data-hole]").count(), 18);
  await page.locator(`[data-hole='${number}']`).click();
  await page.locator("[data-hole-screen]").waitFor();
  assert.equal(await page.locator("[data-hole-title]").textContent(), `Hole ${number}`);
}

async function noOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Page must fit the viewport");
  assert.equal(await page.locator(".hole-dialog").evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, "Hole view must fit without sideways scrolling");
}

async function clean(f) {
  assert.deepEqual(f.model.unexpected, [], "Every backend request should have a deliberate fixture");
  assert.deepEqual(f.model.errors, [], "No uncaught browser errors");
  await f.context.close();
}

async function run() {
  fs.mkdirSync(out, { recursive: true });
  await new Promise(resolve => server.listen(8766, "127.0.0.1", resolve));
  const browser = await chromium.launch();
  const report = [];
  const check = async (name, fn) => { await fn(); report.push(name); console.log("PASS " + name); };
  try {
    await check("London event day shows the 18-hole picker; unreviewed holes stay unavailable", async () => {
      const f = await fixture(browser, { width: 320 });
      await openHole(f.page);
      assert.equal(await f.page.evaluate(() => window.__gps.calls), 0, "Opening the view must not ask for location");
      assert.equal(await f.page.locator("[data-hole='18']").isDisabled(), true);
      assert.match(await f.page.locator("[data-distance-origin]").textContent(), /mapped tee/i);
      assert.ok(Math.abs(Number(await f.page.locator("[data-distance='green']").textContent()) - 365) <= 1, "Mapped tee to centre is approximately 365 yards");
      await noOverflow(f.page);
      await f.page.screenshot({ path: path.join(out, "hole-view-320.png"), fullPage: false });
      await f.page.locator("[data-hole-grid-back]").click();
      await f.page.screenshot({ path: path.join(out, "hole-grid-320.png"), fullPage: false });
      await f.page.locator("[data-hole-close]").click();
      await f.page.locator(".hole-dialog").waitFor({ state: "detached" });
      assert.equal(await f.page.locator(".hole-dialog").count(), 0);
      await clean(f);
    });

    await check("Homepage shortcut is limited to signed-in golfers on the event's UK date", async () => {
      for (const options of [
        { signedIn: false },
        { now: "2027-06-24T22:30:00Z" },
        { now: "2027-06-25T23:30:00Z" },
        { events: [{ ...eventFixture, cancelled: true }] },
        { events: [{ ...eventFixture, event_type: "social" }] },
      ]) {
        const f = await fixture(browser, options);
        assert.equal(await f.page.getByRole("button", { name: "View hole", exact: true }).count(), 0, JSON.stringify(options));
        assert.equal(await f.page.evaluate(() => window.__gps.calls), 0);
        await clean(f);
      }
    });

    await check("GPS starts on request, updates real distances locally, and stops on close", async () => {
      const f = await fixture(browser);
      await openHole(f.page);
      await f.page.locator("[data-gps-toggle]").click();
      assert.equal(await f.page.evaluate(() => window.__gps.calls), 1);
      await f.page.evaluate(() => window.__gps.position(52.0011, -1.5));
      await f.page.waitForFunction(() => /gps|your location/i.test(document.querySelector("[data-distance-origin]").textContent));
      assert.ok(Math.abs(Number(await f.page.locator("[data-distance='green']").textContent()) - 243) <= 1, "Moving 122 yards from the tee changes centre distance to 243 yards");
      assert.ok(Number(await f.page.locator("[data-distance='front']").textContent()) < Number(await f.page.locator("[data-distance='green']").textContent()));
      assert.ok(Number(await f.page.locator("[data-distance='back']").textContent()) > Number(await f.page.locator("[data-distance='green']").textContent()));
      for (const request of f.model.requests) {
        assert.doesNotMatch(JSON.stringify(request.body), /52\.0011|latitude|longitude|coords/, "Member GPS coordinates must never be uploaded to Supabase");
      }
      await f.page.locator("[data-hole-close]").click();
      await f.page.locator(".hole-dialog").waitFor({ state: "detached" });
      assert.equal(await f.page.evaluate(() => window.__gps.count()), 0);
      assert.equal(await f.page.evaluate(() => window.__gps.cleared.length), 1);
      await clean(f);
    });

    await check("GPS permission denial returns an honest mapped-tee view", async () => {
      const f = await fixture(browser);
      await openHole(f.page);
      await f.page.locator("[data-gps-toggle]").click();
      await f.page.evaluate(() => window.__gps.fail(1));
      assert.match(await f.page.locator("[data-gps-status]").textContent(), /denied|permission|allow|blocked/i);
      assert.equal(await f.page.locator("[data-distance-origin]").evaluate(el => el.classList.contains("is-live")), false);
      assert.ok(Math.abs(Number(await f.page.locator("[data-distance='green']").textContent()) - 365) <= 1);
      assert.equal(await f.page.evaluate(() => window.__gps.count()), 0);
      await clean(f);
    });

    await check("Old, inaccurate and impossible GPS fixes are never presented as live yardages", async () => {
      const f = await fixture(browser);
      await openHole(f.page);
      await f.page.locator("[data-gps-toggle]").click();
      for (const fix of [
        { lat: 52.0011, lng: -1.5, accuracy: 5, age: 120000 },
        { lat: 52.0011, lng: -1.5, accuracy: 300, age: 0 },
        { lat: 152.0011, lng: -1.5, accuracy: 5, age: 0 },
        { lat: 51.0011, lng: -0.5, accuracy: 5, age: 0 },
        { lat: 52.0011, lng: -1.5, accuracy: 5, age: -60000 },
      ]) {
        await f.page.evaluate(() => window.__gps.position(52.0011, -1.5));
        assert.equal(await f.page.locator("[data-distance-origin]").evaluate(el => el.classList.contains("is-live")), true);
        await f.page.evaluate(fix => window.__gps.position(fix.lat, fix.lng, fix.accuracy, fix.age), fix);
        assert.equal(await f.page.locator("[data-distance-origin]").evaluate(el => el.classList.contains("is-live")), false);
        assert.notEqual(Number(await f.page.locator("[data-distance='green']").textContent()), 243);
      }
      await f.page.evaluate(() => { window.__gps.position(52.0011, -1.5); window.__now += 16000; });
      await f.page.waitForFunction(() => /^From mapped tee/.test(document.querySelector("[data-distance-origin]").textContent));
      assert.match(await f.page.locator("[data-gps-status]").textContent(), /out of date/i, "A stopped GPS stream must expire without another fix arriving");
      await f.page.locator("[data-hole-close]").click();
      await f.page.locator(".hole-dialog").waitFor({ state: "detached" });
      assert.equal(await f.page.evaluate(() => window.__gps.count()), 0);
      await clean(f);
    });

    await check("An event without a mapped course has no made-up holes or distances", async () => {
      const f = await fixture(browser, { layout: null });
      await f.page.getByRole("button", { name: "View hole", exact: true }).click();
      await f.page.locator(".hole-dialog").waitFor();
      await f.page.locator("[data-hole-grid]").waitFor();
      assert.equal(await f.page.locator("[data-hole-grid] [data-hole]:enabled").count(), 0);
      assert.equal(await f.page.evaluate(() => window.__gps.calls), 0);
      assert.match(await f.page.locator(".hole-dialog").textContent(), /not.*(ready|set up|mapped)|unavailable|organiser|setup|set up/i);
      await clean(f);
    });

    await check("Tap-to-measure targets work, navigation clears them, and unmapped green edges stay absent", async () => {
      const f = await fixture(browser);
      await openHole(f.page);
      await f.page.waitForFunction(() => window.__maps.instances.length === 1);
      await f.page.evaluate(() => window.google.maps.event.trigger(window.__maps.instances[0], "click", { latLng: new window.google.maps.LatLng(52.0011, -1.5) }));
      await f.page.locator("[data-target-distances]").waitFor();
      assert.match(await f.page.locator("[data-target-distances]").textContent(), /122 yd/);
      assert.match(await f.page.locator("[data-target-distances]").textContent(), /243 yd/);
      await f.page.locator("[data-hole-next]").click();
      assert.equal(await f.page.locator("[data-hole-title]").textContent(), "Hole 2");
      assert.equal(await f.page.locator("[data-target-distances]").isVisible(), false);
      assert.equal(await f.page.locator("[data-distance='front']").count(), 0);
      assert.equal(await f.page.locator("[data-distance='back']").count(), 0);
      assert.equal(await f.page.evaluate(() => window.__maps.instances.length), 1, "Changing hole must reuse its map");
      await clean(f);
    });

    await check("Reviewed flags cannot make missing or invalid coordinates available", async () => {
      const layout = structuredClone(layoutFixture);
      layout.holes[0].green = { lat: 152, lng: -1.5 };
      layout.holes[1].tee = null;
      const f = await fixture(browser, { layout });
      await f.page.getByRole("button", { name: "View hole", exact: true }).click();
      await f.page.locator("[data-hole-grid]").waitFor();
      assert.equal(await f.page.locator("[data-hole='1']").isDisabled(), true);
      assert.equal(await f.page.locator("[data-hole='2']").isDisabled(), true);
      assert.equal(await f.page.locator("[data-hole='3']").isDisabled(), false);
      await clean(f);
    });

    await check("A failed map still leaves measured distances usable without fabricated imagery", async () => {
      const f = await fixture(browser, { mapFailed: true });
      await openHole(f.page);
      await f.page.waitForFunction(() => /unavailable|could not|couldn.t|failed/i.test(document.querySelector(".hole-dialog").textContent));
      assert.ok(Math.abs(Number(await f.page.locator("[data-distance='green']").textContent()) - 365) <= 1);
      await f.page.locator("[data-gps-toggle]").click();
      await f.page.evaluate(() => window.__gps.position(52.0011, -1.5));
      assert.ok(Math.abs(Number(await f.page.locator("[data-distance='green']").textContent()) - 243) <= 1);
      await clean(f);
    });

    await check("Course lookup selects Yellow automatically and saves all 18 GPS holes with the event", async () => {
      const prepared = structuredClone(preparedLayoutFixture);
      const place = { id: prepared.place_id, displayName: { text: prepared.name }, formattedAddress: prepared.address, location: { latitude: prepared.latitude, longitude: prepared.longitude }, websiteUri: "https://example.invalid/course", nationalPhoneNumber: "01926 000000" };
      const cards = [{ key: "course-yellow", course_name: prepared.name, tee_name: "Yellow" }, { key: "course-red", course_name: prepared.name, tee_name: "Red" }];
      const calls = [];
      const f = await fixture(browser, { admin: true, prepare: async context => {
        await context.route(backend + "/functions/v1/baseline-services", async route => {
          const body = route.request().postDataJSON();
          if (body.action === "search_course") return route.fulfill({ json: { places: [place] } });
          if (body.action === "course_details") return route.fulfill({ json: { place } });
          if (body.action === "prepare_course") {
            calls.push(body);
            if (!body.scorecard_key) return route.fulfill({ json: { status: "choice_required", draft: null, scorecards: cards } });
            assert.equal(body.scorecard_key, "course-yellow");
            return route.fulfill({ json: { status: "ready", draft: prepared, scorecards: cards, selected_key: body.scorecard_key } });
          }
          return route.fallback();
        });
      } });
      await f.page.locator('[data-tab="details"]').click();
      await f.page.locator("#adminEvent").selectOption("999");
      await f.page.waitForFunction(() => /Choose the course/.test(document.querySelector("[data-course-preparation]").textContent));
      await f.page.locator("#courseQuery").fill(prepared.name);
      await f.page.locator("#findCourse").click();
      await f.page.locator("#courseResults [data-course]").click();
      const choice = f.page.locator("[data-scorecard-choice]");
      await choice.waitFor();
      await f.page.locator("[data-preview-layout]").waitFor();
      assert.equal(await choice.inputValue(), "course-yellow");
      assert.equal(f.model.savedLayouts.length, 0, "Discovery must not save an unconfirmed layout");
      assert.equal(await f.page.locator("[name=course_layout_id]").inputValue(), "");
      await f.page.locator("[data-preview-layout]").click();
      const preview = f.page.getByRole("dialog", { name: "Course map preview", exact: true });
      await preview.locator("[data-hole-grid]").waitFor();
      assert.equal(await preview.locator("[data-hole]:enabled").count(), 18);
      await preview.locator("[data-hole='1']").click();
      await preview.locator("[data-hole-screen]").waitFor();
      assert.equal(await preview.locator("[data-hole-title]").textContent(), "Hole 1");
      await preview.locator("[data-hole-close]").click();
      await preview.waitFor({ state: "detached" });
      assert.equal(await f.page.locator("[data-confirm-maps]").count(), 0);
      await f.page.getByRole("button", { name: "Save event", exact: true }).click();
      await f.page.waitForFunction(() => document.querySelector("#eventForm button:not([type])")?.textContent === "Save event");
      assert.equal(f.model.savedLayouts.length, 1);
      assert.equal(f.model.savedLayouts[0].holes.length, 18);
      assert.ok(f.model.savedLayouts[0].holes.every(h => h.reviewed));
      assert.deepEqual(f.model.savedLayouts[0].holes.map(h => h.tee), prepared.holes.map(h => h.tee));
      assert.equal(f.model.requests.filter(r => /baseline_course_layout$/.test(r.url) && ["list", "match", "import"].includes(r.body.action)).length, 0, "Fresh setup must not restore earlier course drafts");
      assert.equal(calls.length, 2);
      assert.equal(calls[0].place_id, prepared.place_id);
      assert.equal(f.model.eventSave.course_layout_id, "33333333-3333-4333-8333-333333333333");
      await clean(f);
    });

    await check("An admin can preview a verified map before an event is saved without publishing its holes", async () => {
      const f = await fixture(browser, { admin: true });
      const before = f.model.requests.length;
      await f.page.evaluate(async prepared => {
        const { openHolePicker } = await import("./assets/js/hole-view.js");
        window.__previewDraft = prepared;
        openHolePicker({ name: prepared.name }, window.barford, prepared);
      }, preparedLayoutFixture);
      const dialog = f.page.getByRole("dialog", { name: "Course map preview", exact: true });
      await dialog.locator("[data-hole-grid]").waitFor();
      assert.equal(await dialog.locator("[data-hole]:enabled").count(), 18);
      assert.match(await dialog.locator("[data-hole-readiness]").textContent(), /Preview only/);
      await dialog.locator("[data-hole='1']").click();
      await dialog.locator("[data-hole-screen]").waitFor();
      assert.equal(await dialog.locator(".hole-dialog-top h2").textContent(), "Course map preview");
      assert.ok(Number(await dialog.locator("[data-distance='green']").textContent()) > 0);
      await noOverflow(f.page);
      await dialog.screenshot({ path: path.join(out, "hole-admin-preview.png") });
      assert.equal(await f.page.evaluate(() => window.__previewDraft.holes.some(h => h.reviewed)), false, "Preview must not change organiser confirmation");
      assert.equal(f.model.savedLayouts.length, 0, "Preview must not save a layout");
      assert.equal(f.model.requests.slice(before).filter(r => r.url.endsWith("baseline_course_layout") && r.body.action === "event").length, 0, "Unsaved preview must not request a made-up event");
      await clean(f);
    });

    await check("Members cannot use an injected prepared layout to view unconfirmed course coordinates", async () => {
      const f = await fixture(browser, { layout: null });
      await f.page.evaluate(async prepared => {
        const { openHolePicker } = await import("./assets/js/hole-view.js");
        openHolePicker({ id: 999, name: "Member course" }, window.barford, prepared);
      }, preparedLayoutFixture);
      await f.page.locator("[data-hole-grid]").waitFor();
      assert.equal(await f.page.locator("[data-hole]:enabled").count(), 0);
      assert.equal(await f.page.getByRole("dialog", { name: "Course map preview", exact: true }).count(), 0);
      assert.equal(f.model.requests.filter(r => r.url.endsWith("baseline_course_layout") && r.body.action === "event").length, 1);
      await clean(f);
    });

    await check("Even admin preview refuses incomplete or unverified hole geometry", async () => {
      for (const mutate of [
        draft => { draft.holes.pop(); },
        draft => { draft.source.validation.status = "incomplete"; },
        draft => { draft.holes[1].green = draft.holes[0].green; },
        draft => { draft.holes[1].tee = draft.holes[1].green; },
      ]) {
        const draft = structuredClone(preparedLayoutFixture); mutate(draft);
        const f = await fixture(browser, { admin: true });
        await f.page.evaluate(async prepared => {
          const { openHolePicker } = await import("./assets/js/hole-view.js");
          openHolePicker({ name: prepared.name }, window.barford, prepared);
        }, draft);
        await f.page.waitForFunction(() => /could not load/.test(document.querySelector("[data-hole-loading]").textContent));
        assert.equal(await f.page.locator("[data-hole]:enabled").count(), 0);
        assert.equal(await f.page.evaluate(() => window.__maps.instances.length), 0);
        assert.equal(f.model.savedLayouts.length, 0);
        await clean(f);
      }
    });

    await check("Earls holes 1 and 10 render fresh discovered coordinates over real Google satellite tiles", async () => {
      // Fresh provider output, including OSM feature IDs and scorecard provenance.
      // Only this read-only member fixture marks the holes as organiser-confirmed.
      const earls = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "earls-course-map.json"), "utf8"));
      assert.equal(earls.source.validation.status, "verified");
      assert.equal(earls.source.validation.tee_anchors, 18);
      assert.equal(earls.source.validation.green_anchors, 18);
      const layout = { ...earls, id: eventFixture.course_layout_id, revision: 1, ready_count: 18, holes: earls.holes.map(h => ({ ...h, reviewed: true })) };
      const f = await fixture(browser, { liveMap: true, liveMapName: "Earls course mapping smoke test", layout });
      const provider = { responses: [], failures: [], console: [], tileCount: 0, lastTileAt: 0, course: earls.name, holes: [1, 10] };
      f.page.on("console", message => {
        if (/Google Maps JavaScript API error|RefererNotAllowedMapError|InvalidKeyMapError|ApiNotActivatedMapError|BillingNotEnabledMapError|REQUEST_DENIED|This page can.t load Google Maps/i.test(message.text())) provider.console.push(message.text());
      });
      f.page.on("requestfailed", request => {
        const url = new URL(request.url());
        if (/\.(googleapis|gstatic|google)\.com$/.test(url.hostname)) provider.failures.push({ host: url.hostname, path: url.pathname, error: request.failure()?.errorText });
      });
      f.page.on("response", async response => {
        const url = new URL(response.url());
        if (!/\.(googleapis|gstatic|google)\.com$/.test(url.hostname)) return;
        const contentType = response.headers()["content-type"] || "";
        provider.responses.push({ host: url.hostname, path: url.pathname, status: response.status(), contentType });
        if (response.ok() && /^image\//.test(contentType) && /\/(kh|vt|tile)(\/|$)/.test(url.pathname) && !(await response.finished())) { provider.tileCount++; provider.lastTileAt = Date.now(); }
      });
      try {
        await openHole(f.page);
        await f.page.waitForFunction(() => {
          const canvas = document.querySelector("[data-hole-map] .gm-style canvas");
          const error = document.querySelector(".gm-err-content,.gm-err-message");
          return error || (canvas && canvas.width > 100 && canvas.height > 100);
        }, null, { timeout: 40000 });
        assert.equal(await f.page.locator(".gm-err-content,.gm-err-message").count(), 0, "Google must authorise the deployed hostname");
        assert.deepEqual(provider.console, [], "Google must report no API key or billing error");
        const deadline = Date.now() + 15000;
        while (!provider.tileCount && Date.now() < deadline && !provider.console.length) await new Promise(resolve => setTimeout(resolve, 250));
        assert.ok(provider.tileCount > 0, "Real Google satellite image tiles must return successfully");
        assert.equal(await f.page.locator("[data-map-status]").isVisible(), false, "Map loader must complete without an error banner");
        assert.equal(await f.page.evaluate(() => window.__gps.calls), 0, "Provider smoke must never request device location");
        await noOverflow(f.page);
        await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await f.page.screenshot({ path: path.join(out, "google-hole-map.png"), fullPage: false });
        await f.page.screenshot({ path: path.join(out, "google-earls-hole-1.png"), fullPage: false });
        assert.match(await f.page.locator("[data-hole-course]").textContent(), /Earls/);
        assert.match(await f.page.locator("[data-hole-stats]").textContent(), /423/);
        await f.page.locator("[data-hole-grid-back]").click();
        await f.page.locator("[data-hole='10']").click();
        await f.page.locator("[data-hole-screen]").waitFor();
        assert.equal(await f.page.locator("[data-hole-title]").textContent(), "Hole 10");
        assert.match(await f.page.locator("[data-hole-stats]").textContent(), /568/);
        // Let the real camera and newly requested tiles settle before inspecting
        // the second half of the course; this is bounded and performs no writes.
        const changedAt = Date.now(), settleDeadline = changedAt + 10000;
        while (Date.now() < settleDeadline && (Date.now() - changedAt < 1500 || Date.now() - provider.lastTileAt < 750)) await new Promise(resolve => setTimeout(resolve, 150));
        await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await f.page.screenshot({ path: path.join(out, "google-earls-hole-10.png"), fullPage: false });
        assert.equal(await f.page.locator(".gm-err-content,.gm-err-message").count(), 0);
        assert.deepEqual(provider.console, []);
        await noOverflow(f.page);
        await clean(f);
      } finally {
        fs.writeFileSync(path.join(out, "google-map-provider.json"), JSON.stringify(provider, null, 2));
        if (!f.page.isClosed()) {
          await f.page.screenshot({ path: path.join(out, "google-hole-map.png"), fullPage: false });
          await f.context.close();
        }
      }
    });
  } finally {
    fs.writeFileSync(path.join(out, "hole-view.json"), JSON.stringify({ passed: report.length, checks: report }, null, 2));
    await browser.close();
    server.close();
  }
}
module.exports = { fixture, server, root, out, backend, eventFixture, layoutFixture, preparedLayoutFixture, uid };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
