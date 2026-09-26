/* Event authoring checks: real UI, isolated accounts/storage/course-provider fixtures. */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { fixture, server, root, out, backend, eventFixture, layoutFixture } = require("./hole-view.cjs");

const courses = [
  { id: "place-course-a", displayName: { text: "Course Alpha" }, formattedAddress: "1 Golf Lane, Warwick, CV1 1AA", location: { latitude: 52.0001, longitude: -1.5 }, websiteUri: "https://alpha.example.invalid/", nationalPhoneNumber: "01926 111111" },
  { id: "place-course-b", displayName: { text: "Course Bravo" }, formattedAddress: "2 Golf Road, Warwick, CV2 2BB", location: { latitude: 52.2201, longitude: -1.2 }, websiteUri: "https://bravo.example.invalid/", nationalPhoneNumber: "01926 222222" },
];
const image = fs.readFileSync(path.join(root, "icon-logo.png"));
const picture = name => ({ name, mimeType: "image/png", buffer: image });
const emptyHole = number => ({ number, par: null, stroke_index: null, yards: null, tee: null, green: null, front: null, back: null, dogleg: null, reviewed: false });
const draftFor = place => ({
  name: place.displayName.text, tee_name: "Yellow", place_id: place.id,
  center: { lat: place.location.latitude, lng: place.location.longitude }, address: place.formattedAddress,
  holes: Array.from({ length: 18 }, (_, i) => i < 3 ? { ...emptyHole(i + 1), par: 4, tee: { lat: place.location.latitude + i * 0.0001, lng: place.location.longitude }, green: { lat: place.location.latitude + 0.003 + i * 0.0001, lng: place.location.longitude } } : emptyHole(i + 1)),
  source: { provider: "OpenStreetMap", attribution: "© OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright", coverage: { mapped: 3, total: 18 }, warnings: ["Only three holes have mapped positions. Check each hole before publishing."] },
});

async function setup(browser, options = {}) {
  const f = await fixture(browser, {
    admin: true, width: options.width || 390,
    events: [{ ...eventFixture, course_layout_id: null, ...(options.event || {}) }], layout: null,
    prepare: async (context, model) => {
      Object.assign(model, { setupRequests: [], uploads: [], storageDeletes: [], savedCourseLayouts: [], matches: options.matches || {}, legacyMatches: options.legacyMatches || {}, importedLayouts: options.importedLayouts || {}, heldMappings: new Set(), pendingMappings: new Map(), mappingDrafts: {}, eventFailures: 0, uploadFailures: 0, eventSaves: [] });
      model.releaseMapping = placeId => model.pendingMappings.get(placeId)?.();
      await context.route(backend + "/**", async route => {
        const request = route.request(), url = new URL(request.url()), p = url.pathname;
        if (p.startsWith("/storage/v1/object/")) {
          if (request.method() === "POST") {
            model.uploads.push({ path: p, size: request.postDataBuffer()?.length || 0 });
            if (model.uploadFailures-- > 0) return route.fulfill({ status: 503, json: { message: "Receipt service unavailable", error: "Upload interrupted" } });
            return route.fulfill({ json: { Id: "upload-id", Key: p.replace("/storage/v1/object/", "") } });
          }
          if (request.method() === "DELETE") { model.storageDeletes.push(p); return route.fulfill({ json: [] }); }
          return route.fulfill({ contentType: "image/png", body: image });
        }
        let body = {};
        try { body = request.postDataJSON() || {}; } catch {}
        if (p === "/functions/v1/baseline-services") {
          model.setupRequests.push(body);
          if (body.action === "search_course") return route.fulfill({ json: { places: courses } });
          if (body.action === "course_details") return route.fulfill({ json: { place: courses.find(course => course.id === body.place_id) } });
          if (body.action === "prepare_course") {
            const place = courses.find(course => course.id === body.place_id);
            assert.ok(place, "Mapping must use the selected Google place");
            if (model.heldMappings.has(place.id)) await new Promise(resolve => model.pendingMappings.set(place.id, resolve));
            return route.fulfill({ json: { draft: model.mappingDrafts[place.id] || draftFor(place) } });
          }
        }
        if (p.endsWith("/rpc/baseline_course_layout")) {
          model.setupRequests.push(body);
          if (body.action === "list") return route.fulfill({ json: { layouts: [...Object.values(model.matches).flat().filter(layout => !model.savedCourseLayouts.some(saved => saved.id === layout.id)), ...model.savedCourseLayouts], legacy: Object.values(model.legacyMatches).flat() } });
          if (body.action === "match") return route.fulfill({ json: { layouts: model.matches[body.payload.place_id] || [], legacy: model.legacyMatches[body.payload.place_id] || [] } });
          if (body.action === "get") return route.fulfill({ json: [...model.savedCourseLayouts, ...Object.values(model.matches).flat()].find(layout => layout.id === body.payload.id) });
          if (body.action === "import") {
            const imported = structuredClone(model.importedLayouts[body.payload.legacy_id]);
            assert.ok(imported, "Legacy import must target the uniquely matched course");
            model.savedCourseLayouts.push(imported);
            return route.fulfill({ json: imported });
          }
          if (body.action === "save") {
            const layout = { ...body.payload, id: body.payload.id || "33333333-3333-4333-8333-" + String(model.savedCourseLayouts.length + 1).padStart(12, "0"), revision: (body.payload.revision || 0) + 1, ready_count: body.payload.holes.filter(h => h.reviewed).length };
            model.savedCourseLayouts = model.savedCourseLayouts.filter(saved => saved.id !== layout.id).concat(layout);
            return route.fulfill({ json: layout });
          }
        }
        if (p.endsWith("/baseline_events") && ["POST", "PATCH"].includes(request.method())) {
          model.eventSaves.push(body);
          if (model.eventFailures-- > 0) return route.fulfill({ status: 503, json: { message: "Event save interrupted. Try again." } });
          if (request.method() === "POST") {
            const event = { ...eventFixture, ...body, id: 1001 };
            model.events.push(event); model.eventSave = body;
            return route.fulfill({ json: event });
          }
        }
        return route.fallback();
      });
    },
  });
  await f.page.locator('[data-tab="details"]').click();
  if (options.existing) await f.page.locator("#adminEvent").selectOption("999");
  return f;
}

