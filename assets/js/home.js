const b = await window.barfordReady;
if (b.state.user) {
  const a = document.getElementById("homeAccount");
  a.textContent = "My account";
}
const { data, error } = await b.client
  .from("events")
  .select("*")
  .gte("date", new Date().toLocaleDateString("en-CA"))
  .eq("cancelled", false)
  .order("date")
  .limit(1);
const area = document.getElementById("nextEvent");
if (error) {
  area.innerHTML = b.empty(
    "Unable to load the next event.",
    "Please try again shortly.",
  );
} else if (!data.length) {
  area.innerHTML = b.empty(
    "A new season is taking shape.",
    "The 2027 golf days will appear here as they’re announced. Your account will be ready when they are.",
  );
} else {
  const ev = data[0];
  area.innerHTML = `<div class="section-heading" style="margin:0"><div><p class="eyebrow">${b.escape(b.date(ev.date))}</p><h2>${b.escape(ev.name)}</h2><p class="muted">${b.escape(ev.location)}${ev.first_time ? " · " + b.escape(ev.first_time) : ""}</p></div><a class="button" href="events.html#event-${ev.id}">View &amp; RSVP</a></div>`;
}
