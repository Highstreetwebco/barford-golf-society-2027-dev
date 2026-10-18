import { mountMemberTees } from "./member-tees.js?v=2027-results-1";
import { londonToday, slots, directions, openCourseHoles } from "./event-experience.js?v=2027-simple-1";
import { openRsvp, rsvpClosed, rsvpChangeLocked, rsvpStatus, teeTimesPublished, withdrawalNotice } from "./rsvp.js?v=2027-simple-1";

const b = await window.barfordReady;
const { client: c, state, escape: e } = b;
const list = document.getElementById("eventList");
const dedicated = location.pathname.endsWith("event.html");
const rawId = new URLSearchParams(location.search).get("id");
const eventId = /^[1-9]\d*$/.test(rawId || "") && Number.isSafeInteger(Number(rawId)) ? Number(rawId) : null;
let events = [], responses = [], counts = null, responseError = false;
let filter = "upcoming", contentKey = "", loading = null;
const own = (id) => responses.find((r) => Number(r.event_id) === Number(id));
const kind = (ev) => ev.event_type === "social" ? "Society event" : ev.round_number ? `Round ${ev.round_number} of 7` : "Society golf";
const place = (ev) => ev.course_name || ev.location || "";
const price = (ev) => ev.member_price != null ? b.money(ev.member_price) : ev.price && ev.price !== "null" ? String(ev.price) : "To be confirmed";
const countFor = (ev) => counts === null ? null : (counts.find((row) => Number(row.event_id) === Number(ev.id))?.playing || 0);

function bookingBadge(ev) {
  if (ev.cancelled) return '<span class="simple-booking-badge neutral">Cancelled</span>';
  if (!state.user || responseError || !own(ev.id)) return "";
  const status = rsvpStatus(ev, own(ev.id));
  return `<span class="simple-booking-badge ${status.tone}">${e(status.label)}</span>`;
}
function eventRow(ev) {
  const date = new Date(ev.date + "T12:00:00");
  return `<article class="simple-event-row" id="event-${ev.id}">
    <div class="simple-date-box" aria-hidden="true"><span>${e(date.toLocaleDateString("en-GB", { month: "short" }))}</span><strong>${date.getDate()}</strong></div>
    <div class="simple-event-row-copy"><p class="eyebrow">${e(kind(ev))}</p><h2><a href="event.html?id=${ev.id}">${e(ev.name)}</a></h2><p>${e(b.date(ev.date))}${ev.first_time ? ` · ${e(ev.first_time)}` : ""}</p>${place(ev) && place(ev) !== ev.name ? `<p class="muted">${e(place(ev))}</p>` : ""}<div class="simple-event-row-meta"><span>${e(price(ev))}${ev.member_price != null ? " per member" : ""}</span>${bookingBadge(ev)}</div></div>
    <div class="simple-event-row-action"><a class="button secondary" href="event.html?id=${ev.id}">${teeTimesPublished(ev) && !rsvpClosed(ev) ? "Details & tee times" : "View event"}<span aria-hidden="true">→</span></a><small>${e(slots(ev, countFor(ev)))}</small></div>
  </article>`;
}
function bookingHTML(ev) {
  const response = own(ev.id);
  if (ev.cancelled) return '<p class="notice">This event has been cancelled. Contact the committee about any booking or payment.</p>';
  if (rsvpClosed(ev)) return '<p class="simple-booking neutral">This event has finished.</p>';
  if (teeTimesPublished(ev)) return `<p class="notice">Tee times are published. ${withdrawalNotice}</p>`;
  if (responseError) return '<p class="notice">Your saved RSVP could not load.</p><button type="button" class="secondary" data-retry-booking>Check your RSVP</button>';
  const status = rsvpStatus(ev, response);
  const locked = rsvpChangeLocked(ev, response, state.admin);
  return `${state.user ? `<p class="simple-booking ${status.tone}"><span class="booking-dot" aria-hidden="true"></span><strong>${e(status.label)}</strong></p>` : '<p class="muted">Sign in to save your response under your own name.</p>'}
    ${locked ? '<p class="muted">Online changes are now closed. Please contact the committee to change your RSVP.</p>' : `<button type="button" data-rsvp>${!state.user ? "Sign in to RSVP" : response ? "Change your RSVP" : "RSVP"}</button>`}
    ${response ? '<p class="simple-booking-note">Your response is saved. Changing it updates this booking.</p>' : ""}`;
}

