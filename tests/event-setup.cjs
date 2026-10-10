/* Event authoring checks: real UI, isolated accounts/storage/course-provider fixtures. */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { fixture, server, root, out, backend, eventFixture } = require("./hole-view.cjs");

const courses = [
  { id: "place-course-a", displayName: { text: "Course Alpha" }, formattedAddress: "1 Golf Lane, Warwick, CV1 1AA", location: { latitude: 52.0001, longitude: -1.5 }, websiteUri: "https://alpha.example.invalid/", nationalPhoneNumber: "01926 111111" },
  { id: "place-course-b", displayName: { text: "Course Bravo" }, formattedAddress: "2 Golf Road, Warwick, CV2 2BB", location: { latitude: 52.2201, longitude: -1.2 }, websiteUri: "https://bravo.example.invalid/", nationalPhoneNumber: "01926 222222" },
];
const image = fs.readFileSync(path.join(root, "icon-logo.png"));
const picture = name => ({ name, mimeType: "image/png", buffer: image });
const unavailable = { status: "unavailable", scorecards: [], draft: null, message: "Accurate GPS data is not available for this course. The event can be saved without GPS." };
const readyFor = (place, key = "yellow", teeName = "Yellow") => ({
  status: "ready", scorecards: [{ key, course_name: place.displayName.text, tee_name: teeName }], message: "All 18 holes are mapped and ready to check.",
  draft: {
    name: place.displayName.text, tee_name: teeName, place_id: place.id,
    center: { lat: place.location.latitude, lng: place.location.longitude }, address: place.formattedAddress,
    holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, stroke_index: i + 1, yards: 280 + i, reviewed: false, tee: { lat: place.location.latitude + i * 0.0002, lng: place.location.longitude + i * 0.0002 }, green: { lat: place.location.latitude + i * 0.0002 + 0.002, lng: place.location.longitude + i * 0.0002 + 0.0004 }, front: null, back: null, dogleg: null })),
    source: { provider: "openstreetmap", attribution: "© OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright", validation: { status: "verified", mapped: 18, tee_anchors: 18, green_anchors: 18 }, selected_scorecard: { key, course_name: place.displayName.text, tee_name: teeName } },
  },
});

