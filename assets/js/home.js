import { mountPersonalResults } from "./league-view.js?v=2027-results-1";
import { guestAction, shareInvite, mountGuestInvites } from "./guest-invites.js?v=2027-simple-events-1";
import { mountEventOperations } from "./operations.js?v=2027-simple-events-1";
import { mountMemberTees } from "./member-tees.js?v=2027-results-1";
import { updateSlots, londonToday, mountBuggy } from "./event-experience.js?v=2027-simple-events-1";
import { openRsvp, rsvpClosed, rsvpChangeLocked } from "./rsvp.js?v=2027-rsvp-cutoff-1";
const b = await window.barfordReady;
const area = document.getElementById("nextEvent");
const personal = document.getElementById("personalResults");
function memberWelcome() {
  if (!b.state.user) return;
  document.body.classList.add("home-member");
  const a = document.getElementById("homeAccount");
  a.textContent = "My account";
  a.href = "account.html";
  document.querySelector(".home-hero h1").textContent = "Welcome back, " + (b.state.profile?.full_name?.split(" ")[0] || "golfer") + ".";
  area.closest("section").after(personal);
}
memberWelcome();
mountPersonalResults(personal, b);
window.addEventListener("focus", () => mountPersonalResults(personal, b));
setInterval(() => { if (!document.hidden) mountPersonalResults(personal, b); }, 30000);
let guestHome = null;
if (b.state.user) {
  try { guestHome = await guestAction("mine"); } catch {}
}
const requested = new URLSearchParams(location.search).get("event");
const requestedId = requested && /^[1-9]\d*$/.test(requested) && Number.isSafeInteger(Number(requested)) ? Number(requested) : null;
const guestNext = (guestHome?.bookings || []).find((x) => x.attending || x.reserve) || guestHome?.bookings?.[0];
const unavailableRequest = requested !== null && (!requestedId || (guestHome?.category === "guest" && !(guestHome.bookings || []).some((x) => x.event_id === requestedId)));
let eventQuery = b.client.from("events").select("*");
if (requestedId) eventQuery = eventQuery.eq("id", requestedId);
else {
  eventQuery = eventQuery.gte("date", londonToday()).eq("cancelled", false).order("date");
  if (guestHome?.category === "guest" && guestNext) eventQuery = eventQuery.eq("id", guestNext.event_id);
}
const { data, error } = b.state.user && !guestHome ? { data: null, error: new Error("Account details unavailable") } : unavailableRequest || (guestHome?.category === "guest" && !guestNext && !requestedId) ? { data: [], error: null } : await eventQuery.limit(1);
if (error) area.innerHTML = b.empty("Unable to load the next event.", "Please try again shortly.");
else if (!data?.length) area.innerHTML = b.empty(requested !== null ? "This event is unavailable." : guestHome?.category === "guest" ? "Your next invitation starts here." : "A new season is taking shape.", requested !== null ? "Choose another event from the Events page." : guestHome?.category === "guest" ? "Your invited rounds will appear here once you join them." : "The 2027 golf days will appear here as they’re announced.");
else {
  const ev = data[0];
  if (requestedId) {
    document.querySelector("#nextEvent").closest("section").querySelector(".eyebrow").textContent = "YOUR SELECTED EVENT";
    area.closest("section").querySelector("h2").textContent = "Your event.";
  }
  area.classList.add("has-event");
  area.innerHTML = `<div class="section-heading next-event-heading"><div><p class="eyebrow" data-event-date></p><h2 data-event-name></h2></div></div><div class="home-event-actions" data-home-actions></div><p class="home-invite-note muted" data-invite-note hidden></p><p role="status" data-home-status></p><div class="next-event-facts"><span><small data-time-label>FIRST TEE</small><strong data-event-time></strong></span><span class="home-availability"><small>LIVE AVAILABILITY</small><strong data-live-slots>Checking spaces…</strong><button type="button" class="home-players-toggle" aria-expanded="false" aria-controls="homePlayingList">See who’s playing <span aria-hidden="true">⌄</span></button></span><span><small>THE COURSE</small><strong data-event-course></strong></span></div><div id="homePlayingList" class="home-playing-list" hidden aria-live="polite"></div><a class="home-event-details" href="event.html?id=${ev.id}">View event details <span aria-hidden="true">→</span></a><div class="home-hole-action"></div><details class="home-invite-management" hidden><summary>Your guest invitations</summary><div data-home-invites></div></details><div class="home-member-grid"><section id="homeOperations" class="panel section"></section><section id="homeTeeGroup" class="panel section" ${b.state.user ? "" : "hidden"}></section></div><section id="homeBuggy" class="panel section" hidden></section>`;
  function syncCover() {
    const old = area.querySelector(".home-event-cover");
    const url = b.safeUrl(ev.cover_url);
    if (!url) { old?.remove(); return; }
    if (old?.dataset.coverUrl === ev.cover_url) return;
    old?.remove();
    area.insertAdjacentHTML("afterbegin", `<img class="home-event-cover" data-cover-url="${b.escape(ev.cover_url)}" src="${url}" alt="" aria-hidden="true">`);
    area.querySelector(".home-event-cover").onerror = (event) => event.currentTarget.remove();
  }
  syncCover();
  const playingToggle = area.querySelector(".home-players-toggle");
  const playingList = area.querySelector("#homePlayingList");
  async function refreshPlayingList() {
    if (playingList.hidden) return;
    if (!b.state.user) {
      playingList.innerHTML = '<p>Sign in to see who’s playing. <a href="account.html">Sign in</a></p>';
      return;
    }
    const { data: bookings, error: playersError } = await b.client.from("rsvps")
      .select("name,attending,reserve,guest_host_id")
      .eq("event_id", ev.id)
      .or("attending.eq.true,reserve.eq.true")
      .order("requested_at");
    if (playingList.hidden) return;
    if (playersError) {
      playingList.innerHTML = '<p>Player list could not load. Close and reopen to try again.</p>';
      return;
    }
    const confirmed = (bookings || []).filter((p) => p.attending && !p.reserve);
    const waiting = (bookings || []).filter((p) => p.reserve);
    const names = (rows) => rows.map((p) => `<li>${b.escape(p.name)}${p.guest_host_id ? ' <small>(guest)</small>' : ""}</li>`).join("");
    playingList.innerHTML = `<h3>${ev.event_type === "social" ? "Attending" : "Playing"} (${confirmed.length})</h3>${confirmed.length ? `<ul>${names(confirmed)}</ul>` : '<p>No one has confirmed yet.</p>'}${waiting.length ? `<h3>Waiting list (${waiting.length})</h3><ul>${names(waiting)}</ul>` : ""}`;
  }
  playingToggle.onclick = () => {
    playingList.hidden = !playingList.hidden;
    playingToggle.setAttribute("aria-expanded", String(!playingList.hidden));
    if (!playingList.hidden) {
      playingList.innerHTML = '<p>Loading players…</p>';
      refreshPlayingList();
    }
  };
  const actions = area.querySelector("[data-home-actions]");
  const operationArea = document.getElementById("homeOperations");
  const groupArea = document.getElementById("homeTeeGroup");
  const buggyArea = document.getElementById("homeBuggy");
  const inviteArea = area.querySelector("[data-home-invites]");
  const inviteManagement = area.querySelector(".home-invite-management");
  const options = { compact: true, showBookingLink: false, showInvites: false, showBrief: false };
  let response = null;
  let bookingRefresh = null;
  let guestContext = guestHome;
  let inviting = false;
  let refreshing = false;
  function updateFacts() {
    area.querySelector("[data-event-date]").textContent = b.date(ev.date);
    area.querySelector("[data-event-name]").textContent = ev.name;
    area.querySelector("[data-event-time]").textContent = ev.first_time || "To be announced";
    area.querySelector("[data-event-course]").textContent = ev.location || ev.course_name || ev.name;
    area.querySelector("[data-time-label]").textContent = ev.event_type === "social" ? "START TIME" : "FIRST TEE";
  }
  function renderActions() {
    const focusedAction = actions.contains(document.activeElement) ? (document.activeElement.hasAttribute("data-home-invite") ? "[data-home-invite]" : "[data-home-rsvp]") : null;
    const closed = rsvpClosed(ev);
    const locked = rsvpChangeLocked(ev, response, b.state.admin);
    const confirmation = response?.reserve ? "You’re on the waiting list" : response?.attending ? ev.event_type === "social" ? "You’re attending" : "You’re playing" : response ? "You’re not playing" : "";
    const guestClosed = closed || (ev.rsvp_deadline && ev.rsvp_deadline < londonToday());
    const canInvite = !!b.state.user && guestContext && guestContext.category !== "guest" && !guestClosed;
    const note = area.querySelector("[data-invite-note]");
    actions.innerHTML = `<div class="home-rsvp-controls">${confirmation ? `<p class="home-rsvp-confirmation" role="status"><span aria-hidden="true">${response?.attending && !response.reserve ? "✓" : "•"}</span> ${b.escape(confirmation)}</p>` : ""}${closed ? `<span class="status-pill">${ev.cancelled ? "Event cancelled" : "Event complete"}</span>` : locked ? '<p class="home-rsvp-cutoff">Online RSVP changes are closed within six days of the event. Contact the committee to change your RSVP.</p>' : `<button type="button" data-home-rsvp>${!b.state.user ? "Sign in to RSVP" : response ? "Change your RSVP" : "RSVP"}</button>`}</div>${canInvite ? `<button type="button" class="secondary" data-home-invite ${ev.guest_price == null || inviting ? "disabled" : ""}>Invite a guest</button>` : ""}`;
    note.hidden = !canInvite || ev.guest_price != null;
    note.textContent = "The organiser needs to confirm the guest price before invitations can be sent.";
    const rsvpButton = actions.querySelector("[data-home-rsvp]");
    if (rsvpButton) rsvpButton.onclick = () => openRsvp(ev, b, { onSaved: async () => { memberWelcome(); await initialRefresh; await refreshBooking({ force: true }); refreshHoleAction(); await Promise.all([updateSlots(ev, area), refreshPlayingList()]); } });
    const inviteButton = actions.querySelector("[data-home-invite]");
    if (inviteButton) inviteButton.onclick = async () => {
      if (inviting) return;
      inviting = true;
      inviteButton.disabled = true;
      const status = area.querySelector("[data-home-status]");
      status.textContent = "";
      try {
        const link = await guestAction("create", { event_id: ev.id });
        shareInvite(ev, link.token, link.host_name);
        await refreshInvites();
      } catch (error) { status.textContent = error.message || "Your invitation could not be created. Please try again."; }
      finally { inviting = false; inviteButton.disabled = ev.guest_price == null; }
    };
    if (focusedAction) (actions.querySelector(focusedAction) || area.querySelector(".home-event-details"))?.focus({ preventScroll: true });
  }
  async function refreshInvites() {
    if (!b.state.user || guestContext?.category === "guest") { inviteManagement.hidden = true; return; }
    if (inviteArea.contains(document.activeElement)) return;
    await mountGuestInvites(inviteArea, ev, guestContext?.category, { showCreate: false, showManagement: true });
    inviteManagement.hidden = inviteArea.hidden || !inviteArea.querySelector("[data-invites]")?.childElementCount;
  }
  async function refreshBooking({ force = false, background = false } = {}) {
    if (bookingRefresh) {
      await bookingRefresh;
      if (force) return refreshBooking({ force: true });
      return;
    }
    const task = (async () => {
      if (b.state.user) {
        const [own, guests] = await Promise.all([
          b.client.from("rsvps").select("*").eq("event_id", ev.id).eq("user_id", b.state.user.id).maybeSingle(),
          guestAction("mine", { event_id: ev.id }).catch(() => null),
        ]);
        if (!own.error) response = own.data;
        guestContext = guests;
      }
      if (background && document.querySelector("dialog[open]")) return;
      renderActions();
      groupArea.hidden = !b.state.user || ev.event_type === "social";
      await Promise.all([
        operationArea.contains(document.activeElement) ? Promise.resolve() : mountEventOperations(operationArea, ev, options),
        refreshInvites(),
        b.state.user && ev.event_type !== "social" ? mountMemberTees(groupArea, ev.id, { home: true }) : Promise.resolve().then(() => { groupArea.hidden = true; }),
        b.state.user && ev.event_type !== "social" ? mountBuggy(buggyArea, ev).then(() => { buggyArea.hidden = !buggyArea.innerHTML; }) : Promise.resolve().then(() => { buggyArea.hidden = true; }),
      ]);
    })();
    bookingRefresh = task;
    try { await task; }
    finally { if (bookingRefresh === task) bookingRefresh = null; }
  }
  const holeArea = area.querySelector(".home-hole-action");
  function refreshHoleAction() {
    holeArea.hidden = !b.state.user || ev.cancelled || ev.event_type === "social" || ev.date !== londonToday();
    if (holeArea.hidden || holeArea.childElementCount) return;
    holeArea.innerHTML = '<div><strong>On the course today</strong><p>Choose your hole for the course map and GPS distances.</p></div><button type="button" data-view-hole>View hole</button>';
    holeArea.querySelector("button").onclick = async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try { const { openHolePicker } = await import("./hole-view.js?v=2027-accurate-gps-1"); await openHolePicker(ev, b); }
      catch (error) { b.toast(error.message); }
      finally { button.disabled = false; }
    };
  }
  updateFacts();
  if (b.state.user) actions.innerHTML = '<p class="muted">Checking your RSVP…</p>';
  else renderActions();
  refreshHoleAction();
  const initialRefresh = Promise.all([refreshBooking(), updateSlots(ev, area)]);
  if (location.hash === "#rsvp") await openRsvp(ev, b, { onSaved: async () => { memberWelcome(); await initialRefresh; await refreshBooking({ force: true }); refreshHoleAction(); await Promise.all([updateSlots(ev, area), refreshPlayingList()]); } });
  await initialRefresh;
  async function refreshEvent() {
    if (document.hidden || refreshing || document.querySelector("dialog[open]")) return;
    refreshing = true;
    try {
      const current = await b.client.from("events").select("*").eq("id", ev.id).single();
      if (document.querySelector("dialog[open]")) return;
      if (!current.error && current.data) Object.assign(ev, current.data);
      syncCover();
      updateFacts();
      refreshHoleAction();
      await Promise.all([updateSlots(ev, area), refreshBooking({ background: true }), refreshPlayingList()]);
    } finally { refreshing = false; }
  }
  setInterval(refreshEvent, 25000);
  window.addEventListener("focus", refreshEvent);
}
window.addEventListener("barford-signout", () => location.reload());