async function loadPlayers(area, ev) {
  if (!area || area.dataset.loading === "true") return;
  area.dataset.loading = "true";
  try {
    if (!state.user) {
      area.innerHTML = '<p><a href="account.html">Sign in</a> to see who’s playing.</p>';
      return;
    }
    area.innerHTML = '<p role="status">Loading players…</p>';
    const { data, error } = await c.from("rsvps").select("user_id,name,attending,reserve,buggy").eq("event_id", ev.id).or("attending.eq.true,reserve.eq.true").order("requested_at");
    if (!area.isConnected) return;
    if (error) throw error;
    const playing = (data || []).filter((r) => r.attending && !r.reserve);
    const waiting = (data || []).filter((r) => r.reserve);
    const names = (rows) => rows.map((r) => `<li><span>${e(r.name)}${r.user_id === state.user?.id ? ' <small class="muted">(you)</small>' : ""}</span>${r.buggy ? '<small class="muted">Buggy requested</small>' : ""}</li>`).join("");
    area.innerHTML = `<h3>${ev.event_type === "social" ? "Attending" : "Playing"} (${playing.length})</h3>${playing.length ? `<ul class="simple-player-list">${names(playing)}</ul>` : '<p class="muted">No confirmed players yet.</p>'}${waiting.length ? `<h3>Waiting list (${waiting.length})</h3><ol class="simple-player-list waiting-list">${names(waiting)}</ol>` : ""}`;
  } catch {
    area.innerHTML = '<p class="notice">The player list could not load.</p><button type="button" class="secondary" data-retry-players>Try again</button>';
    area.querySelector("[data-retry-players]").onclick = () => loadPlayers(area, ev);
  } finally { area.dataset.loading = "false"; }
}

async function render() {
  const visible = events.filter((ev) => dedicated ? Number(ev.id) === eventId : filter === "past" ? ev.date < londonToday() : ev.date >= londonToday());
  if (!visible.length) {
    list.innerHTML = `<div class="panel simple-empty"><h2>${dedicated ? "Event not found" : filter === "past" ? "No past events yet" : "The 2027 dates are on their way"}</h2><p>${dedicated ? "Choose another event to see the latest details." : filter === "past" ? "Completed golf days will appear here." : "The committee will add each golf day here once it is confirmed."}</p>${dedicated ? '<a class="button secondary" href="events.html">View all events</a>' : ""}</div>`;
    return;
  }
  if (!dedicated) { list.innerHTML = (filter === "past" ? visible.slice().reverse() : visible).map(eventRow).join(""); return; }
  const ev = visible[0];
  const expandedPlayers = list.querySelector("[data-player-details]")?.open;
  document.title = ev.name + " | Barford Golf Society";
  const image = b.safeUrl(ev.cover_url);
  const isGolf = ev.event_type !== "social";
  const facts = [
    ["Date", b.date(ev.date)],
    [isGolf ? "First tee" : "Start time", ev.first_time || "To be confirmed"],
    [ev.member_price != null ? "Member price" : "Price", price(ev)],
    ...(ev.refreshment_time ? [["Arrive for refreshments", ev.refreshment_time]] : []),
    ...(ev.rsvp_deadline && !rsvpClosed(ev) ? [["RSVP by", b.date(ev.rsvp_deadline)]] : []),
    ...(ev.payment_due ? [["Payment due", b.date(ev.payment_due)]] : []),
  ];
  list.innerHTML = `<article class="simple-event-detail" id="event-${ev.id}">
    <header class="simple-event-header"><div><p class="eyebrow">${e(kind(ev))}</p><h1>${e(ev.name)}</h1>${place(ev) && place(ev) !== ev.name ? `<p>${e(place(ev))}</p>` : ""}</div>${image ? `<img src="${image}" alt="" fetchpriority="high">` : ""}</header>
    ${image && ev.cover_credit ? `<p class="simple-cover-credit">${e(ev.cover_credit)}</p>` : ""}
    <section class="panel simple-event-summary" aria-label="Event details">
      <dl class="simple-event-facts">${facts.map(([label, value]) => `<div><dt>${label}</dt><dd>${e(value)}</dd></div>`).join("")}</dl>
      <div class="simple-event-booking">${bookingHTML(ev)}</div>
      <div class="simple-event-buttons">${isGolf && !ev.cancelled ? '<button type="button" class="secondary" id="hole-view" data-hole-view>Course hole view <span aria-hidden="true">↗</span></button>' : ""}<a class="button secondary" href="${directions(ev)}" target="_blank" rel="noopener noreferrer">Directions <span aria-hidden="true">↗</span></a></div>
      <p class="simple-booking-note">${e(slots(ev, countFor(ev)))}</p>
    </section>
    ${ev.event_notice ? `<p class="notice preserve-lines">${e(ev.event_notice)}</p>` : ""}
    ${teeTimesPublished(ev) && !ev.cancelled ? `<section class="panel simple-tee-section" id="tees" aria-label="Published tee times">${state.user ? '<div data-member-tees>Loading tee times…</div>' : '<h2>Tee times</h2><p>Sign in to see your playing group.</p><button type="button" data-signin-tees>Sign in</button>'}</section>` : ""}
    <details class="panel simple-details" data-player-details ${expandedPlayers ? "open" : ""}><summary>${isGolf ? "Who’s playing" : "Who’s attending"}${countFor(ev) != null ? ` (${Number(countFor(ev))})` : ""}</summary><div data-players></div></details>
    ${ev.description || ev.included || ev.address || ev.cancellation_terms ? `<section class="panel simple-day-details"><h2>On the day</h2>${ev.description ? `<p class="preserve-lines">${e(ev.description)}</p>` : ""}${ev.included ? `<h3>What’s included</h3><p class="preserve-lines">${e(ev.included)}</p>` : ""}${ev.address ? `<h3>Address</h3><p class="preserve-lines">${e(ev.address)}</p>` : ""}${b.safeUrl(ev.course_link) ? `<p><a href="${b.safeUrl(ev.course_link)}" target="_blank" rel="noopener noreferrer">Course website ↗</a></p>` : ""}${ev.cancellation_terms ? `<details class="simple-terms"><summary>Cancellation terms</summary><p class="preserve-lines">${e(ev.cancellation_terms)}</p></details>` : ""}</section>` : ""}
  </article>`;
  const img = list.querySelector(".simple-event-header img");
  if (img) img.onerror = () => { img.remove(); list.querySelector(".simple-cover-credit")?.remove(); };
  list.querySelector("[data-rsvp]")?.addEventListener("click", async () => {
    const before = state.user?.id;
    await openRsvp(ev, b, { onSaved: () => load({ force: true }) });
    if (state.user?.id !== before) await load({ force: true });
  });
  list.querySelector("[data-retry-booking]")?.addEventListener("click", () => load({ force: true }).catch(showError));
  list.querySelector("[data-hole-view]")?.addEventListener("click", async (event) => {
    const before = state.user?.id;
    await openCourseHoles(ev, b, event.currentTarget);
    if (state.user?.id !== before) await load({ force: true }).catch(() => {});
  });
  list.querySelector("[data-signin-tees]")?.addEventListener("click", async () => { if (await b.requireMember()) await load({ force: true }); });
  const details = list.querySelector("[data-player-details]");
  details.addEventListener("toggle", () => { if (details.open) loadPlayers(details.querySelector("[data-players]"), ev); });
  const tasks = [];
  if (expandedPlayers) tasks.push(loadPlayers(details.querySelector("[data-players]"), ev));
  const tees = list.querySelector("[data-member-tees]");
  if (tees) tasks.push(mountMemberTees(tees, ev.id));
  await Promise.allSettled(tasks);
}

