import { mountEventOperations } from "./operations.js?v=2027-operations-1";
import { mountMemberTees } from "./member-tees.js?v=2027-operations-1";
import {
  mountExperience,
  updateSlots,
  londonToday,
} from "./event-experience.js?v=2027-operations-1";
const b = await window.barfordReady;
const area = document.getElementById("nextEvent");
if (b.state.user) {
  const a = document.getElementById("homeAccount");
  a.textContent = "My account";
  a.href = "account.html";
  document.querySelector(".home-hero h1").textContent =
    "Welcome back, " +
    (b.state.profile?.full_name?.split(" ")[0] || "golfer") +
    ".";
}
const { data, error } = await b.client
  .from("events")
  .select("*")
  .gte("date", londonToday())
  .eq("cancelled", false)
  .order("date")
  .limit(1);
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
  area.innerHTML = `<div class="section-heading"><div><p class="eyebrow">${b.escape(b.date(ev.date))}</p><h2>${b.escape(ev.name)}</h2></div><a class="button" href="event.html?id=${ev.id}#rsvp">RSVP & event details</a></div><section id="homeOperations" class="panel section"></section><section id="homeTeeGroup" class="panel section" ${b.state.user ? "" : "hidden"}></section><div id="homeExperience"></div>`;
  let ownTime = null;
  const groupArea = document.getElementById("homeTeeGroup");
  await mountEventOperations(document.getElementById("homeOperations"), ev, {
    compact: true,
  });
  if (b.state.user && ev.event_type !== "social")
    ownTime = await mountMemberTees(groupArea, ev.id, { home: true });
  const detail = document.getElementById("homeExperience");
  await mountExperience(detail, ev, ownTime);
  await updateSlots(ev, detail);
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
        await mountExperience(detail, ev, ownTime);
      }
      await updateSlots(ev, detail);
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
          await mountExperience(detail, ev, ownTime);
          await updateSlots(ev, detail);
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
