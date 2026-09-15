(() => {
  "use strict";

  const client = window.BarfordSupabase;
  const form = document.getElementById("adminEventForm");
  if (!client || !form) return;

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
  const normalise = value => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const status = message => {
    const element = $("createEventCourseStatus");
    if (element) element.textContent = message;
  };
  const invoke = async body => {
    const { data, error } = await client.functions.invoke("uk-golf-course", { body });
    if (error) {
      let detail = "";
      try {
        if (error.context?.clone) detail = (await error.context.clone().json())?.error || "";
      } catch {}
      throw new Error(detail || data?.error || error.message || "Course lookup failed.");
    }
    if (data?.error) throw new Error(data.error);
    return data || {};
  };

  const state = {
    location: null,
    clubs: [],
    courses: [],
    teeSets: [],
    holes: null,
    clubId: "",
    courseId: "",
    courseName: "",
    existingReady: false
  };

  const actions = form.querySelector(".admin-form-actions");
  if (!actions) return;

  const builder = document.createElement("section");
  builder.className = "admin-event-course-builder wide";
  builder.innerHTML = `
    <div class="event-course-builder-head">
      <div>
        <p class="eyebrow">Scoring setup</p>
        <h4>Prepare the course scorecard now</h4>
        <p>Recommended. Load the men’s and women’s cards while creating the event so event day is already prepared.</p>
      </div>
      <span id="createEventCourseBadge" class="event-course-setup-badge">Not prepared</span>
    </div>
    <div class="event-course-setup-actions">
      <button id="createEventFindScoringCourse" class="button button-outline" type="button">Find scoring card</button>
      <span id="createEventCourseStatus" class="field-help">Choose the golf course above first, then load its scoring card.</span>
    </div>
    <div id="createEventCourseFields" class="event-course-fields hidden">
      <label>Golf club<select id="createEventGolfClub"><option value="">Select club</option></select></label>
      <label>Course<select id="createEventGolfCourse" disabled><option value="">Select club first</option></select></label>
      <label>Men’s tee<select id="createEventYellowTee" disabled><option value="">Load course first</option></select></label>
      <label>Women’s tee<select id="createEventRedTee" disabled><option value="">Load course first</option></select></label>
      <button id="createEventUseTees" class="button button-primary wide" type="button" disabled>Use these tees</button>
    </div>
    <div id="createEventCourseReady" class="event-course-ready hidden" role="status" aria-live="polite">
      <span class="event-course-ready-icon" aria-hidden="true">✓</span>
      <div><strong>Course scorecard ready</strong><small id="createEventCourseSummary">18 holes loaded.</small></div>
    </div>
    <div id="createEventCompetitionFields" class="event-course-competitions hidden">
      <div><strong>Event-day competitions</strong><small>Optional — these can still be changed later.</small></div>
      <label>Longest Drive<select id="createEventLongestDrive"><option value="">Not selected</option></select></label>
      <label>Nearest the Pin<select id="createEventNearestPin"><option value="">Not selected</option></select></label>
    </div>`;
  actions.before(builder);

  const style = document.createElement("style");
  style.textContent = `
    .admin-event-course-builder{margin-top:8px;padding:20px;border:1px solid #dfe7e2;border-radius:18px;background:#f8faf8}
    .event-course-builder-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}
    .event-course-builder-head h4{margin:2px 0 5px;font-size:1.18rem}.event-course-builder-head p:last-child{margin:0;color:#67736d;font-size:.9rem}
    .event-course-setup-badge{flex:none;padding:7px 10px;border-radius:999px;background:#ecefed;color:#66706b;font-size:.74rem;font-weight:900}
    .event-course-setup-badge.ready{background:#dff2e7;color:#0b5c39}.event-course-setup-badge.loading{background:#fff1c9;color:#775b13}
    .event-course-setup-actions{display:flex;align-items:center;gap:14px;margin-top:16px}.event-course-setup-actions .field-help{margin:0}
    .event-course-fields{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px}.event-course-fields label{display:grid;gap:6px;font-weight:800}.event-course-fields select{min-height:50px}
    .event-course-fields .wide{grid-column:1/-1}.event-course-ready{display:flex;align-items:center;gap:12px;margin-top:16px;padding:14px;border-radius:15px;background:#eaf6ef;color:#073d2c}.event-course-ready-icon{display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:#073d2c;color:#fff;font-weight:900}.event-course-ready strong,.event-course-ready small{display:block}.event-course-ready small{margin-top:2px;color:#517063}
    .event-course-competitions{display:grid;grid-template-columns:minmax(180px,1fr) 1fr 1fr;align-items:end;gap:12px;margin-top:14px;padding-top:14px;border-top:1px solid #dfe7e2}.event-course-competitions strong,.event-course-competitions small{display:block}.event-course-competitions small{margin-top:3px;color:#6b766f;font-size:.8rem}.event-course-competitions label{display:grid;gap:6px;font-weight:800}
    @media(max-width:700px){.admin-event-course-builder{padding:16px}.event-course-builder-head{flex-direction:column;gap:10px}.event-course-setup-actions{align-items:stretch;flex-direction:column}.event-course-setup-actions .button{width:100%}.event-course-fields{grid-template-columns:1fr}.event-course-fields .wide{grid-column:auto}.event-course-competitions{grid-template-columns:1fr}.event-course-competitions>div{margin-bottom:2px}}
  `;
  document.head.appendChild(style);

  const badge = (label, mode = "") => {
    const element = $("createEventCourseBadge");
    if (!element) return;
    element.textContent = label;
    element.classList.toggle("ready", mode === "ready");
    element.classList.toggle("loading", mode === "loading");
  };

  const optionMarkup = (items, prompt) => `<option value="">${esc(prompt)}</option>${items.map(item =>
    `<option value="${esc(item.id)}">${esc(item.name)}${item.tee_sets ? ` — ${Math.max(0, ...(item.tee_sets || []).map(tee => tee.holes?.length || 0))} holes` : item.county ? ` · ${esc(item.county)}` : ""}</option>`
  ).join("")}`;

  const scorecardHoleOptions = () => '<option value="">Not selected</option>' +
    Array.from({ length: 18 }, (_, index) => `<option value="${index + 1}">Hole ${index + 1}</option>`).join("");

  const resetCourseBuilder = () => {
    state.location = null;
    state.clubs = [];
    state.courses = [];
    state.teeSets = [];
    state.holes = null;
    state.clubId = "";
    state.courseId = "";
    state.courseName = "";
    state.existingReady = false;
    $("createEventCourseFields")?.classList.add("hidden");
    $("createEventCourseReady")?.classList.add("hidden");
    $("createEventCompetitionFields")?.classList.add("hidden");
    $("createEventGolfClub").innerHTML = '<option value="">Select club</option>';
    $("createEventGolfCourse").innerHTML = '<option value="">Select club first</option>';
    $("createEventYellowTee").innerHTML = '<option value="">Load course first</option>';
    $("createEventRedTee").innerHTML = '<option value="">Load course first</option>';
    $("createEventGolfCourse").disabled = true;
    $("createEventYellowTee").disabled = true;
    $("createEventRedTee").disabled = true;
    $("createEventUseTees").disabled = true;
    $("createEventLongestDrive").innerHTML = scorecardHoleOptions();
    $("createEventNearestPin").innerHTML = scorecardHoleOptions();
    badge("Not prepared");
    status("Choose the golf course above first, then load its scoring card.");
  };

  const bestNameMatch = (items, searchText) => {
    const target = normalise(searchText);
    if (!target) return null;
    return items.find(item => {
      const candidate = normalise(item.name);
      return candidate && (target.includes(candidate) || candidate.includes(target));
    }) || null;
  };

  const resolveLocation = async () => {
    const eventId = $("adminEventId")?.value;
    if (eventId) {
      const { data } = await client.from("events")
        .select("latitude,longitude,name,venue,uk_golf_club_id,uk_golf_course_id,selected_course_name")
        .eq("id", eventId).maybeSingle();
      if (data && Number.isFinite(Number(data.latitude)) && Number.isFinite(Number(data.longitude))) {
        state.location = {
          latitude: Number(data.latitude), longitude: Number(data.longitude),
          name: data.venue || data.name || "Golf course"
        };
        return state.location;
      }
    }

    const query = $("adminCourseSearch")?.value.trim() || $("adminEventVenue")?.value.trim() || $("adminEventName")?.value.trim();
    if (!query) throw new Error("Choose the golf course above first.");
    const { data, error } = await client.functions.invoke("course-lookup", { body: { query } });
    if (error || !Array.isArray(data?.courses) || !data.courses.length) {
      throw new Error("I couldn’t locate that course. Select it from the Find golf course box above first.");
    }
    const match = bestNameMatch(data.courses, query) || data.courses[0];
    let course = match;
    if (match.place_id) {
      const details = await client.functions.invoke("course-lookup", { body: { place_id: match.place_id } });
      if (!details.error && details.data?.course) course = details.data.course;
    }
    if (!Number.isFinite(Number(course.latitude)) || !Number.isFinite(Number(course.longitude))) {
      throw new Error("That course does not have a usable map location yet.");
    }
    state.location = {
      latitude: Number(course.latitude), longitude: Number(course.longitude),
      name: course.name || query
    };
    return state.location;
  };

  const loadTees = courseId => {
    const course = state.courses.find(item => String(item.id) === String(courseId));
    state.courseId = courseId || "";
    state.courseName = course?.name || "";
    state.teeSets = course?.tee_sets || [];
    const html = optionMarkup(state.teeSets, "Select tee");
    $("createEventYellowTee").innerHTML = html;
    $("createEventRedTee").innerHTML = html;
    $("createEventYellowTee").disabled = !state.teeSets.length;
    $("createEventRedTee").disabled = !state.teeSets.length;
    const yellow = state.teeSets.find(tee => /yellow/i.test(tee.name)) || state.teeSets.find(tee => /men|male/i.test(tee.gender));
    const red = state.teeSets.find(tee => /red/i.test(tee.name)) || state.teeSets.find(tee => /women|female/i.test(tee.gender));
    if (yellow) $("createEventYellowTee").value = yellow.id;
    if (red) $("createEventRedTee").value = red.id;
    $("createEventUseTees").disabled = !(yellow && red);
    status(yellow && red ? "Yellow and Red tees found. Press Use these tees." : "Choose the men’s and women’s tees, then press Use these tees.");
  };

  const loadCourses = async clubId => {
    if (!clubId) return;
    state.clubId = clubId;
    status("Loading this club’s courses…");
    const data = await invoke({ action: "courses", club_id: clubId });
    state.courses = data.courses || [];
    $("createEventGolfCourse").innerHTML = optionMarkup(state.courses, "Select course");
    $("createEventGolfCourse").disabled = !state.courses.length;
    if (!state.courses.length) throw new Error("No course cards were returned for this club.");
    const searchText = `${$("adminEventName")?.value || ""} ${$("adminEventVenue")?.value || ""} ${$("adminCourseSearch")?.value || ""}`;
    const match = bestNameMatch(state.courses, searchText) || (state.courses.length === 1 ? state.courses[0] : null);
    if (match) {
      $("createEventGolfCourse").value = match.id;
      loadTees(match.id);
    } else {
      status("This club has more than one course. Select the one being played.");
    }
  };

  $("createEventFindScoringCourse").addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Finding card…";
    badge("Finding…", "loading");
    state.holes = null;
    $("createEventCourseReady").classList.add("hidden");
    $("createEventCompetitionFields").classList.add("hidden");
    try {
      const location = await resolveLocation();
      status("Matching this location with the golf scoring database…");
      const searchText = `${$("adminEventName")?.value || ""} ${$("adminEventVenue")?.value || ""}`.trim();
      const data = await invoke({ action: "nearby", latitude: location.latitude, longitude: location.longitude, query: searchText });
      state.clubs = data.clubs || [];
      if (!state.clubs.length) throw new Error("No scoring database match was found near this course.");
      $("createEventCourseFields").classList.remove("hidden");
      $("createEventGolfClub").innerHTML = optionMarkup(state.clubs, "Select golf club");
      const match = bestNameMatch(state.clubs, searchText) || (state.clubs.length === 1 ? state.clubs[0] : null);
      if (match) {
        $("createEventGolfClub").value = match.id;
        await loadCourses(match.id);
      } else {
        status("Select the correct golf club.");
      }
      badge("Choose tees", "loading");
    } catch (error) {
      status(error.message);
      badge("Needs attention");
    } finally {
      button.disabled = false;
      button.textContent = state.existingReady ? "Replace scoring card" : "Find scoring card";
    }
  });

  $("createEventGolfClub").addEventListener("change", async event => {
    try { await loadCourses(event.target.value); } catch (error) { status(error.message); }
  });
  $("createEventGolfCourse").addEventListener("change", event => loadTees(event.target.value));
  ["createEventYellowTee", "createEventRedTee"].forEach(id => $(id).addEventListener("change", () => {
    $("createEventUseTees").disabled = !$("createEventYellowTee").value || !$("createEventRedTee").value;
  }));

  $("createEventUseTees").addEventListener("click", async event => {
    const button = event.currentTarget;
    const yellow = state.teeSets.find(tee => String(tee.id) === String($("createEventYellowTee").value));
    const red = state.teeSets.find(tee => String(tee.id) === String($("createEventRedTee").value));
    if (!yellow || !red || !state.courseId) return;
    button.disabled = true;
    button.textContent = "Loading 18 holes…";
    status("Downloading the selected men’s and women’s scorecards…");
    try {
      const data = await invoke({
        action: "scorecard",
        course_id: state.courseId,
        yellow_tee_id: yellow.id,
        red_tee_id: red.id
      });
      const cards = data.tee_sets || [];
      const yellowCard = cards[0], redCard = cards[1];
      if (!yellowCard || !redCard) throw new Error("Both tee scorecards were not returned.");
      const redByHole = new Map((redCard.holes || []).map(item => [Number(item.hole), item]));
      const holes = (yellowCard.holes || []).map(item => {
        const redHole = redByHole.get(Number(item.hole));
        return {
          hole_number: Number(item.hole),
          par: Number(item.par), yards: Number(item.yards), stroke_index: Number(item.stroke_index),
          red_par: Number(redHole?.par), red_yards: Number(redHole?.yards), red_stroke_index: Number(redHole?.stroke_index),
          yellow_tee_name: yellowCard.name || yellow.name || "Yellow",
          red_tee_name: redCard.name || red.name || "Red"
        };
      });
      const yellowIndexes = holes.map(item => item.stroke_index);
      const redIndexes = holes.map(item => item.red_stroke_index);
      const incomplete = holes.length !== 18 || holes.some(item =>
        !item.par || !item.yards || !item.stroke_index || !item.red_par || !item.red_yards || !item.red_stroke_index
      );
      if (incomplete || new Set(yellowIndexes).size !== 18 || new Set(redIndexes).size !== 18) {
        throw new Error("This course card is incomplete, so it cannot safely calculate Stableford points. Use Event Scoring to correct it manually.");
      }
      state.holes = holes;
      const yellowYards = holes.reduce((sum, item) => sum + item.yards, 0);
      const redYards = holes.reduce((sum, item) => sum + item.red_yards, 0);
      const par = holes.reduce((sum, item) => sum + item.par, 0);
      $("createEventCourseSummary").textContent = `${state.courseName || "Course"} · 18 holes · Par ${par} · ${yellowYards.toLocaleString("en-GB")} yd men · ${redYards.toLocaleString("en-GB")} yd women`;
      $("createEventCourseReady").classList.remove("hidden");
      $("createEventCompetitionFields").classList.remove("hidden");
      $("createEventLongestDrive").innerHTML = scorecardHoleOptions();
      $("createEventNearestPin").innerHTML = scorecardHoleOptions();
      badge("Course ready", "ready");
      status("Ready. Saving the event will also save this complete course scorecard.");
    } catch (error) {
      state.holes = null;
      badge("Needs attention");
      status(error.message.includes("429") ? "The course service has hit its request limit. Wait a minute and try again." : error.message);
    } finally {
      button.disabled = false;
      button.textContent = "Use these tees";
    }
  });

  const nextRoundNumber = async () => {
    const { data } = await client.from("rounds").select("round_number").eq("season", 2027);
    const used = new Set((data || []).map(round => Number(round.round_number)).filter(Number.isFinite));
    for (let round = 1; round <= 7; round += 1) if (!used.has(round)) return round;
    return Math.max(0, ...used) + 1;
  };

  const field = id => $(id)?.value ?? "";
  const savePreparedEvent = async submitEvent => {
    if (!state.holes) return;
    submitEvent.preventDefault();
    submitEvent.stopImmediatePropagation();

    const submitButton = form.querySelector('button[type="submit"]');
    const statusElement = $("adminEventStatus");
    const id = field("adminEventId");
    submitButton.disabled = true;
    submitButton.textContent = "Saving event & scorecard…";
    if (statusElement) statusElement.textContent = "Creating the event and attaching its course scorecard…";

    try {
      const payload = {
        name: field("adminEventName").trim(),
        venue: field("adminEventVenue").trim(),
        address: field("adminEventAddress").trim() || null,
        event_date: field("adminEventDate"),
        first_tee_time: field("adminEventFirstTee") || null,
        price: field("adminEventPrice") || null,
        guest_price: field("adminEventGuestPrice") || null,
        course_member_price: field("adminEventCourseMemberPrice") || null,
        capacity: field("adminEventCapacity") || null,
        course_video_url: field("adminEventVideo").trim() || null,
        notes: field("adminEventNotes").trim() || null,
        latitude: state.location?.latitude ?? null,
        longitude: state.location?.longitude ?? null,
        updated_at: new Date().toISOString()
      };
      if (!id) {
        payload.status = "scheduled";
        payload.round_number = await nextRoundNumber();
      }
      const result = id
        ? await client.from("events").update(payload).eq("id", id).select("id").single()
        : await client.from("events").insert(payload).select("id").single();
      if (result.error) throw result.error;
      const eventId = result.data.id;
      if (!id) $("adminEventId").value = eventId;

      const longestDrive = Number(field("createEventLongestDrive")) || null;
      const nearestPin = Number(field("createEventNearestPin")) || null;
      const holes = state.holes.map(item => ({
        ...item,
        event_id: eventId,
        longest_drive: item.hole_number === longestDrive,
        nearest_pin: item.hole_number === nearestPin
      }));
      const holeResult = await client.from("event_holes").upsert(holes, { onConflict: "event_id,hole_number" });
      if (holeResult.error) throw holeResult.error;
      const clubName = $("createEventGolfClub")?.selectedOptions?.[0]?.textContent?.replace(/ · .*$/, "").trim() || payload.venue || payload.name;
      const men = { name: holes[0]?.yellow_tee_name || "Yellow", holes: holes.map(h => ({ hole: h.hole_number, par: h.par, yards: h.yards, stroke_index: h.stroke_index })) };
      const women = { name: holes[0]?.red_tee_name || "Red", holes: holes.map(h => ({ hole: h.hole_number, par: h.red_par, yards: h.red_yards, stroke_index: h.red_stroke_index })) };
      await window.BarfordCourseLayouts.saveLayout({ eventId, clubName, layoutName: state.courseName, externalClubId: state.clubId, externalCourseId: state.courseId, men, women });

      badge("Course ready", "ready");
      if (statusElement) statusElement.textContent = `${id ? "Event updated" : "Event created"} — course scorecard ready (18/18 holes).`;
      submitButton.textContent = "Saved ✓";
      setTimeout(() => window.location.reload(), 650);
    } catch (error) {
      if (statusElement) statusElement.textContent = `The event was not fully saved: ${error.message}`;
      submitButton.disabled = false;
      submitButton.textContent = "Save event";
    }
  };

  form.addEventListener("submit", savePreparedEvent, true);

  $("adminEventReset")?.addEventListener("click", () => setTimeout(resetCourseBuilder, 0));

  document.addEventListener("click", event => {
    const edit = event.target.closest("[data-edit-event]");
    if (!edit) return;
    setTimeout(async () => {
      resetCourseBuilder();
      const eventId = $("adminEventId")?.value;
      if (!eventId) return;
      const [{ data: eventData }, { data: holes }] = await Promise.all([
        client.from("events").select("latitude,longitude,uk_golf_club_id,uk_golf_course_id,selected_course_name").eq("id", eventId).maybeSingle(),
        client.from("event_holes").select("hole_number,longest_drive,nearest_pin").eq("event_id", eventId).order("hole_number")
      ]);
      if (eventData && Number.isFinite(Number(eventData.latitude)) && Number.isFinite(Number(eventData.longitude))) {
        state.location = { latitude: Number(eventData.latitude), longitude: Number(eventData.longitude) };
      }
      if ((holes || []).length === 18) {
        state.existingReady = true;
        state.clubId = eventData?.uk_golf_club_id || "";
        state.courseId = eventData?.uk_golf_course_id || "";
        state.courseName = eventData?.selected_course_name || "Course";
        badge("Course ready", "ready");
        $("createEventCourseReady").classList.remove("hidden");
        $("createEventCourseSummary").textContent = `${state.courseName} · 18 holes already saved`;
        status("This event already has a complete scorecard. Use Replace scoring card only if the course card needs changing.");
        $("createEventFindScoringCourse").textContent = "Replace scoring card";
      }
    }, 0);
  });

  resetCourseBuilder();
})();
