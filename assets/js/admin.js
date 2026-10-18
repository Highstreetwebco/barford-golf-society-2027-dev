import { mountHoleSetup } from "./hole-admin.js?v=2027-map-format-3";
import { mountCoverUpload } from "./event-cover.js?v=2027-event-setup-1";
import { eventFields, updateEventType } from "./event-fields.js?v=2027-accurate-gps-1";
import { showLeagueTab, canLeaveLeague, clearLeagueAdmin } from "./league-admin.js?v=2027-simple-1";
import { loadAccounts } from "./account-admin.js?v=2027-simple-1";
import { packPlayers } from "./tee-groups.js?v=2027-results-1";
import { operation } from "./operations.js?v=2027-results-1";

const b = await window.barfordReady, { client: c, escape: e } = b;
const $ = id => document.getElementById(id);
const gate = $("adminGate"), content = $("adminContent"), form = $("eventForm"), picker = $("adminEvent");
const panels = { details: "adminDetails", responses: "adminResponses", tees: "adminTees", scoring: "adminScoring", accounts: "adminAccounts" };
let events = [], selected = null, rows = [], groups = [], activeTab = "details", groupsLoadedFor = null;
let eventDirty = false, teeDirty = false, savingEvent = false, responseBusy = false, teeBusy = false;
let courseGeneration = 0, coursePending = false, holeSetup, coverUpload;
const isBusy = () => savingEvent || responseBusy || teeBusy;
window.addEventListener("barford-signout", () => {
  ++courseGeneration; eventDirty = teeDirty = savingEvent = responseBusy = teeBusy = false;
  events = []; rows = []; groups = []; selected = null;
  clearLeagueAdmin();
  document.querySelectorAll("dialog").forEach(dialog => { dialog.close(); dialog.remove(); });
  content.hidden = true; content.replaceChildren(); gate.hidden = false;
  gate.innerHTML = '<h2>Signed out</h2><p>Sign in with an admin account to continue.</p><a class="button" href="account.html?next=admin.html">Sign in</a>';
});
function updateCourseReadOnly() {
  form.elements.course_name.readOnly = !!form.elements.place_id.value && form.elements.event_type.value !== "social";
}
const britishToday = () => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = key => parts.find(p => p.type === key).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
};
function setSaveState(id, text, state = "saved") { $(id).textContent = text; $(id).dataset.state = state; }
function markEventDirty() { eventDirty = true; setSaveState("eventSaveState", "Unsaved changes", "unsaved"); }
function syncControls() {
  picker.disabled = isBusy(); $("newEvent").disabled = isBusy();
  document.querySelectorAll(".admin-tabs button").forEach(button => button.disabled = isBusy());
  $("saveTees").disabled = teeBusy || !groups.some(g => g.players.length) || !!selected?.cancelled;
}
function updateEventSummary() {
  $("adminEventSummary").textContent = selected
    ? `${selected.round_number ? "Round " + selected.round_number + " · " : ""}${b.date(selected.date)}${selected.cancelled ? " · Cancelled" : ""}${selected.round_number >= 6 ? " · Scores remain private to admins" : ""}`
    : "Create an event to start taking RSVPs.";
  $("viewAdminEvent").href = selected ? `event.html?id=${selected.id}` : "events.html";
  $("viewAdminEvent").textContent = selected ? "View event" : "View events";
}
function canChangeEvent() {
  if (isBusy()) { b.toast("Please wait until saving has finished."); return false; }
  if ((eventDirty || teeDirty) && !confirm("There are unsaved event or tee time changes. Change event without saving?")) return false;
  return canLeaveLeague();
}
window.addEventListener("beforeunload", ev => {
  if (eventDirty || teeDirty || isBusy()) { ev.preventDefault(); ev.returnValue = ""; }
});
if (!b.state.admin) {
  gate.innerHTML = `<h2>Admin sign in</h2><p>${b.state.user ? "Your account does not have admin access." : "Sign in with your admin account to manage the society."}</p><a class="button" href="account.html?next=admin.html">${b.state.user ? "My account" : "Sign in"}</a>`;
} else {
  coverUpload = mountCoverUpload(form, b);
  holeSetup = mountHoleSetup(form, b);
  form.elements.event_type.addEventListener("change", () => { updateEventType(form); updateCourseReadOnly(); });
  form.addEventListener("input", markEventDirty);
  form.addEventListener("change", markEventDirty);
  picker.onchange = () => changeEvent(picker.value);
  $("newEvent").onclick = () => changeEvent("", true);
  document.querySelectorAll(".admin-tabs button").forEach(button => {
    button.onclick = () => showTab(button.dataset.tab);
    button.onkeydown = async ev => {
      const tabs = [...document.querySelectorAll(".admin-tabs button")], i = tabs.indexOf(button);
      const index = ev.key === "ArrowRight" ? (i + 1) % tabs.length : ev.key === "ArrowLeft" ? (i + tabs.length - 1) % tabs.length : ev.key === "Home" ? 0 : ev.key === "End" ? tabs.length - 1 : null;
      if (index == null) return;
      ev.preventDefault();
      if (await showTab(tabs[index].dataset.tab)) tabs[index].focus();
    };
  });
  form.onsubmit = saveEvent;
  $("cancelEvent").onclick = cancelEvent;
  $("findCourse").onclick = findCourse;
  $("courseQuery").onkeydown = ev => { if (ev.key === "Enter") { ev.preventDefault(); findCourse(); } };
  $("refreshRsvps").onclick = loadResponses;
  $("generateTees").onclick = generate;
  $("loadTees").onclick = () => loadGroups(false);
  $("saveTees").onclick = saveGroups;
  $("teeStart").onchange = updateGroupTimes;
  $("teeGap").onchange = updateGroupTimes;
  $("scorecardTools").ontoggle = () => {
    if ($("scorecardTools").open && activeTab === "tees") showLeagueTab("scorecards", selected);
  };
  $("memberRecovery").ontoggle = () => { if ($("memberRecovery").open) loadMemberRecovery(); };
  window.addEventListener("barford:members-updated", () => { if (activeTab === "accounts") loadAccounts(); });
  window.addEventListener("barford:member-account-saved", () => { if (activeTab === "accounts") showLeagueTab("handicaps", selected); });
  try {
    await loadEvents();
    const params = new URLSearchParams(location.search), requested = params.get("event") || params.get("id");
    selected = events.find(ev => String(ev.id) === requested) || events.find(ev => !ev.cancelled && ev.date >= britishToday()) || [...events].reverse().find(ev => !ev.cancelled) || null;
    fillEvent();
    gate.hidden = true; content.hidden = false;
    const initial = params.get("tab"), tab = initial === "handicaps" ? "accounts" : initial === "scorecards" ? "tees" : panels[initial] ? initial : "details";
    await showTab(tab, true);
    if (initial === "scorecards") $("scorecardTools").open = true;
  } catch (error) {
    gate.innerHTML = b.empty("Could not load admin.", error.message) + '<button type="button" class="secondary" id="retryAdmin">Try again</button>';
    $("retryAdmin").onclick = () => location.reload();
  }
}
async function loadEvents() {
  const { data, error } = await c.from("events").select("*").order("date");
  if (error) throw error;
  events = data || [];
  renderEventPicker();
}
function mergeSavedEvent(data) {
  selected = data;
  events = [...events.filter(ev => ev.id !== data.id), data].sort((a, z) => a.date.localeCompare(z.date));
  renderEventPicker();
}
function renderEventPicker() {
  picker.innerHTML = '<option value="">New event</option>' + events.map(ev => `<option value="${ev.id}">${ev.round_number ? "Round " + ev.round_number + " · " : ""}${e(ev.name)} · ${e(b.date(ev.date))}${ev.cancelled ? " · Cancelled" : ""}</option>`).join("");
  picker.value = selected?.id || "";
}
async function changeEvent(id, newEvent = false) {
  if (!canChangeEvent()) { picker.value = selected?.id || ""; return; }
  selected = events.find(ev => String(ev.id) === String(id)) || null;
  groups = []; rows = []; groupsLoadedFor = null; teeDirty = false;
  $("teeEditor").innerHTML = ""; $("teeMessage").textContent = "";
  $("scorecardTools").open = false; $("adminScorecards").innerHTML = "";
  $("copyTeeUpdate")?.remove();
  fillEvent();
  await showTab(newEvent ? "details" : activeTab, true);
}
function fillEvent() {
  ++courseGeneration; coursePending = false;
  form.reset();
  for (const [key, value] of Object.entries(selected || {})) if (form.elements[key]) form.elements[key].value = value ?? "";
  if (!selected) form.elements.round_number.value = String([1,2,3,4,5,6,7].find(n => !events.some(ev => ev.round_number === n)) || "");
  picker.value = selected?.id || "";
  $("findCourse").disabled = false; $("courseResults").innerHTML = ""; $("courseLookupStatus").textContent = "";
  $("courseQuery").value = selected?.course_name || "";
  $("eventManagement").hidden = !selected;
  $("cancelEvent").textContent = selected?.cancelled ? "Reopen event" : "Cancel event";
  $("teeStart").value = /^\d{2}:\d{2}/.test(selected?.first_time || "") ? selected.first_time.slice(0, 5) : "09:00";
  $("teeGap").value = selected?.tee_interval || 8;
  updateEventType(form); updateCourseReadOnly(); coverUpload.reset(selected);
  holeSetup.setEvent(selected).catch(error => { $("courseLookupStatus").textContent = error.message; });
  eventDirty = false;
  setSaveState("eventSaveState", selected ? "Saved" : "New event", selected ? "saved" : "new");
  setSaveState("teeSaveState", selected?.tee_times_dirty ? "RSVPs changed · review groups" : selected?.tee_published_at ? "Published" : "Not published", selected?.tee_times_dirty ? "unsaved" : "saved");
  form.querySelector(".form-status").textContent = "";
  updateEventSummary(); syncControls();
}
async function showTab(tab, force = false) {
  if (!panels[tab]) return false;
  if (!force && (isBusy() || !canLeaveLeague())) return false;
  activeTab = tab;
  for (const [name, id] of Object.entries(panels)) $(id).hidden = name !== tab;
  document.querySelectorAll(".admin-tabs button").forEach(button => {
    const active = button.dataset.tab === tab;
    button.classList.toggle("active", active); button.setAttribute("aria-selected", String(active)); button.tabIndex = active ? 0 : -1;
  });
  if (tab === "scoring") await showLeagueTab("scoring", selected);
  else if (tab === "accounts") await Promise.all([loadAccounts(), showLeagueTab("handicaps", selected)]);
  else {
    await showLeagueTab(tab, selected);
    if (tab === "responses") await loadResponses();
    if (tab === "tees" && groupsLoadedFor !== selected?.id) await loadGroups(true);
    if (tab === "tees" && $("scorecardTools").open) await showLeagueTab("scorecards", selected);
  }
  return true;
}
async function saveEvent(ev) {
  ev.preventDefault();
  if (isBusy()) return;
  const invalid = form.querySelector(":invalid");
  if (invalid) { const details = invalid.closest("details"); if (details) details.open = true; }
  if (!form.reportValidity()) return;
  const status = form.querySelector(".form-status");
  savingEvent = true; form.inert = true; syncControls();
  setSaveState("eventSaveState", "Saving…", "saving"); status.textContent = "Saving event…";
  try {
    if (coursePending) throw new Error("Course details are still loading. Please save in a moment.");
    const f = new FormData(form), name = String(f.get("name") || "").trim();
    if (!name) throw new Error("Enter an event name.");
    const round = f.get("event_type") === "league" ? Number(f.get("round_number")) : null;
    const duplicate = round && events.find(x => x.id !== selected?.id && x.round_number === round);
    if (duplicate) throw new Error(`Round ${round} is already assigned to ${duplicate.name}. Choose that event above to edit it.`);
    if (selected && f.get("max_players")) {
      if (!(await loadResponses())) throw new Error("Could not check confirmed players. Try saving again.");
      const count = rows.filter(r => r.attending && !r.reserve).length;
      if (Number(f.get("max_players")) < count) throw new Error(`There are ${count} confirmed players. Maximum players must be at least ${count}.`);
    }
    const updates = {
      ...eventFields(form), name, date: f.get("date"), round_number: round,
      course_layout_id: f.get("event_type") === "social" ? null : await holeSetup.layoutId(),
      course_name: String(f.get("course_name") || "").trim() || null,
      place_id: f.get("place_id") || null, address: String(f.get("address") || "").trim() || null,
      latitude: f.get("latitude") === "" ? null : Number(f.get("latitude")), longitude: f.get("longitude") === "" ? null : Number(f.get("longitude")),
      cover_url: await coverUpload.saveUrl(), cover_credit: selected?.cover_credit || null,
      round_hours: Number(f.get("round_hours") || 5), location: String(f.get("course_name") || f.get("address") || f.get("location") || "").trim(),
      price: null, first_time: f.get("first_time") || null, max_players: f.get("max_players") ? Number(f.get("max_players")) : null,
      description: f.get("description"), course_link: f.get("course_link") || null, weather_link: f.get("weather_link") || null,
      video_type: f.get("video_type") || null, video_link: f.get("video_link") || null, per_hole_videos: selected?.per_hole_videos || null,
    };
    const query = selected ? c.from("events").update(updates).eq("id", selected.id) : c.from("events").insert(updates);
    const { data, error } = await query.select().single();
    if (error) throw error;
    mergeSavedEvent(data); eventDirty = false;
    fillEvent();
    form.querySelector(".form-status").textContent = "Event saved. You can now view RSVPs or set up tee times.";
    b.toast("Event saved.");
  } catch (error) {
    status.textContent = error.message || "Could not save the event. Please try again.";
    setSaveState("eventSaveState", "Not saved · check below", "unsaved");
  } finally { savingEvent = false; form.inert = false; syncControls(); }
}
async function cancelEvent() {
  if (!selected || isBusy()) return;
  if (eventDirty) { b.toast("Save your event details before cancelling or reopening."); return; }
  if (!confirm(selected.cancelled ? "Reopen this event for members?" : "Cancel this event? It will be shown as cancelled to members.")) return;
  savingEvent = true; syncControls(); $("cancelEvent").disabled = true;
  try {
    const { data, error } = await c.from("events").update({ cancelled: !selected.cancelled }).eq("id", selected.id).select().single();
    if (error) throw error;
    mergeSavedEvent(data); fillEvent();
    b.toast(selected.cancelled ? "Event cancelled." : "Event reopened.");
  } catch (error) { b.toast(error.message); }
  finally { savingEvent = false; $("cancelEvent").disabled = false; syncControls(); }
}
async function findCourse() {
  if (savingEvent) return;
  const query = $("courseQuery").value.trim(), status = $("courseLookupStatus");
  if (query.length < 3) { status.textContent = "Enter at least three letters of the course name."; $("courseQuery").focus(); return; }
  const ticket = ++courseGeneration;
  $("findCourse").disabled = true; coursePending = false; status.textContent = "Finding courses…"; $("courseResults").innerHTML = "";
  try {
    const result = await b.service("search_course", { query });
    if (ticket !== courseGeneration) return;
    const places = result.places || [];
    status.textContent = places.length ? "Choose the correct course. Its details and GPS hole view will be prepared automatically." : "No matching course found. Try the course name and town.";
    $("courseResults").innerHTML = places.map((p, i) => `<button class="secondary" type="button" data-course="${i}">${e(p.displayName?.text || "Course")}<small>${e(p.formattedAddress || "")}</small></button>`).join("");
    $("courseResults").querySelectorAll("[data-course]").forEach(button => button.onclick = () => chooseCourse(places[Number(button.dataset.course)]));
  } catch (error) { if (ticket === courseGeneration) status.textContent = error.message; }
  finally { if (ticket === courseGeneration) $("findCourse").disabled = false; }
}

