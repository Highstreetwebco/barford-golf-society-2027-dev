import { mountEventOperations } from "./operations.js?v=2027-simple-events-1";
import { mountMemberTees } from "./member-tees.js?v=2027-results-1";
import { openRsvp } from "./rsvp.js?v=2027-rsvp-cutoff-1";
import {
  mountExperience,
  mountBuggy,
  slots,
  londonToday,
} from "./event-experience.js?v=2027-simple-events-1";

const b = await window.barfordReady;
const { client: c, state, escape: e } = b;
const list = document.getElementById("eventList");
const dedicated = location.pathname.endsWith("event.html");
const eventId = Number(new URLSearchParams(location.search).get("id"));
let events = [], responses = [], counts = [], tees = [], filter = "upcoming";
let paymentOverview = null;
let contentKey = "", loading = null;
const privatePending = new Set();
const own = (id) => responses.find((r) => r.event_id === id && r.user_id === state.user?.id);
const status = (r) => r?.reserve ? "On the waiting list" : r?.attending ? "You’re booked" : "Not playing";
const kind = (ev) => ev.event_type === "social" ? "Social event" : ev.event_type === "pairs" ? "Pairs golf" : ev.round_number ? "League round " + ev.round_number : "Society golf";
const place = (ev) => ev.course_name || ev.location || "";
const price = (ev) => ev.member_price != null ? b.money(ev.member_price) : ev.price && ev.price !== "null" ? e(ev.price) : "To be confirmed";
const countFor = (ev) => counts.find((row) => row.event_id === ev.id)?.playing || 0;
const stamp = (date) => new Date(date + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const imageHTML = (ev, eager = false) => b.safeUrl(ev.cover_url) ? `<img class="event-poster-image" src="${b.safeUrl(ev.cover_url)}" alt="" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'}>` : "";
const creditHTML = (ev) => ev.cover_credit && b.safeUrl(ev.cover_url) ? `<small class="event-photo-credit">${e(ev.cover_credit)}</small>` : "";
const section = (key, title, hint, content) => `<details class="event-info-section" data-detail-section="${key}"><summary><span><strong>${title}</strong>${hint ? `<small>${hint}</small>` : ""}</span></summary><div class="event-info-content">${content}</div></details>`;

function hasInteraction(area = list) {
  if (document.querySelector("dialog[open]")) return true;
  const active = document.activeElement;
  if (area.contains(active) && active.closest("input,select,textarea,form[data-partner]")) return true;
  if (area.querySelector("button:disabled")) return true;
  // Partner choices must survive a poll after focus has moved elsewhere.
  return [...area.querySelectorAll("form[data-partner]")].some((form) => form.closest("details")?.open);
}
function postponeRender() {
  return hasInteraction();
}
async function refreshPrivate(section) {
  if (!section?.open || hasInteraction(section)) return;
  const ev = events.find((row) => row.id === eventId);
  const key = section.dataset.detailSection;
  const id = { booking: "eventOperations", buggy: "buggyPanel", players: "memberTees-" + eventId }[key];
  const current = id && section.querySelector("#" + id);
  if (!ev || !current || privatePending.has(key)) return;
  privatePending.add(key);
  const replacement = current.cloneNode(false);
  try {
    if (key === "booking") await mountEventOperations(replacement, ev, { showInvites: false, showBookingStatus: false, showBrief: false });
    if (key === "buggy") await mountBuggy(replacement, ev);
    if (key === "players") await mountMemberTees(replacement, ev.id);
    // The request may finish after a member has started editing or changed pages.
    if (current.isConnected && section.open && !hasInteraction(section)) {
      const focused = current.contains(document.activeElement) ? document.activeElement : null;
      const focusLabel = focused?.matches("button, a") ? focused.textContent : null;
      const opened = [...current.querySelectorAll("details")].map((node) => node.open);
      replacement.querySelectorAll("details").forEach((node, i) => { node.open = !!opened[i]; });
      current.replaceWith(replacement);
      if (focusLabel) {
        const target = [...replacement.querySelectorAll("button, a")].find((node) => node.textContent === focusLabel && !node.disabled);
        (target || section.querySelector("summary")).focus({ preventScroll: true });
      }
    }
  } finally { privatePending.delete(key); }
}
function refreshCounts() {
  list.querySelectorAll("[data-live-slots]").forEach((node) => {
    const ev = events.find((row) => row.id === Number(node.dataset.eventId));
    if (ev) node.textContent = slots(ev, countFor(ev));
  });
}

async function load({ forceRender = false } = {}) {
  if (loading) {
    await loading;
    return forceRender ? load({ forceRender: true }) : undefined;
  }
  loading = (async () => {
    const result = await Promise.all([
      c.from("events").select("*").order("date"),
      c.rpc("event_counts"),
      state.user && dedicated ? c.from("tee_times").select("*").order("group_number") : Promise.resolve({ data: [] }),
      state.user ? c.from("rsvps").select("id,event_id,user_id,name,attending,reserve,buggy,preferred_time,flexibility,terms_snapshot,created_at,requested_at").order("requested_at") : Promise.resolve({ data: [] }),
      state.user && dedicated ? c.rpc("event_payment_overview", { event: eventId }) : Promise.resolve({ data: null }),
    ]);
    const failed = result.slice(0, 4).find((value) => value.error);
    if (failed) throw failed.error;
    events = result[0].data || [];
    counts = result[1].data || [];
    tees = result[2].data || [];
    responses = result[3].data || [];
    paymentOverview = result[4].error ? null : result[4].data;
    document.getElementById("memberNotice").hidden = dedicated || !!state.user;
    const key = JSON.stringify([events, responses, tees, paymentOverview, state.user?.id, filter]);
    if (key !== contentKey && (forceRender || !postponeRender())) {
      await render();
      contentKey = key;
    } else {
      refreshCounts();
      if (dedicated) await Promise.allSettled([...list.querySelectorAll("[data-detail-section][open]")].map(refreshPrivate));
    }
  })();
  try { await loading; } finally { loading = null; }
}

function eventCard(ev) {
  const r = own(ev.id);
  return `<a class="event-poster-card" id="event-${ev.id}" href="event.html?id=${ev.id}" aria-labelledby="event-title-${ev.id}">
    ${imageHTML(ev)}
    <div class="event-poster-content"><div class="event-poster-top"><span class="event-kind">${e(kind(ev))}</span>${ev.cancelled ? '<span class="event-booking-tag">Cancelled</span>' : r ? `<span class="event-booking-tag">${status(r)}</span>` : ""}</div>
    <div class="event-poster-heading"><p class="event-poster-date">${e(stamp(ev.date))} · ${e(ev.first_time || "Time to follow")}</p><h2 id="event-title-${ev.id}">${e(ev.name)}</h2>${place(ev) && place(ev) !== ev.name ? `<p class="event-poster-place">${e(place(ev))}</p>` : ""}</div>
    <div class="event-poster-footer"><span><strong>${price(ev)}</strong>${ev.member_price != null ? " member" : ""}<small data-live-slots data-event-id="${ev.id}">${e(slots(ev, countFor(ev)))}</small></span><span class="event-poster-arrow" aria-hidden="true">↗</span></div></div>${creditHTML(ev)}</a>`;
}

function essentials(ev, ownTime) {
  const facts = [
    ["Date", e(b.date(ev.date))],
    [ev.event_type === "social" ? "Starts at" : "First tee", e(ev.first_time || "To be confirmed")],
    ...(ownTime ? [["Your tee time", e(ownTime)]] : []),
    ...(ev.refreshment_time ? [["Refreshments from", e(ev.refreshment_time)]] : []),
    [ev.member_price != null ? "Member price" : "Price", price(ev)],
    ...(ev.guest_price != null ? [["Guest price", b.money(ev.guest_price)]] : []),
    ["Availability", `<span data-live-slots data-event-id="${ev.id}">${e(slots(ev, countFor(ev)))}</span>`],
  ];
  return `<dl class="event-essentials">${facts.map(([title, value]) => `<div><dt>${title}</dt><dd>${value}</dd></div>`).join("")}</dl>`;
}

function briefing(ev) {
  const fields = [
    ["Included in your fee", ev.included],
    ["Practice facilities", ev.practice],
    ["RSVP by", ev.rsvp_deadline ? b.date(ev.rsvp_deadline) : ""],
    ["Pay by", ev.payment_due ? b.date(ev.payment_due) : ""],
    ["Cancellation deadline", ev.cancellation_deadline ? b.date(ev.cancellation_deadline) : ""],
  ].filter(([, value]) => value);
  return `${fields.length ? `<dl class="booking-facts">${fields.map(([label, value]) => `<div><dt>${label}</dt><dd class="preserve-lines">${e(value)}</dd></div>`).join("")}</dl>` : ""}${ev.cancellation_terms ? `<h3>Cancellation terms</h3><p class="preserve-lines">${e(ev.cancellation_terms)}</p><p class="muted">Withdrawing does not automatically cancel a fee or issue a refund. An organiser will review your booking.</p>` : ""}`;
}

function roster(ev) {
  if (!state.user) return '<p>Sign in to see the player list and tee times. <a href="account.html">Sign in</a></p>';
  const rows = responses.filter((r) => r.event_id === ev.id);
  const playing = rows.filter((r) => r.attending && !r.reserve);
  const waiting = rows.filter((r) => r.reserve);
  const payment = (id) => paymentOverview?.players?.find((p) => p.user_id === id)?.status || "unpaid";
  const label = (s) => s === "paid" ? "Paid · admin confirmed" : s === "pending" ? "Transfer reported · awaiting admin" : "Payment not confirmed";
  return `${ev.event_type !== "social" ? `<section id="memberTees-${ev.id}">Loading tee groups…</section>` : ""}<h3>${ev.event_type === "social" ? "Who’s attending" : "Who’s playing"} <span class="muted">(${playing.length})</span></h3>${playing.length ? `<ul class="roster">${playing.map((r) => `<li><strong>${e(r.name)}</strong>${paymentOverview ? `<span class="event-payment-status is-${payment(r.user_id)}"><i aria-hidden="true"></i>${label(payment(r.user_id))}</span>` : ""}</li>`).join("")}</ul>` : '<p class="muted">No confirmed players yet.</p>'}${waiting.length ? `<h3>Waiting list (${waiting.length})</h3><ol class="roster">${waiting.map((r) => `<li>${e(r.name)}</li>`).join("")}</ol>` : ""}`;
}

function updateHeroCover(url, credit) {
  const hero = list.querySelector(".event-detail-hero");
  const safe = b.safeUrl(url);
  if (!hero || !safe) return;
  hero.querySelector(".event-poster-image")?.remove();
  hero.insertAdjacentHTML("afterbegin", `<img class="event-poster-image" src="${safe}" alt="">`);
  const caption = list.querySelector("[data-cover-credit]");
  caption.innerHTML = credit;
  caption.hidden = !credit;
  bindImages();
}
function bindImages() {
  list.querySelectorAll(".event-poster-image").forEach((img) => {
    const fallback = () => { img.remove(); };
    img.onerror = fallback;
    if (img.complete && !img.naturalWidth) fallback();
  });
}

async function render() {
  const visible = events.filter((ev) => dedicated ? ev.id === eventId : filter === "past" ? ev.date < londonToday() : ev.date >= londonToday());
  const expanded = new Set([...list.querySelectorAll("[data-detail-section][open]")].map((node) => node.dataset.detailSection));
  if (!visible.length) {
    list.innerHTML = '<div class="panel">' + b.empty(dedicated ? "Event not found." : filter === "past" ? "No past events yet." : "The next round is on its way.", dedicated ? 'Return to Events to choose another golf day.' : filter === "past" ? "Completed 2027 golf days will appear here." : "The organisers are putting the 2027 calendar together.") + '</div>';
    return;
  }
  if (!dedicated) {
    list.innerHTML = visible.map(eventCard).join("");
    bindImages();
    return;
  }
  const ev = visible[0], r = own(ev.id);
  const ownTime = !ev.tee_times_dirty && tees.find((tee) => tee.event_id === ev.id && tee.players.some((player) => player.user_id === state.user?.id))?.tee_time;
  document.title = ev.name + " | Barford Golf Society";
  const closed = ev.cancelled || ev.date < londonToday();
  list.innerHTML = `<article class="event-detail" id="event-${ev.id}"><header class="event-detail-hero">${imageHTML(ev, true)}<div class="event-poster-content"><div class="event-poster-top"><span class="event-kind">${e(kind(ev))}</span>${ev.cancelled ? '<span class="event-booking-tag">Cancelled</span>' : r ? `<span class="event-booking-tag">${status(r)}</span>` : closed ? '<span class="event-booking-tag">Event complete</span>' : ""}</div><div class="event-poster-heading"><h1>${e(ev.name)}</h1>${place(ev) && place(ev) !== ev.name ? `<p>${e(place(ev))}</p>` : ""}</div></div></header><div class="event-photo-credit" data-cover-credit ${ev.cover_credit ? "" : "hidden"}>${e(ev.cover_credit || "")}</div>
    <div class="event-summary">${essentials(ev, ownTime)}${!closed ? `<p class="event-booking-link"><a href="index.html?event=${ev.id}#rsvp">${r ? "Manage your RSVP on Home" : "RSVP from your homepage"}<span aria-hidden="true"> ↗</span></a></p>` : ""}</div>
    ${ev.cancelled ? '<p class="notice" role="status">This event has been cancelled. Contact an organiser about any payment already made.</p>' : ""}${ev.event_notice ? `<p class="notice preserve-lines">${e(ev.event_notice)}</p>` : ""}
    <div class="event-information"><div id="eventExperience"></div>
    ${section("players", ev.event_type === "social" ? "Who’s attending" : "Players & tee groups", "Confirmed players and published times", roster(ev))}
    ${ev.event_type !== "social" && r?.buggy && r.attending && !r.reserve ? section("buggy", "Your buggy", "Partner, contact details and booking", '<div id="buggyPanel">Loading your buggy details…</div>') : ""}
    ${section("booking", "Booking & payment", "Fees, payment details and cancellation terms", briefing(ev) + (state.user ? '<div id="eventOperations">Loading your booking details…</div>' : '<p><a href="account.html">Sign in</a> to see your booking and payment details.</p>'))}
    </div></article>`;
  bindImages();
  const extra = document.getElementById("eventExperience");
  const mounts = [mountExperience(extra, ev, ownTime, { detail: true, onCover: (url, credit) => { if (extra.isConnected) updateHeroCover(url, credit); } })];
  const buggy = document.getElementById("buggyPanel");
  if (buggy) mounts.push(mountBuggy(buggy, ev));
  const operations = document.getElementById("eventOperations");
  if (operations) mounts.push(mountEventOperations(operations, ev, { showInvites: false, showBookingStatus: false, showBrief: false }));
  const teeArea = document.getElementById("memberTees-" + ev.id);
  if (teeArea) mounts.push(mountMemberTees(teeArea, ev.id));
  list.querySelectorAll("[data-detail-section]").forEach((node) => { node.open = expanded.has(node.dataset.detailSection); });
  await Promise.allSettled(mounts);
  list.querySelectorAll("[data-detail-section]").forEach((node) => {
    node.addEventListener("toggle", () => { if (node.open) refreshPrivate(node); });
  });
}

async function legacyRsvp() {
  const ev = events.find((row) => row.id === eventId);
  if (!dedicated || !ev || location.hash !== "#rsvp") return;
  await openRsvp(ev, b, { onSaved: () => load({ forceRender: true }) });
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
window.addEventListener("barford-signout", () => location.reload());
try {
  await load();
  await legacyRsvp();
  if (!dedicated && /^#event-\d+$/.test(location.hash)) document.querySelector(location.hash)?.scrollIntoView({ block: "start" });
} catch {
  list.innerHTML = '<div class="panel">' + b.empty("Events could not load.", "Please refresh the page or try again shortly.") + "</div>";
}
const refresh = () => {
  if (document.hidden) return;
  load().catch(() => {});
};
setInterval(refresh, 25000);
window.addEventListener("focus", refresh);
window.addEventListener("hashchange", legacyRsvp);