async function setup(browser, options = {}) {
  const f = await fixture(browser, {
    admin: true, width: options.width || 390,
    events: [{ ...eventFixture, course_layout_id: null, ...(options.event || {}) }], layout: null,
    prepare: async (context, model) => {
      Object.assign(model, { setupRequests: [], uploads: [], storageDeletes: [], savedCourseLayouts: [], heldMappings: new Set(), pendingMappings: new Map(), mappingReplies: options.mappingReplies || {}, courseLayoutSaveFailures: 0, eventFailures: 0, uploadFailures: 0, eventSaves: [] });
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
            const reply = model.mappingReplies[place.id] || unavailable;
            return route.fulfill({ json: typeof reply === "function" ? reply(body) : reply });
          }
        }
        if (p.endsWith("/rpc/baseline_course_layout")) {
          model.setupRequests.push(body);
          if (body.action === "get") return route.fulfill({ json: model.savedCourseLayouts.find(layout => layout.id === body.payload.id) || options.linkedLayout || null });
          if (["list", "match", "import"].includes(body.action)) {
            model.unexpected.push("Retired course lookup: " + body.action);
            return route.fulfill({ status: 400, json: { message: "Use fresh course preparation" } });
          }
          if (body.action === "save") {
            if (model.courseLayoutSaveFailures-- > 0) return route.fulfill({ status: 503, json: { message: "Hole map confirmation interrupted. Please try again." } });
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

async function settleMapping(f, index) {
  const response = f.page.waitForResponse(response => response.url().endsWith("/baseline-services") && response.request().postDataJSON().action === "prepare_course" && response.request().postDataJSON().place_id === courses[index].id);
  await chooseCourse(f, index);
  await (await response).finished();
  await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
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
    await check("The event form has one type and a required league round directly underneath", async () => {
      const f = await setup(browser, { width: 320 });
      const type = f.page.locator('[name="event_type"]'), round = f.page.locator('[name="round_number"]');
      assert.equal(await type.count(), 1);
      assert.equal(await round.count(), 1);
      assert.equal(await round.evaluate(element => element.required), true);
      assert.equal(await f.page.locator('[data-league-round]').isVisible(), true);
      assert.equal(await type.evaluate(element => element.closest("label").nextElementSibling.matches("[data-league-round]")), true);
      for (const name of ["member_price", "guest_price"]) assert.equal(await f.page.locator(`[name="${name}"]`).isVisible(), true);
      for (const name of ["arrival_time", "parking", "course_layout", "format_rules", "price"]) assert.equal(await f.page.locator(`[name="${name}"]`).count(), 0, name + " must be removed from the form");
      assert.equal(await f.page.locator("#courseQuery").evaluate(element => !!element.closest("details")), false, "Course information must be part of the main form");
      await round.selectOption("4");
      for (const category of ["pairs", "social"]) {
        await type.selectOption(category);
        assert.equal(await f.page.locator('[data-league-round]').isVisible(), false);
        assert.equal(await round.inputValue(), "");
        assert.equal(await round.evaluate(element => element.required), false);
        assert.equal(await round.isDisabled(), true);
      }
      await type.selectOption("league");
      assert.equal(await round.inputValue(), "", "Returning to league must ask for a round again");
      assert.equal(await round.evaluate(element => element.required), true);
      assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await f.page.screenshot({ path: path.join(out, "event-setup-mobile.png"), fullPage: true });
      await finish(f);
    });

    await check("Every new event automatically saves GPS even when its scorecard is unavailable", async () => {
      for (const index of [0, 1]) {
        const reply = readyFor(courses[index]);
        reply.scorecards = [];
        reply.draft.tee_name = "Mapped tee positions";
        reply.draft.source.setup_mode = "gps_only";
        reply.draft.source.par_source = "numbered_map_routes";
        delete reply.draft.source.selected_scorecard;
        Object.assign(reply.draft.source.validation, { scorecard_order_confirmed: false, order_evidence: "numbered_map_routes", method: "numbered_routes_with_verified_greens", route_starts: 18, tee_anchors: 15 });
        reply.draft.holes.forEach(h => Object.assign(h, { par: 4, yards: null, stroke_index: null }));
        const f = await setup(browser, { mappingReplies: { [courses[index].id]: reply } });
        assert.equal(await f.page.locator("#findCourse").textContent(), "Find course and GPS hole layout");
        await f.page.locator('[name="name"]').fill("New automatic GPS event " + index);
        await f.page.locator('[name="date"]').fill("2027-07-30");
        await f.page.locator('[name="round_number"]').selectOption("3");
        await settleMapping(f, index);
        await f.page.locator('[data-preview-layout]').click();
        await f.page.locator('dialog [data-hole="4"]').click();
        assert.match(await f.page.locator('[data-distance-origin]').textContent(), /mapped start reference/i);
        assert.match(await f.page.locator('[data-hole-stats]').textContent(), /Par \(map\)4/);
        await f.page.locator('[data-find-green]').click();
        await f.page.locator('[data-finder-start]').waitFor({ state: "visible" });
        assert.match(await f.page.locator('[data-finder-course]').textContent(), /Hole 4/);
        await f.page.locator('[data-finder-close]').click();
        await f.page.locator('[data-hole-close]').click();
        await saveEvent(f);
        assert.equal(f.model.savedCourseLayouts.length, 1);
        const saved = f.model.savedCourseLayouts[0];
        assert.equal(saved.place_id, courses[index].id);
        assert.equal(saved.source.setup_mode, "gps_only");
        assert.ok(saved.holes.every(h => h.reviewed && h.tee && h.green && h.yards === null));
        assert.equal(f.model.eventSave.course_layout_id, saved.id);
        await finish(f);
      }
    });

    await check("A league event cannot save without its round and persists the chosen round", async () => {
      const f = await setup(browser);
      await f.page.locator('[name="name"]').fill("Season round");
      await f.page.locator('[name="date"]').fill("2027-07-30");
      await saveEvent(f);
      assert.equal(await f.page.locator('[name="round_number"]').evaluate(element => element.validity.valueMissing), true);
      assert.equal(f.model.eventSaves.length, 0);
      await f.page.locator('[name="round_number"]').selectOption("3");
      await saveEvent(f);
      assert.equal(f.model.eventSave.round_number, 3);
      assert.equal(f.model.eventSave.event_type, "league");
      await finish(f);
    });

    await check("Simple member and guest prices save while retired briefing fields are cleared", async () => {
      const f = await setup(browser, { existing: true, event: { arrival_time: "08:00", parking: "Old parking instructions", course_layout: "Old loop description", format_rules: "Old playing rules" } });
      await f.page.locator('[name="member_price"]').fill("45");
      await f.page.locator('[name="guest_price"]').fill("55");
      await saveEvent(f);
      assert.equal(f.model.eventSave.member_price, 45);
      assert.equal(f.model.eventSave.guest_price, 55);
      for (const name of ["arrival_time", "parking", "course_layout", "format_rules", "price"]) assert.equal(f.model.eventSave[name], null, name + " must not survive invisibly on the saved event");
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

    await check("Fresh course lookup fills useful details; unavailable GPS never creates a blank layout", async () => {
      const f = await setup(browser, { existing: true });
      await settleMapping(f, 0);
      for (const [name, expected] of Object.entries({ course_name: courses[0].displayName.text, address: courses[0].formattedAddress, course_link: courses[0].websiteUri, course_phone: courses[0].nationalPhoneNumber, latitude: String(courses[0].location.latitude), longitude: String(courses[0].location.longitude), location: courses[0].displayName.text })) assert.equal(await f.page.locator(`[name="${name}"]`).inputValue(), expected);
      for (const name of ["latitude", "longitude", "location", "cover_url"]) assert.equal(await f.page.locator(`[name="${name}"]`).getAttribute("type"), "hidden");
      await f.page.getByText(unavailable.message, { exact: false }).waitFor();
      assert.equal(f.model.savedCourseLayouts.length, 0);
      assert.equal(await f.page.locator("[data-confirm-maps]").isVisible(), false);
      for (const selector of ["[data-new-layout]", "[data-import-layout]", "[data-legacy-layout]", "[data-admin-holes]"]) assert.equal(await f.page.locator(selector).count(), 0, "Retired manual/legacy setup must be absent");
      await saveEvent(f);
      assert.equal(f.model.eventSave.course_layout_id, null);
      assert.equal(f.model.setupRequests.filter(request => ["list", "match", "import", "save"].includes(request.action)).length, 0);
      await finish(f);
    });

    await check("Opening an existing event automatically selects Yellow mens tees and saves GPS with the event", async () => {
      const choices = ['White (men)', 'Yellow (men)', 'Yellow (women)', 'Red (women)'].map((tee_name, i) => ({ key: `alpha-${i}`, course_name: courses[0].displayName.text, tee_name }));
      const f = await setup(browser, { existing: true,
        event: { place_id: courses[0].id, course_name: courses[0].displayName.text },
        mappingReplies: { [courses[0].id]: body => {
          if (!body.scorecard_key) return { status: 'choice_required', scorecards: choices };
          assert.equal(body.scorecard_key, choices[1].key);
          return { ...readyFor(courses[0], choices[1].key, 'Yellow (men)'), scorecards: choices, selected_key: choices[1].key };
        } },
      });
      await f.page.locator('[data-preview-layout]').waitFor();
      assert.equal(await f.page.locator('[data-scorecard-choice]').inputValue(), choices[1].key);
      assert.equal(await f.page.locator('[data-course-prepare]').isVisible(), false);
      assert.equal(await f.page.locator('[data-confirm-maps]').count(), 0);
      assert.equal(f.model.savedCourseLayouts.length, 0);
      f.model.eventFailures = 1;
      await saveEvent(f);
      assert.equal(f.model.savedCourseLayouts.length, 1);
      assert.equal(f.model.eventSave, undefined);
      await saveEvent(f);
      assert.equal(f.model.savedCourseLayouts.length, 1, 'Event retry must reuse the prepared GPS layout');
      assert.equal(f.model.eventSave.course_layout_id, f.model.savedCourseLayouts[0].id);
      assert.equal(f.model.savedCourseLayouts[0].tee_name, 'Yellow (men)');
      assert.equal(f.model.savedCourseLayouts[0].source.confirmation_method, 'event_save');
      await finish(f);
    });

    await check("Save event waits for an in-progress automatic GPS lookup", async () => {
      const f = await setup(browser, { existing: true });
      f.model.mappingReplies[courses[0].id] = readyFor(courses[0]);
      f.model.heldMappings.add(courses[0].id);
      await chooseCourse(f, 0);
      await waitUntil(() => f.model.pendingMappings.has(courses[0].id), 'GPS lookup must be running');
      const saving = saveEvent(f);
      await f.page.waitForFunction(() => document.querySelector('#eventForm').inert);
      assert.equal(f.model.eventSaves.length, 0);
      f.model.releaseMapping(courses[0].id);
      await saving;
      assert.equal(f.model.savedCourseLayouts.length, 1);
      assert.equal(f.model.eventSave.course_layout_id, f.model.savedCourseLayouts[0].id);
      await finish(f);
    });

    await check("Multiple courses require a choice; GPS is then included in Save event", async () => {
      const f = await setup(browser, { existing: true });
      const choices = [{ key: "alpha-north-yellow", course_name: "Alpha North", tee_name: "Yellow" }, { key: "alpha-south-white", course_name: "Alpha South", tee_name: "White" }];
      f.model.mappingReplies[courses[0].id] = body => {
        if (!body.scorecard_key) return { status: "choice_required", scorecards: choices, draft: null, message: "Choose the correct course and tees." };
        const reply = readyFor(courses[0], body.scorecard_key, "White");
        reply.scorecards = choices; reply.selected_key = body.scorecard_key;
        reply.draft.name = choices[1].course_name;
        reply.draft.source.selected_scorecard.course_name = choices[1].course_name;
        return reply;
      };
      await settleMapping(f, 0);
      const choice = f.page.locator("[data-scorecard-choice]");
      await choice.waitFor();
      assert.equal(await choice.inputValue(), "");
      assert.equal(f.model.savedCourseLayouts.length, 0);
      assert.equal(await f.page.locator("[data-confirm-maps]").count(), 0);
      await saveEvent(f);
      assert.equal(f.model.eventSaves.length, 0, "Do not guess a layout at a multiple-course venue");
      const response = f.page.waitForResponse(response => response.url().endsWith("/baseline-services") && response.request().postDataJSON().scorecard_key === choices[1].key);
      await choice.selectOption(choices[1].key);
      await (await response).finished();
      await f.page.locator("[data-preview-layout]").waitFor();
      assert.equal(f.model.savedCourseLayouts.length, 0, "A ready preview must not save or publish itself");
      await saveEvent(f);
      await waitUntil(() => f.model.savedCourseLayouts.length === 1, "Confirmed maps should be saved once");
      const saved = f.model.savedCourseLayouts[0];
      assert.equal(saved.holes.length, 18);
      assert.ok(saved.holes.every(hole => hole.reviewed));
      assert.equal(saved.tee_name, "White");
      assert.equal(saved.name, choices[1].course_name);
      assert.equal(saved.source.selected_scorecard.key, choices[1].key);
      await saveEvent(f);
      assert.equal(f.model.eventSave.course_layout_id, saved.id);
      await finish(f);
    });

    await check("Malformed ready responses cannot save partial GPS maps", async () => {
      for (const mutate of [
        reply => { reply.draft.holes[17].green = null; },
        reply => { reply.draft.holes[0].yards = null; },
        reply => { reply.draft.holes[1].stroke_index = 1; },
        reply => { reply.draft.holes[1].green = reply.draft.holes[0].green; },
        reply => { reply.draft.source.validation.status = "partial"; },
      ]) {
        const f = await setup(browser, { existing: true });
        const reply = readyFor(courses[0]); mutate(reply);
        f.model.mappingReplies[courses[0].id] = reply;
        await settleMapping(f, 0);
        assert.equal(await f.page.locator("[data-confirm-maps]").isVisible(), false);
        assert.equal(f.model.savedCourseLayouts.length, 0);
        await saveEvent(f);
        assert.equal(f.model.eventSave.course_layout_id, null);
        await finish(f);
      }
    });

    await check("Late results from course A cannot replace a newly selected course B", async () => {
      const f = await setup(browser, { existing: true });
      f.model.mappingReplies[courses[0].id] = readyFor(courses[0]);
      f.model.mappingReplies[courses[1].id] = readyFor(courses[1]);
      f.model.heldMappings.add(courses[0].id);
      await chooseCourse(f, 0);
      await waitUntil(() => f.model.pendingMappings.has(courses[0].id), "Course A lookup should be in progress");
      await settleMapping(f, 1);
      await f.page.locator("[data-preview-layout]").waitFor();
      const completed = f.page.waitForResponse(response => response.url().endsWith("/baseline-services") && response.request().postDataJSON().action === "prepare_course" && response.request().postDataJSON().place_id === courses[0].id);
      f.model.releaseMapping(courses[0].id);
      await (await completed).finished();
      await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await saveEvent(f);
      await waitUntil(() => f.model.savedCourseLayouts.length === 1, "Course B should be the only saved map");
      assert.equal(f.model.savedCourseLayouts[0].place_id, courses[1].id);
      assert.equal(f.model.savedCourseLayouts[0].name, courses[1].displayName.text);
      assert.equal(await f.page.locator('[name="course_name"]').inputValue(), courses[1].displayName.text);
      await finish(f);
    });

    await check("Switching to a social event cancels pending GPS preparation without a stale save", async () => {
      const f = await setup(browser, { existing: true });
      f.model.mappingReplies[courses[0].id] = readyFor(courses[0]);
      f.model.heldMappings.add(courses[0].id);
      await chooseCourse(f, 0);
      await waitUntil(() => f.model.pendingMappings.has(courses[0].id), "Course lookup should be in progress");
      await f.page.locator('[name="event_type"]').selectOption("social");
      const completed = f.page.waitForResponse(response => response.url().endsWith("/baseline-services") && response.request().postDataJSON().action === "prepare_course");
      f.model.releaseMapping(courses[0].id);
      await (await completed).finished();
      await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await f.page.locator("[data-confirm-maps]").isVisible(), false);
      assert.equal(f.model.savedCourseLayouts.length, 0);
      await saveEvent(f);
      assert.equal(f.model.eventSave.event_type, "social");
      assert.equal(f.model.eventSave.round_number, null);
      assert.equal(f.model.eventSave.course_layout_id, null);
      await finish(f);
    });

    await check("A failed GPS save blocks the event and can be retried", async () => {
      const f = await setup(browser, { existing: true });
      f.model.mappingReplies[courses[0].id] = readyFor(courses[0]);
      f.model.courseLayoutSaveFailures = 1;
      await settleMapping(f, 0);
      await saveEvent(f);
      await f.page.getByText(/Hole map confirmation interrupted/).first().waitFor();
      assert.equal(f.model.eventSaves.length, 0, "Do not save the event if saving its prepared GPS fails");
      assert.equal(f.model.savedCourseLayouts.length, 0);
      await saveEvent(f);
      await waitUntil(() => f.model.savedCourseLayouts.length === 1, "Retry should save the confirmed layout");
      assert.equal(f.model.setupRequests.filter(request => request.action === "save").length, 2);
      assert.equal(f.model.savedCourseLayouts[0].ready_count, 18);
      await finish(f);
    });

  } finally {
    fs.writeFileSync(path.join(out, "event-setup.json"), JSON.stringify({ passed: report.length, checks: report }, null, 2));
    await browser.close(); server.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
