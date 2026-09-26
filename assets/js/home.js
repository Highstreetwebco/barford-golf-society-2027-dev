import {
  mountExperience,
  updateSlots,
  londonToday,
} from "./event-experience.js?v=2027-experience-1";
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
  area.innerHTML = `<div class="section-heading"><div><p class="eyebrow">${b.escape(b.date(ev.date))}</p><h2>${b.escape(ev.name)}</h2></div><a class="button" href="event.html?id=${ev.id}#rsvp">RSVP & event details</a></div><div id="homeExperience"></div>`;
  let ownTime = null;
  if (b.state.user && !ev.tee_times_dirty) {
    const t = await b.client
      .from("tee_times")
      .select("*")
      .eq("event_id", ev.id);
    ownTime = t.data?.find((x) =>
      x.players.some((p) => p.user_id === b.state.user.id),
    )?.tee_time;
  }
  const detail = document.getElementById("homeExperience");
  await mountExperience(detail, ev, ownTime);
  await updateSlots(ev, detail);
  setInterval(() => {
    if (!document.hidden) updateSlots(ev, detail);
  }, 25000);
  window.addEventListener("focus", () => updateSlots(ev, detail));
}