async function chooseCourse(match) {
  if (savingEvent) return;
  const token = ++courseGeneration;
  const status = document.getElementById("courseLookupStatus");
  coursePending = true;
  document.getElementById("findCourse").disabled = false;
  document.getElementById("courseResults").innerHTML = "";
  function fill(p) {
    form.elements.place_id.value = p.id || "";
    form.elements.course_name.value = p.displayName?.text || "";
    form.elements.address.value = p.formattedAddress || "";
    form.elements.location.value = p.displayName?.text || p.formattedAddress || "";
    form.elements.latitude.value = p.location?.latitude ?? "";
    form.elements.longitude.value = p.location?.longitude ?? "";
    form.elements.course_link.value = p.websiteUri || "";
    form.elements.course_phone.value = p.nationalPhoneNumber || p.internationalPhoneNumber || "";
    updateCourseReadOnly();
  }
  fill(match);
  markEventDirty();
  if (!form.elements.name.value.trim()) form.elements.name.value = `${form.elements.round_number.value ? "Round " + form.elements.round_number.value + " — " : ""}${match.displayName?.text || "Golf day"}`;
  const gps = holeSetup.setCourse(match);
  status.textContent = "Loading course details and preparing the GPS hole layout…";
  let course = match, detailError = null;
  try {
    const result = await b.service("course_details", { place_id: match.id });
    if (token !== courseGeneration) return;
    course = result.place;
    fill(course);
  } catch (error) {
    if (token !== courseGeneration) return;
    detailError = error;
  } finally {
    if (token === courseGeneration) coursePending = false;
  }
  if (token !== courseGeneration) return;
  const missing = [];
  if (!form.elements.course_link.value) missing.push("website");
  if (!form.elements.course_phone.value) missing.push("phone number");
  status.textContent = detailError
    ? `Course selected. Contact details could not be loaded: ${detailError.message}`
    : `Matched ${course.displayName?.text || "your course"}. ${missing.length ? `No ${missing.join(" or ")} was supplied; add it if you know it. ` : "Address and contact details filled in. "}Save the event to keep this course.`;
  try { await gps; }
  catch (error) { if (token === courseGeneration) b.toast(error.message); }
}