async function chooseCourse(f, index) {
  await f.page.locator("#courseQuery").fill(courses[index].displayName.text);
  await f.page.locator("#findCourse").click();
  await f.page.locator(`[data-course="${index}"]`).click();
  await f.page.waitForFunction(placeId => document.querySelector("[name=place_id]").value === placeId, courses[index].id);
}

async function finish(f) {
  assert.deepEqual(f.model.errors, [], "No uncaught browser errors");
  assert.deepEqual(f.model.unexpected, [], "No unhandled API requests");
  await f.context.close();
}

async function waitUntil(predicate, message) {
  const deadline = Date.now() + 10000;
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(predicate(), message);
}

async function saveEvent(f) {
  await f.page.getByRole("button", { name: "Save event", exact: true }).click();
  await f.page.waitForFunction(() => document.querySelector("#eventForm button:not([type])")?.textContent === "Save event");
}

async function run() {
  fs.mkdirSync(out, { recursive: true });
  await new Promise(resolve => server.listen(8766, "127.0.0.1", resolve));
  const browser = await chromium.launch();
  const report = [];
  const check = async (name, fn) => { await fn(); report.push(name); console.log("PASS " + name); };
  try {
    await check("Choosing a course fills practical details and reuses a checked layout without technical fields", async () => {
      const existing = { ...structuredClone(layoutFixture), place_id: courses[0].id, name: courses[0].displayName.text };
      const f = await setup(browser, { matches: { [courses[0].id]: [existing] } });
      await chooseCourse(f, 0);
      await f.page.waitForFunction(id => document.querySelector('[name="course_layout_id"]').value === id, existing.id);
      for (const [name, expected] of Object.entries({ course_name: courses[0].displayName.text, address: courses[0].formattedAddress, course_link: courses[0].websiteUri, course_phone: courses[0].nationalPhoneNumber, latitude: String(courses[0].location.latitude), longitude: String(courses[0].location.longitude), location: courses[0].displayName.text })) assert.equal(await f.page.locator(`[name="${name}"]`).inputValue(), expected);
      for (const name of ["latitude", "longitude", "location", "cover_url"]) assert.equal(await f.page.locator(`[name="${name}"]`).getAttribute("type"), "hidden", `${name} must not need manual technical input`);
      assert.equal(await f.page.locator('[name="cover_credit"]').count(), 0);
      assert.equal(f.model.setupRequests.filter(body => body.action === "prepare_course").length, 0, "An existing layout must be reused without mapping again");
      assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await f.page.screenshot({ path: path.join(out, "event-setup-mobile.png"), fullPage: true });
      await finish(f);
    });

    await check("Cover selection rejects unsupported, oversized and corrupt files before upload", async () => {
      const original = backend + "/storage/v1/object/public/baseline-event-covers/original.jpg";
      const f = await setup(browser, { existing: true, event: { cover_url: original } });
      const input = f.page.locator("#eventCoverFile");
      for (const [file, status] of [
        [{ name: "document.pdf", mimeType: "application/pdf", buffer: Buffer.from("test PDF") }, /JPG|JPEG|PNG|WebP|photo|image/i],
        [{ name: "huge.png", mimeType: "image/png", buffer: Buffer.alloc(10 * 1024 * 1024 + 1) }, /10\s?MB|smaller|large|size/i],
        [{ name: "broken.png", mimeType: "image/png", buffer: Buffer.from("This is not an image") }, /read|valid|open|image|photo|decode/i],
      ]) {
        await input.setInputFiles(file);
        await f.page.waitForFunction(() => { const status = document.querySelector("#eventCoverStatus").textContent; return status.trim().length > 0 && !status.includes("Preparing"); });
        assert.match(await f.page.locator("#eventCoverStatus").textContent(), status);
        await saveEvent(f);
        assert.equal(f.model.uploads.length, 0);
        assert.equal(f.model.eventSaves.length, 0, "Invalid files must block the save instead of discarding the existing cover");
        assert.equal(await f.page.locator("#eventCoverPreview").getAttribute("src"), original);
      }
      await finish(f);
    });

    await check("Cover previews persist through a failed event save, retry once, replace and clear", async () => {
      const f = await setup(browser, { existing: true });
      await f.page.locator("#eventCoverFile").setInputFiles(picture("course-first.png"));
      await f.page.waitForFunction(() => { const image = document.querySelector("#eventCoverPreview"); return !image.hidden && image.naturalWidth > 0; });
      assert.match(await f.page.locator("#eventCoverPreview").getAttribute("src"), /^blob:/);
      assert.equal(f.model.uploads.length, 0, "Selecting a photo should only create a local preview");
      f.model.eventFailures = 1;
      await saveEvent(f);
      await f.page.getByText(/Event save interrupted/).waitFor();
      assert.equal(f.model.uploads.length, 1);
      const uploadedUrl = f.model.eventSaves[0].cover_url;
      assert.match(uploadedUrl, /\/storage\/v1\/object\/public\/baseline-event-covers\/.*\.jpg$/);
      assert.equal(await f.page.locator("#eventCoverPreview").isVisible(), true);
      await saveEvent(f);
      assert.equal(f.model.uploads.length, 1, "Retry must reuse the already-uploaded photo");
      assert.equal(f.model.eventSave.cover_url, uploadedUrl);
      await f.page.locator("#eventCoverFile").setInputFiles(picture("course-replacement.png"));
      await f.page.waitForFunction(() => document.querySelector("#eventCoverPreview").getAttribute("src").startsWith("blob:"));
      await saveEvent(f);
      assert.equal(f.model.uploads.length, 2);
      assert.notEqual(f.model.eventSave.cover_url, uploadedUrl);
      await f.page.locator("#removeEventCover").click();
      assert.equal(await f.page.locator("#eventCoverPreview").isVisible(), false);
      await saveEvent(f);
      assert.equal(f.model.eventSave.cover_url, null);
      assert.equal(f.model.storageDeletes.length, 0, "Clearing a form must not delete shared stored photos");
      await finish(f);
    });

    await check("Changing the course discards late automatic mapping from the previous course", async () => {
      const existingB = { ...structuredClone(layoutFixture), id: "44444444-4444-4444-8444-444444444444", place_id: courses[1].id, name: courses[1].displayName.text };
      const f = await setup(browser, { matches: { [courses[1].id]: [existingB] } });
      f.model.heldMappings.add(courses[0].id);
      await chooseCourse(f, 0);
      await waitUntil(() => f.model.pendingMappings.has(courses[0].id), "First course mapping must be in flight");
      await chooseCourse(f, 1);
      await f.page.waitForFunction(id => document.querySelector('[name="course_layout_id"]').value === id, existingB.id);
      const completed = f.page.waitForResponse(response => response.url().endsWith("/baseline-services") && response.request().postDataJSON().action === "prepare_course");
      f.model.releaseMapping(courses[0].id);
      await completed;
      await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await f.page.locator('[name="course_layout_id"]').inputValue(), existingB.id);
      assert.equal(await f.page.locator('[name="course_name"]').inputValue(), courses[1].displayName.text);
      assert.equal(await f.page.locator('[name="address"]').inputValue(), courses[1].formattedAddress);
      assert.equal(f.model.savedCourseLayouts.length, 0, "Late results from course A must not be saved after choosing course B");
      await finish(f);
    });

    await check("Partial automatic mapping stays unreviewed and leaves missing holes empty", async () => {
      const f = await setup(browser);
      await chooseCourse(f, 0);
      await waitUntil(() => f.model.savedCourseLayouts.length === 1, "Prepared course draft should be stored");
      const saved = f.model.savedCourseLayouts[0];
      assert.equal(saved.holes.length, 18);
      assert.equal(saved.ready_count, 0);
      assert.equal(saved.holes.filter(hole => hole.tee && hole.green).length, 3);
      assert.ok(saved.holes.every(hole => hole.reviewed === false));
      assert.ok(saved.holes.slice(3).every(hole => hole.tee === null && hole.green === null));
      await f.page.locator("[data-edit-layout]").click();
      const editor = f.page.locator(".hole-admin-dialog");
      await editor.waitFor();
      assert.equal(await editor.locator('[name="reviewed"]').isChecked(), false);
      for (const name of ["tee_lat", "tee_lng", "green_lat", "green_lng"]) assert.equal(await editor.locator(`[name="${name}"]`).isVisible(), false);
      await editor.screenshot({ path: path.join(out, "prepared-course-review.png") });
      await finish(f);
    });

    await check("Filling gaps in an existing layout preserves already reviewed holes and known data", async () => {
      const existing = { ...structuredClone(layoutFixture), place_id: courses[0].id, name: courses[0].displayName.text, ready_count: 1, holes: Array.from({ length: 18 }, (_, i) => emptyHole(i + 1)) };
      existing.holes[0] = { ...structuredClone(layoutFixture.holes[0]), par: 5, yards: 510, stroke_index: 6 };
      existing.holes[1] = { ...emptyHole(2), par: 3, tee: { lat: 52.0009, lng: -1.5001 } };
      const f = await setup(browser, { existing: true, matches: { [courses[0].id]: [existing] }, event: { course_name: courses[0].displayName.text, place_id: courses[0].id, latitude: courses[0].location.latitude, longitude: courses[0].location.longitude, course_layout_id: existing.id } });
      await f.page.waitForFunction(id => document.querySelector('[name="course_layout_id"]').value === id, existing.id);
      await f.page.locator("[data-course-prepare]").click();
      await waitUntil(() => f.model.savedCourseLayouts.length === 1, "Gap filling should save the selected layout");
      const saved = f.model.savedCourseLayouts[0];
      assert.equal(saved.id, existing.id);
      assert.deepEqual(saved.holes[0], existing.holes[0], "A reviewed hole must stay unchanged");
      assert.deepEqual(saved.holes[1].tee, existing.holes[1].tee);
      assert.equal(saved.holes[1].par, 3);
      assert.ok(saved.holes[1].green, "Missing green may be filled from the provider");
      assert.equal(saved.holes[1].reviewed, false);
      assert.equal(f.model.setupRequests.find(request => request.action === "prepare_course").place_id, courses[0].id, "Reopening an event must use its Google place ID, never its event ID");
      await finish(f);
    });

    await check("Selecting a different tee scorecard updates hole facts and requires GPS review again", async () => {
      const card = { course_name: courses[0].displayName.text, tee_name: "White", source_url: "https://alpha.example.invalid/scorecard", holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, yards: 390 + i, stroke_index: 18 - i })) };
      const existing = { ...structuredClone(layoutFixture), place_id: courses[0].id, name: courses[0].displayName.text, source: { scorecards: [card] } };
      const f = await setup(browser, { matches: { [courses[0].id]: [existing] } });
      await chooseCourse(f, 0);
      await f.page.locator("[data-edit-layout]").click();
      const editor = f.page.locator(".hole-admin-dialog");
      await editor.locator("[data-scorecard-choice]").selectOption("0");
      await editor.locator("[data-use-scorecard]").click();
      assert.equal(await editor.locator('[name="tee_name"]').inputValue(), "White");
      assert.equal(await editor.locator('[name="yards"]').inputValue(), "390");
      assert.equal(await editor.locator('[name="stroke_index"]').inputValue(), "18");
      assert.equal(await editor.locator('[name="reviewed"]').isChecked(), false);
      await editor.locator("[data-save-close]").click();
      await editor.waitFor({ state: "detached" });
      const saved = f.model.savedCourseLayouts[0];
      assert.ok(saved.holes.every(hole => !hole.reviewed));
      assert.deepEqual(saved.holes.map(hole => hole.tee), existing.holes.map(hole => hole.tee));
      assert.deepEqual(saved.holes.map(hole => hole.green), existing.holes.map(hole => hole.green));
      await finish(f);
    });

    await check("Identical scorecards preserve review; a different course or changed par/index invalidates it", async () => {
      const north = { course_name: "North Course", tee_name: "Yellow", source_url: "https://alpha.example.invalid/north", holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, yards: 365, stroke_index: i + 1 })) };
      const south = { ...structuredClone(north), course_name: "South Course", source_url: "https://alpha.example.invalid/south" };
      const revisedNorth = structuredClone(north);
      revisedNorth.holes[0].par = 5;
      [revisedNorth.holes[0].stroke_index, revisedNorth.holes[1].stroke_index] = [2, 1];
      for (const changed of [south, revisedNorth]) {
        const existing = { ...structuredClone(layoutFixture), place_id: courses[0].id, name: north.course_name, source: { selected_scorecard: { course_name: north.course_name, tee_name: north.tee_name, source_url: north.source_url }, scorecards: [north, changed] } };
        const f = await setup(browser, { matches: { [courses[0].id]: [existing] } });
        await chooseCourse(f, 0);
        await f.page.locator("[data-edit-layout]").click();
        const editor = f.page.locator(".hole-admin-dialog");
        await editor.locator("[data-scorecard-choice]").selectOption("0");
        await editor.locator("[data-use-scorecard]").click();
        assert.equal(await editor.locator('[name="reviewed"]').isChecked(), true, "An identical saved scorecard must not invalidate an unchanged checked hole");
        assert.match(await editor.locator("[data-review-count]").textContent(), /^17\s*\/\s*18/);
        await editor.locator("[data-scorecard-choice]").selectOption("1");
        await editor.locator("[data-use-scorecard]").click();
        assert.equal(await editor.locator('[name="tee_name"]').inputValue(), "Yellow", "This regression occurs even when the tee colour does not change");
        assert.equal(await editor.locator('[name="reviewed"]').isChecked(), false);
        assert.match(await editor.locator("[data-review-count]").textContent(), /^0\s*\/\s*18/);
        await editor.locator("[data-save-close]").click();
        await editor.waitFor({ state: "detached" });
        assert.ok(f.model.savedCourseLayouts[0].holes.every(hole => !hole.reviewed));
        await finish(f);
      }
    });

    await check("A single matching old course restores automatically without replacing its saved data", async () => {
      const legacy = { id: "55555555-5555-4555-8555-555555555555", name: courses[0].displayName.text, tee_name: "Yellow", hole_count: 18, mapped_count: 17 };
      const imported = { ...structuredClone(layoutFixture), id: "66666666-6666-4666-8666-666666666666", place_id: null, ready_count: 0, holes: layoutFixture.holes.map(hole => ({ ...structuredClone(hole), reviewed: false })) };
      const f = await setup(browser, { legacyMatches: { [courses[0].id]: [legacy] }, importedLayouts: { [legacy.id]: imported } });
      await chooseCourse(f, 0);
      await f.page.waitForFunction(id => document.querySelector('[name="course_layout_id"]').value === id, imported.id);
      assert.equal(f.model.setupRequests.filter(request => request.action === "import").length, 1);
      assert.equal(f.model.setupRequests.filter(request => request.action === "prepare_course").length, 0, "A known legacy course must not be replaced with newly scraped positions");
      assert.deepEqual(f.model.savedCourseLayouts[0].holes, imported.holes);
      assert.equal(f.model.savedCourseLayouts[0].place_id, courses[0].id);
      assert.equal(await f.page.locator(".hole-admin-dialog").count(), 0, "Restoration should not force open the editor");
      await finish(f);
    });
  } finally {
    fs.writeFileSync(path.join(out, "event-setup.json"), JSON.stringify({ passed: report.length, checks: report }, null, 2));
    await browser.close(); server.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
