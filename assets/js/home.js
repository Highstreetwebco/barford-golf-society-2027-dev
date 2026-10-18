import { mountMemberTees } from "./member-tees.js?v=2027-results-1";
import { londonToday, slots, openCourseHoles } from "./event-experience.js?v=2027-simple-1";
import { openRsvp, rsvpClosed, rsvpChangeLocked, rsvpStatus, teeTimesPublished, withdrawalNotice } from "./rsvp.js?v=2027-simple-1";

const b = await window.barfordReady;
const { escape: e, state } = b;
const area = document.getElementById("nextEvent");
const gotoRsvp = document.getElementById("homeRsvp");
const gotoHoles = document.getElementById("homeHoles");
const requested = new URLSearchParams(location.search).get("event");
document.getElementById("nextEventTitle").textContent = requested !== null ? "Your event" : "Next event";
const requestedId = /^[1-9]\d*$/.test(requested || "") && Number.isSafeInteger(Number(requested)) ? Number(requested) : null;
let currentEvent = null, holeEvent = null, response = null, responseError = false;
let contentKey = "", loading = null;

function welcome() {
  const name = state.profile?.full_name?.trim().split(/\s+/)[0];
  document.getElementById("homeWelcome").textContent = state.user
    ? `Welcome back${name ? ", " + name : ""}. Everything you need for your next golf day.`
    : "RSVP, check the leaderboard and open your course hole view.";
}
function resetActions() {
  gotoRsvp.href = "#nextEvent";
  gotoRsvp.querySelector("strong").textContent = "RSVP";
  gotoRsvp.querySelector("small").textContent = "Book your place";
  gotoHoles.href = "events.html";
}
function syncActions() {
  resetActions();
  if (holeEvent) gotoHoles.href = `event.html?id=${holeEvent.id}#hole-view`;
  if (!currentEvent) return;
  const published = teeTimesPublished(currentEvent);
  if (rsvpClosed(currentEvent)) {
    gotoRsvp.href = `event.html?id=${currentEvent.id}`;
    gotoRsvp.querySelector("strong").textContent = "Event details";
    gotoRsvp.querySelector("small").textContent = currentEvent.cancelled ? "Event cancelled" : "Event finished";
  } else if (published) {
    gotoRsvp.href = `event.html?id=${currentEvent.id}#tees`;
    gotoRsvp.querySelector("strong").textContent = "Tee times";
    gotoRsvp.querySelector("small").textContent = "See your playing group";
  } else if (response && !responseError) {
    gotoRsvp.querySelector("strong").textContent = "Your RSVP";
    gotoRsvp.querySelector("small").textContent = rsvpStatus(currentEvent, response).label;
  }
}
async function saveRsvp() {
  if (!currentEvent) { area.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  if (responseError) { await load({ force: true }).catch(showError); return; }
  const before = state.user?.id;
  await openRsvp(currentEvent, b, { onSaved: () => load({ force: true }) });
  if (state.user?.id !== before) await load({ force: true });
}
gotoRsvp.onclick = (event) => {
  if (!currentEvent || teeTimesPublished(currentEvent) || rsvpClosed(currentEvent)) return;
  event.preventDefault();
  saveRsvp().catch(() => b.toast("Your RSVP could not open. Please try again."));
};
gotoHoles.onclick = async (event) => {
  if (!holeEvent) return;
  event.preventDefault();
  const before = state.user?.id;
  await openCourseHoles(holeEvent, b, gotoHoles);
  if (state.user?.id !== before) await load({ force: true }).catch(() => {});
};

function bookingHTML(ev) {
  if (ev.cancelled) return '<p class="notice">This event has been cancelled.</p>';
  if (rsvpClosed(ev)) return '<p class="simple-booking neutral">This event has finished.</p>';
  if (teeTimesPublished(ev)) {
    return `<p class="notice">${withdrawalNotice}</p><a class="button" href="event.html?id=${ev.id}#tees">View tee times</a>`;
  }
  if (responseError) return '<p class="notice">Your RSVP status could not load.</p><button type="button" class="secondary" data-retry-booking>Check your RSVP</button>';
  const status = rsvpStatus(ev, response);
  const locked = rsvpChangeLocked(ev, response, state.admin);
  return `${state.user ? `<p class="simple-booking ${status.tone}"><span class="booking-dot" aria-hidden="true"></span><strong>${e(status.label)}</strong></p>` : '<p class="muted">Sign in to save your place under your own name.</p>'}
    ${locked ? '<p class="muted">Online changes are now closed. Contact the committee if you need to change your RSVP.</p>' : `<button type="button" data-home-rsvp>${!state.user ? "Sign in to RSVP" : response ? "Change your RSVP" : "RSVP"}</button>`}
    ${response ? '<p class="simple-booking-note">Your response is saved. You only need to change it if your plans change.</p>' : ""}`;
}

async function render(ev, count) {
  welcome();
  syncActions();
  if (!ev) {
    area.innerHTML = `<div class="simple-empty"><h3>${requested !== null ? "Event unavailable" : "The 2027 dates are on their way"}</h3><p>${requested !== null ? "Choose another event to see the latest details." : "Your next golf day will appear here as soon as the committee adds it."}</p><a class="button secondary" href="events.html">View all events</a></div>`;
    return;
  }
  const course = ev.course_name || ev.location || "";
  const fee = ev.member_price != null ? b.money(ev.member_price) : ev.price && ev.price !== "null" ? String(ev.price) : "To be confirmed";
  const image = b.safeUrl(ev.cover_url);
  const kind = ev.event_type === "social" ? "Society event" : ev.round_number ? `Round ${ev.round_number} of 7` : "Society golf";
  area.innerHTML = `<div class="simple-next-event">
    <div class="simple-next-copy"><p class="eyebrow">${e(kind)}</p><h2>${e(ev.name)}</h2>${course && course !== ev.name ? `<p class="muted">${e(course)}</p>` : ""}
      <dl class="simple-event-facts"><div><dt>Date</dt><dd>${e(b.date(ev.date))}</dd></div><div><dt>${ev.event_type === "social" ? "Start time" : "First tee"}</dt><dd>${e(ev.first_time || "To be confirmed")}</dd></div><div><dt>${ev.member_price != null ? "Member price" : "Price"}</dt><dd>${e(fee)}</dd></div></dl>
    </div>${image ? `<div class="simple-next-image"><img src="${image}" alt="" loading="lazy">${ev.cover_credit ? `<small>${e(ev.cover_credit)}</small>` : ""}</div>` : ""}
    <div class="simple-next-booking">${bookingHTML(ev)}</div>
    <div class="simple-next-footer"><span class="muted">${e(slots(ev, count))}</span><a href="event.html?id=${ev.id}">Event details &amp; players <span aria-hidden="true">→</span></a></div>
  </div>${teeTimesPublished(ev) && state.user && !ev.cancelled ? '<section id="homeTeeGroup" class="simple-home-tees" aria-label="Your tee group">Loading tee times…</section>' : ""}`;
  const img = area.querySelector(".simple-next-image img");
  if (img) img.onerror = () => img.parentElement.remove();
  area.querySelector("[data-home-rsvp]")?.addEventListener("click", () => saveRsvp().catch(() => b.toast("Your RSVP could not open. Please try again.")));
  area.querySelector("[data-retry-booking]")?.addEventListener("click", () => load({ force: true }).catch(showError));
  const tees = document.getElementById("homeTeeGroup");
  if (tees) await mountMemberTees(tees, ev.id, { home: true });
}

async function load({ force = false } = {}) {
  if (loading) { await loading; if (force) return load({ force: true }); return; }
  loading = (async () => {
    const [eventResult, countResult] = await Promise.all([
      b.client.from("events").select("*").order("date"),
      b.client.rpc("event_counts"),
    ]);
    if (eventResult.error) throw eventResult.error;
    const events = eventResult.data || [];
    currentEvent = requested !== null
      ? events.find((ev) => Number(ev.id) === requestedId) || null
      : events.find((ev) => !ev.cancelled && ev.date >= londonToday()) || null;
    const golf = events.filter((ev) => !ev.cancelled && ev.event_type !== "social");
    holeEvent = requested !== null && !currentEvent ? null
      : currentEvent && currentEvent.event_type !== "social" && !currentEvent.cancelled
        ? currentEvent : golf.find((ev) => ev.date >= londonToday()) || golf.at(-1) || null;
    response = null;
    responseError = false;
    if (state.user && currentEvent) {
      const own = await b.client.from("rsvps").select("attending,reserve,buggy").eq("event_id", currentEvent.id).eq("user_id", state.user.id).maybeSingle();
      responseError = !!own.error;
      if (!own.error) response = own.data;
    }
    const count = countResult.error ? null : (countResult.data || []).find((row) => Number(row.event_id) === Number(currentEvent?.id))?.playing || 0;
    const key = JSON.stringify([currentEvent, holeEvent?.id, response, responseError, count, state.user?.id]);
    welcome();
    syncActions();
    if (force || key !== contentKey) {
      if (!force && document.querySelector("dialog[open]")) return;
      const focused = area.contains(document.activeElement) ? document.activeElement?.hasAttribute("data-home-rsvp") : false;
      await render(currentEvent, count);
      contentKey = key;
      if (focused && !document.querySelector("dialog[open]")) area.querySelector("[data-home-rsvp]")?.focus({ preventScroll: true });
    }
  })();
  try { await loading; }
  finally { loading = null; }
}

function showError() {
  area.innerHTML = '<div class="simple-empty"><h3>Your next event could not load</h3><p>Check your connection and try again.</p><button type="button" data-retry>Try again</button></div>';
  area.querySelector("[data-retry]").onclick = () => load({ force: true }).catch(showError);
}
welcome();
try {
  await load();
  if (currentEvent && location.hash === "#rsvp" && !teeTimesPublished(currentEvent)) await saveRsvp();
  if (currentEvent && location.hash === "#tees") area.scrollIntoView({ block: "start" });
} catch { showError(); }
const refresh = () => { if (!document.hidden && !document.querySelector("dialog[open]")) load().catch(() => {}); };
window.addEventListener("focus", refresh);
setInterval(refresh, 60000);
window.addEventListener("barford-signout", () => location.reload());