async function loadResponses() {
  const area = $("adminRsvps");
  if (!selected) { rows = []; area.innerHTML = '<p class="notice">Save a new event or choose an existing event above to view RSVPs.</p>'; return false; }
  const id = selected.id; $("refreshRsvps").disabled = true;
  area.innerHTML = '<p class="muted" role="status">Loading RSVPs…</p>';
  try {
    const { data, error } = await c.from("rsvps").select("*,baseline_rsvp_contacts(phone)").eq("event_id", id).order("requested_at");
    if (selected?.id !== id) return false;
    if (error) throw error;
    rows = data || [];
    const playing = rows.filter(r => r.attending && !r.reserve).length, waiting = rows.filter(r => r.reserve).length;
    area.innerHTML = `<p class="rsvp-counts"><strong>${playing} playing</strong><span>${waiting} waiting</span><span>${rows.length - playing - waiting} not playing</span></p>${selected.tee_published_at ? '<p class="notice">Tee times are published. Members must contact the committee to withdraw. Check and republish the groups after changing the player list.</p>' : ''}` + (rows.length ? rows.map(r => `<article class="simple-response-row"><div><h3>${e(r.name)}</h3><p>${r.buggy ? "Buggy" + (r.flexibility === "walk" ? " · can walk if needed" : "") : "Walking"}${r.preferred_time ? " · " + e(r.preferred_time) + " tee preference" : ""}</p></div><span class="status-pill ${!r.attending && !r.reserve ? "cancelled" : ""}">${r.reserve ? "Waiting list" : r.attending ? "Playing" : "Not playing"}</span><button class="secondary" type="button" data-edit-response="${r.user_id}">Edit response</button></article>`).join("") : '<p class="muted">No responses yet. Members RSVP from the event page.</p>');
    area.querySelectorAll("[data-edit-response]").forEach(button => button.onclick = () => editResponse(rows.find(r => r.user_id === button.dataset.editResponse)));
    return true;
  } catch (error) {
    if (selected?.id === id) { rows = []; area.innerHTML = b.empty("Could not load RSVPs.", error.message); }
    return false;
  } finally { $("refreshRsvps").disabled = false; }
}
function editResponse(person) {
  if (!person || !selected || responseBusy) return;
  const id = selected.id, dialog = document.createElement("dialog");
  dialog.className = "simple-admin-dialog";
  dialog.setAttribute("aria-labelledby", "responseTitle");
  dialog.innerHTML = `<form class="form-stack"><h2 id="responseTitle">${e(person.name)}</h2><p class="muted">${e(selected.name)}${person.baseline_rsvp_contacts?.phone ? " · " + e(person.baseline_rsvp_contacts.phone) : ""}</p><label>Status<select name="status"><option value="playing" ${person.attending && !person.reserve ? "selected" : ""}>Playing</option><option value="waiting" ${person.reserve ? "selected" : ""}>Waiting list</option><option value="no" ${!person.attending && !person.reserve ? "selected" : ""}>Not playing</option></select></label><label>Buggy<select name="buggy"><option value="no">No</option><option value="yes" ${person.buggy ? "selected" : ""}>Yes</option></select></label><label class="check"><input name="flexibility" type="checkbox" ${person.flexibility === "walk" ? "checked" : ""}>Can walk if needed</label><label>Tee preference<select name="preferred_time"><option value="">No preference</option>${["First", "Middle", "End"].map(x => `<option ${person.preferred_time === x ? "selected" : ""}>${x}</option>`).join("")}</select></label><p class="muted">If a place opens, the next member on the waiting list is moved in automatically.</p><div class="actions"><button type="submit">Save response</button><button type="button" class="secondary" data-close>Cancel</button></div><p class="form-status" role="status"></p></form>`;
  document.body.append(dialog); dialog.showModal();
  const editor = dialog.querySelector("form");
  dialog.querySelector("[data-close]").onclick = () => { if (!responseBusy) dialog.close(); };
  dialog.oncancel = ev => { if (responseBusy) ev.preventDefault(); };
  dialog.onclose = () => dialog.remove();
  editor.onsubmit = async ev => {
    ev.preventDefault(); if (responseBusy) return;
    const f = new FormData(editor), status = editor.querySelector(".form-status");
    responseBusy = true; editor.inert = true; syncControls(); status.textContent = "Saving response…";
    try {
      const { data, error } = await c.rpc("submit_rsvp", { payload: { event_id: id, user_id: person.user_id, attending: f.get("status") !== "no", reserve: f.get("status") === "waiting", buggy: f.get("buggy") === "yes", preferred_time: f.get("preferred_time") || null, flexibility: f.get("flexibility") ? "walk" : null } });
      if (error) throw error;
      const refreshed = await c.from("events").select("*").eq("id", id).single();
      if (!refreshed.error && selected?.id === id) { selected = refreshed.data; events = events.map(ev => ev.id === id ? selected : ev); }
      if (!teeDirty) groupsLoadedFor = null;
      await loadResponses(); updateEventSummary();
      dialog.close(); b.toast(data?.reserve ? "Response saved on the waiting list." : "Response saved.");
    } catch (error) { status.textContent = error.message || "Could not save this response. Try again."; }
    finally { responseBusy = false; editor.inert = false; syncControls(); }
  };
}
function setTeeBusy(value) {
  teeBusy = value;
  $("adminTees").querySelectorAll("button, input, select").forEach(control => control.disabled = value);
  syncControls();
}
async function teeAction(work) {
  if (teeBusy) return;
  const id = selected?.id; setTeeBusy(true);
  try { await work(id); }
  catch (error) { $("teeMessage").textContent = error.message || "Could not update tee times. Please try again."; }
  finally { setTeeBusy(false); }
}
function requireGolfEvent() {
  if (!selected) { $("teeMessage").textContent = "Choose an event above first."; return false; }
  if (selected.event_type === "social" || selected.cancelled) { $("teeMessage").textContent = selected.cancelled ? "Reopen this event before setting up tee times." : "Social events do not need tee times."; return false; }
  return true;
}
function timesFor(count) {
  const start = $("teeStart").value, gap = Number($("teeGap").value);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !Number.isInteger(gap) || gap < 1 || gap > 60) throw new Error("Enter a first tee time and a whole-number gap from 1 to 60 minutes.");
  const [h, m] = start.split(":").map(Number), first = h * 60 + m;
  if (first + Math.max(0, count - 1) * gap >= 1440) throw new Error("These tee times would run into the next day. Use an earlier start or shorter gap.");
  return Array.from({ length: count }, (_, i) => { const mins = first + i * gap; return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`; });
}
function markTeeDirty() { teeDirty = true; setSaveState("teeSaveState", "Unsaved changes", "unsaved"); syncControls(); }
function updateGroupTimes() {
  if (!groups.length || teeBusy) return;
  try { const times = timesFor(groups.length); groups.forEach((g, i) => g.time = times[i]); markTeeDirty(); renderGroups(); $("teeMessage").textContent = "Times updated. Publish tee times to save."; }
  catch (error) { $("teeMessage").textContent = error.message; }
}
async function generate() {
  if (!requireGolfEvent() || teeBusy) return;
  if (groups.length && !confirm("Create fresh groups? This replaces the groups shown below. Published tee times stay unchanged until you publish again.")) return;
  return teeAction(async id => {
    $("teeMessage").textContent = "Preparing groups from the latest confirmed players…";
    if (!(await loadResponses())) throw new Error("Could not load the confirmed players. Try again.");
    const players = rows.filter(r => r.attending && !r.reserve);
    if (!players.length) throw new Error("No confirmed players yet. Check RSVPs first.");
    const pairData = await operation("admin", { event_id: id });
    if (selected?.id !== id) return;
    const packed = packPlayers(players, (pairData.pairs || []).filter(p => p.status === "confirmed")), times = timesFor(packed.length);
    groups = packed.map((people, i) => ({ time: times[i], players: people.map(p => p.user_id) }));
    groupsLoadedFor = id; markTeeDirty(); renderGroups();
    $("teeMessage").textContent = "Draft groups ready. Check names, buggy pairs and times, then publish.";
  });
}
async function loadGroups(automatic = false) {
  if (!requireGolfEvent() || teeBusy) return;
  if (!automatic && teeDirty && !confirm("Reload the saved tee times and discard the changes shown below?")) return;
  return teeAction(async id => {
    $("teeMessage").textContent = "Loading tee times…";
    if (!(await loadResponses())) throw new Error("Could not load the confirmed players. Try again.");
    const { data, error } = await c.from("tee_times").select("*").eq("event_id", id).order("group_number");
    if (selected?.id !== id) return;
    if (error) throw error;
    groupsLoadedFor = id; teeDirty = false;
    let changed = false;
    groups = (data || []).map(g => ({ time: String(g.tee_time || "").slice(0,5), players: (g.players || []).map(p => p.user_id).filter(uid => { const valid = rows.some(r => r.user_id === uid && r.attending && !r.reserve); if (!valid) changed = true; return valid; }) })).filter(g => g.players.length);
    if (!groups.length) { renderGroups(); setSaveState("teeSaveState", "Not published", "new"); $("teeMessage").textContent = "No saved tee times. Choose Create groups to get started."; return; }
    const assigned = new Set(groups.flatMap(g => g.players)), extra = rows.filter(r => r.attending && !r.reserve && !assigned.has(r.user_id));
    for (const person of extra) { let g = groups.find(g => g.players.length < 4); if (!g) { g = { time: "", players: [] }; groups.push(g); } g.players.push(person.user_id); }
    if (extra.length || changed || selected.tee_times_dirty) markTeeDirty();
    else setSaveState("teeSaveState", "Published", "saved");
    renderGroups();
    $("teeMessage").textContent = teeDirty ? "The player list has changed. Check the groups and publish the updated tee times." : "Saved tee times loaded. Change a player's group or tee time below if needed.";
  });
}
function renderGroups() {
  $("teeEditor").innerHTML = groups.map((g, i) => `<section class="tee-group"><div class="section-heading"><h3>Group ${i + 1}<small>${g.players.length} players</small></h3><label>Tee time<input type="time" value="${e(g.time)}" data-time="${i}"></label></div>${g.players.map(id => { const r = rows.find(r => r.user_id === id); if (!r) return ""; return `<div class="tee-player"><span>${e(r.name)}<small>${r.buggy ? "Buggy" : "Walking"}${r.flexibility === "walk" ? " · can walk if needed" : ""}${r.preferred_time ? " · " + e(r.preferred_time) + " tee preference" : ""}</small></span><label class="visually-hidden" for="group-${id}">Group for ${e(r.name)}</label><select id="group-${id}" data-player="${id}" data-from="${i}">${groups.map((_, j) => `<option value="${j}" ${i === j ? "selected" : ""}>Group ${j + 1}</option>`).join("")}<option value="new">New group</option></select></div>`; }).join("")}${g.players.filter(id => rows.find(r => r.user_id === id)?.buggy).length % 2 ? '<p class="muted">Check the buggy pairing in this group.</p>' : ""}${g.players.length > 4 ? '<p class="error">Move a player out: maximum four per group.</p>' : ""}</section>`).join("");
  $("teeEditor").querySelectorAll("[data-time]").forEach(input => input.onchange = () => { groups[Number(input.dataset.time)].time = input.value; markTeeDirty(); });
  $("teeEditor").querySelectorAll("[data-player]").forEach(select => select.onchange = () => {
    const id = select.dataset.player, from = Number(select.dataset.from), to = select.value;
    if (to !== "new" && groups[Number(to)].players.length >= 4) { select.value = String(from); $("teeMessage").textContent = "That group already has four players. Move one out first or choose New group."; return; }
    groups[from].players = groups[from].players.filter(uid => uid !== id);
    if (to === "new") groups.push({ time: "", players: [id] }); else groups[Number(to)].players.push(id);
    groups = groups.filter(g => g.players.length); markTeeDirty(); renderGroups();
    $("teeEditor").querySelector(`[data-player="${id}"]`)?.focus();
  });
  syncControls();
}
function validateGroups() {
  const active = groups.filter(g => g.players.length), seen = new Set(); let previous = "";
  if (!active.length) throw new Error("Create groups first.");
  for (const [i, g] of active.entries()) {
    if (g.players.length > 4) throw new Error(`Group ${i + 1} has more than four players.`);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(g.time)) throw new Error(`Enter a tee time for group ${i + 1}.`);
    if (previous && g.time <= previous) throw new Error(`Group ${i + 1} must tee off after the previous group.`);
    previous = g.time;
    for (const id of g.players) { if (seen.has(id)) throw new Error("A player appears more than once. Reload or recreate groups."); seen.add(id); }
  }
  const confirmed = rows.filter(r => r.attending && !r.reserve);
  if (seen.size !== confirmed.length || confirmed.some(r => !seen.has(r.user_id))) throw new Error("Include every confirmed player once. Reload the groups to check for new RSVPs.");
  const odd = active.filter(g => g.players.filter(id => rows.find(r => r.user_id === id)?.buggy).length % 2);
  if (odd.length > 1) throw new Error("There are unpaired buggy players in different groups. Put them together before publishing.");
  return active;
}
async function saveGroups() {
  if (!requireGolfEvent() || teeBusy) return;
  return teeAction(async id => {
    const active = validateGroups();
    $("teeMessage").textContent = "Checking published tee times…";
    const { data, error } = await c.from("tee_times").select("*").eq("event_id", id);
    if (error) throw error;
    const moves = [];
    for (const g of active) for (const uid of g.players) {
      const previous = (data || []).find(t => (t.players || []).some(p => p.user_id === uid));
      if (previous && (previous.tee_time !== g.time || JSON.stringify(previous.players.map(p => p.user_id).sort()) !== JSON.stringify([...g.players].sort()))) moves.push(`${rows.find(r => r.user_id === uid)?.name || "Player"}: ${previous.tee_time} → ${g.time}${previous.tee_time === g.time ? " (group changed)" : ""}`);
    }
    if (!(await reviewPublication(moves, active))) { $("teeMessage").textContent = "Nothing published. Continue editing below."; return; }
    $("teeMessage").textContent = "Publishing tee times…";
    const saved = await c.rpc("save_tee_times", { event: id, groups: active });
    if (saved.error) throw saved.error;
    teeDirty = false; setSaveState("teeSaveState", "Published", "saved");
    $("teeMessage").textContent = "Tee times published. Members can see them on the event and must contact the committee to withdraw.";
    const refreshed = await c.from("events").select("*").eq("id", id).single();
    if (!refreshed.error && selected?.id === id) { selected = refreshed.data; events = events.map(ev => ev.id === id ? selected : ev); }
    b.toast("Tee times published.");
  });
}

async function loadMemberRecovery() {
  const { data, error } = await c.rpc("member_roster");
  const select = document.getElementById("claimedNames");
  if (error) {
    select.innerHTML = '<option value="">Unable to load names</option>';
    return;
  }
  const names = (data || []).filter((m) => m.claimed);
  select.innerHTML =
    '<option value="">Select claimed name</option>' +
    names
      .map((m) => `<option value="${e(m.id)}">${e(m.name)}</option>`)
      .join("");
  document.getElementById("releaseMember").onsubmit = (ev) => {
    ev.preventDefault();
    b.submit(ev.target, async () => {
      const member = names.find((m) => m.id === select.value);
      if (
        !member ||
        !confirm(
          "Release " +
            member.name +
            "? This blocks the claimed account from RSVPs and cancels its future places. Only continue after checking with the member.",
        )
      )
        return;
      const result = await c.rpc("release_member", { who: member.id });
      if (result.error) throw result.error;
      await loadMemberRecovery();
      b.toast("Name released. The member can now create their account.");
    });
  };
}


function reviewPublication(moves, groups) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.innerHTML = `<h2>Publish these tee times?</h2><p>${groups.filter((g) => g.players.length).length} groups · ${groups.reduce((n, g) => n + g.players.length, 0)} players</p>${moves.length ? `<p>${moves.length} existing players affected:</p><ul>${moves.map((x) => `<li>${e(x)}</li>`).join("")}</ul>` : "<p>No existing player times or groups changed.</p>"}<p>Members will see these tee times on the event. Their RSVP will be locked; they must contact the committee to withdraw.</p><div class="actions"><button data-publish>Publish tee times</button><button class="secondary" data-back>Back to editing</button></div>`;
    document.body.append(dialog);
    const finish = (value) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    dialog.querySelector("[data-publish]").onclick = () => finish(true);
    dialog.querySelector("[data-back]").onclick = () => finish(false);
    dialog.oncancel = (event) => {
      event.preventDefault();
      finish(false);
    };
    dialog.showModal();
  });
}