async function load({ force = false } = {}) {
  if (loading) { await loading; if (force) return load({ force: true }); return; }
  loading = (async () => {
    const ownRequest = state.user ? c.from("rsvps").select("event_id,attending,reserve,buggy").eq("user_id", state.user.id) : Promise.resolve({ data: [] });
    const [eventResult, countResult, ownResult] = await Promise.all([
      c.from("events").select("*").order("date"), c.rpc("event_counts"), ownRequest,
    ]);
    if (eventResult.error) throw eventResult.error;
    events = eventResult.data || [];
    counts = countResult.error ? null : countResult.data || [];
    responseError = !!ownResult.error;
    responses = ownResult.error ? [] : ownResult.data || [];
    const notice = document.getElementById("memberNotice");
    notice.hidden = dedicated || !!state.user;
    const key = JSON.stringify([events, counts, responses, responseError, state.user?.id, filter]);
    if (force || key !== contentKey) {
      if (!force && (document.querySelector("dialog[open]") || list.contains(document.activeElement))) return;
      await render();
      contentKey = key;
    }
  })();
  try { await loading; } finally { loading = null; }
}
function showError() {
  list.innerHTML = '<div class="panel simple-empty"><h2>Events could not load</h2><p>Check your connection and try again.</p><button type="button" data-retry>Try again</button></div>';
  list.querySelector("[data-retry]").onclick = () => load({ force: true }).catch(showError);
}
document.querySelectorAll("[data-filter]").forEach((button) => {
  button.onclick = () => {
    filter = button.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((node) => {
      node.classList.toggle("active", node === button);
      node.setAttribute("aria-pressed", String(node === button));
    });
    contentKey = "";
    render();
  };
});
try {
  await load();
  const ev = events.find((row) => Number(row.id) === eventId);
  if (dedicated && ev && location.hash === "#rsvp") await openRsvp(ev, b, { onSaved: () => load({ force: true }) });
  if (dedicated && ev && location.hash === "#hole-view" && ev.event_type !== "social") await openCourseHoles(ev, b, list.querySelector("[data-hole-view]"));
  if (dedicated && location.hash === "#tees") document.getElementById("tees")?.scrollIntoView({ block: "start" });
} catch { showError(); }
const refresh = () => { if (!document.hidden && !document.querySelector("dialog[open]")) load().catch(() => {}); };
setInterval(refresh, 60000);
window.addEventListener("focus", refresh);
window.addEventListener("barford-signout", () => location.reload());
