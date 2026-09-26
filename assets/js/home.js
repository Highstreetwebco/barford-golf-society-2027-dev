import { mountPersonalResults } from "./league-view.js?v=2027-results-1";
import { guestAction } from "./guest-invites.js?v=2027-results-1";
import { mountEventOperations } from "./operations.js?v=2027-results-1";
import { mountMemberTees } from "./member-tees.js?v=2027-results-1";
import {
  mountExperience,
  updateSlots,
  londonToday,
} from "./event-experience.js?v=2027-results-1";
const b = await window.barfordReady;
const area = document.getElementById("nextEvent");
const personal = document.getElementById("personalResults");
mountPersonalResults(personal, b);
window.addEventListener("focus", () => mountPersonalResults(personal, b));
setInterval(() => {
  if (!document.hidden) mountPersonalResults(personal, b);
}, 30000);
if (b.state.user) {
  const a = document.getElementById("homeAccount");
  a.textContent = "My account";
  a.href = "account.html";
  document.querySelector(".home-hero h1").textContent =
    "Welcome back, " +
    (b.state.profile?.full_name?.split(" ")[0] || "golfer") +
    ".";
}
let guestHome = null;
if (b.state.user) {
  try {
    guestHome = await guestAction("mine");
  } catch {}
}
const guestNext = (guestHome?.bookings || []).find(
  (x) => x.attending || x.reserve,
);
let eventQuery = b.client
  .from("events")
  .select("*")
  .gte("date", londonToday())
  .eq("cancelled", false)
  .order("date");
if (guestHome?.category === "guest" && guestNext)
  eventQuery = eventQuery.eq("id", guestNext.event_id);
const { data, error } = await eventQuery.limit(1);
if (error)
  area.innerHTML = b.empty(
    "Unable to load the next event.",
    "Please try again shortly.",
  );
else if (!data?.length)
  area.innerHTML = b.empty(
    "A new season is taking shape.",
    "The 2027 golf days will appear here as they’re announced. Create your account now so you’re ready for the first RSVP.",
  );
else {
  const ev = data[0];
  area.classList.add("has-event");
  area.innerHTML = `<div class="section-heading next-event-heading"><div><p class="eyebrow">${b.escape(b.date(ev.date))}</p><h2>${b.escape(ev.name)}</h2></div><a class="button" href="event.html?id=${ev.id}#rsvp">RSVP & event details</a></div><div class="next-event-facts"><span><small>FIRST TEE</small><strong>${b.escape(ev.first_time || "To be announced")}</strong></span><span><small>LIVE AVAILABILITY</small><strong data-live-slots>Checking spaces…</strong></span><span><small>THE COURSE</small><strong>${b.escape(ev.location || ev.name)}</strong></span></div><div class="home-member-grid"><section id="homeOperations" class="panel section"></section><section id="homeTeeGroup" class="panel section" ${b.state.user ? "" : "hidden"}></section></div><details class="home-guide"><summary>Course guide, directions & forecast <span aria-hidden="true">↗</span></summary><div id="homeExperience"></div></details>`;
  let ownTime = null;
  const groupArea = document.getElementById("homeTeeGroup");
  await mountEventOperations(document.getElementById("homeOperations"), ev, {
    compact: true,
  });
  if (b.state.user && ev.event_type !== "social")
    ownTime = await mountMemberTees(groupArea, ev.id, { home: true });
  const detail = document.getElementById("homeExperience");
  let experienceLoaded = false;
  let experienceLoading = false;
  async function showExperience() {
    if (experienceLoading) return;
    experienceLoading = true;
    try {
      await mountExperience(detail, ev, ownTime);
      experienceLoaded = true;
      await updateSlots(ev, area);
    } finally {
      experienceLoading = false;
    }
  }
  area.querySelector(".home-guide").addEventListener("toggle", (event) => {
    if (event.currentTarget.open && !experienceLoaded) showExperience();
  });
  await updateSlots(ev, area);
  let refreshing = false;
  async function refreshEvent() {
    if (document.hidden || refreshing) return;
    refreshing = true;
    try {
      const current = await b.client
        .from("events")
        .select("*")
        .eq("id", ev.id)
        .single();
      if (
        !current.error &&
        current.data &&
        JSON.stringify(current.data) !== JSON.stringify(ev)
      ) {
        Object.assign(ev, current.data);
        if (ev.cancelled) {
          location.reload();
          return;
        }
        if (experienceLoaded) await mountExperience(detail, ev, ownTime);
      }
      await updateSlots(ev, area);
      if (
        b.state.user &&
        !document
          .getElementById("homeOperations")
          .contains(document.activeElement)
      )
        await mountEventOperations(
          document.getElementById("homeOperations"),
          ev,
          { compact: true },
        );
      if (b.state.user && ev.event_type !== "social") {
        const updated = await mountMemberTees(groupArea, ev.id, { home: true });
        if (updated !== ownTime) {
          ownTime = updated;
          if (experienceLoaded) await mountExperience(detail, ev, ownTime);
          await updateSlots(ev, area);
        }
      }
    } finally {
      refreshing = false;
    }
  }
  setInterval(refreshEvent, 25000);
  window.addEventListener("focus", refreshEvent);
}

window.addEventListener("barford-signout", () => location.reload());
