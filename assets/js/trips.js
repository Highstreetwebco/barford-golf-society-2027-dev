const b = await window.barfordReady;
const { client: c, escape: e, state } = b;
const area = document.getElementById("tripList");
async function load() {
  const { data, error } = await c
    .from("trip_events")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    area.textContent = "Trips could not load. Please try again.";
    return;
  }
  let votes = [];
  if (state.user) {
    const result = await c.from("trip_votes").select("*");
    if (result.error) {
      area.textContent = "Responses could not load. Please try again.";
      return;
    }
    votes = result.data;
  }
  area.innerHTML = data.length
    ? data
        .map((trip) => {
          const responses = votes.filter((v) => v.event_id === trip.id),
            own = responses.find((v) => v.user_id === state.user?.id);
          return `<article class="panel trip-card"><div class="section-heading"><h2>${e(trip.name)}</h2>${state.admin ? `<button class="danger" data-delete="${trip.id}">Delete</button>` : ""}</div>${b.safeUrl(trip.video) ? `<video src="${b.safeUrl(trip.video)}" controls playsinline preload="metadata"></video>` : ""}${state.user ? `<p class="muted">${responses.filter((v) => v.vote === "yes").length} interested${own ? " · Your response is saved" : ""}</p>` : ""}<form data-trip="${trip.id}" class="rsvp-form"><fieldset><legend>Interested in this trip?</legend><div class="choices"><label><input type="radio" name="choice" value="yes" required ${own?.vote === "yes" ? "checked" : ""}><span>Yes, I’m interested</span></label><label><input type="radio" name="choice" value="no" required ${own?.vote === "no" ? "checked" : ""}><span>Not this time</span></label></div></fieldset><button>${state.user ? (own ? "Update response" : "Save response") : "Sign in to respond"}</button><p class="form-status" role="status"></p></form>${state.admin ? `<details class="event-details"><summary>Member responses (${responses.length})</summary><ul class="roster">${responses.map((v) => `<li>${e(v.name)}<span>${v.vote === "yes" ? "Interested" : "Not interested"}</span></li>`).join("")}</ul></details>` : ""}</article>`;
        })
        .join("")
    : '<div class="panel">' +
      b.empty(
        "Something to look forward to.",
        "Society trips will appear here when the organisers have something planned.",
      ) +
      "</div>";
  area.querySelectorAll("form").forEach(
    (form) =>
      (form.onsubmit = (ev) => {
        ev.preventDefault();
        b.submit(form, async () => {
          if (!(await b.requireMember())) return;
          const { error } = await c.rpc("vote", {
            event: Number(form.dataset.trip),
            choice: new FormData(form).get("choice"),
          });
          if (error) throw error;
          await load();
          b.toast("Your response is saved.");
        });
      }),
  );
  area.querySelectorAll("[data-delete]").forEach(
    (button) =>
      (button.onclick = async () => {
        if (!confirm("Delete this trip and its responses?")) return;
        const trip = data.find((t) => t.id === Number(button.dataset.delete));
        const { error } = await c
          .from("trip_events")
          .delete()
          .eq("id", trip.id);
        if (error) return b.toast(error.message);
        await load();
      }),
  );
}
document.getElementById("tripForm").onsubmit = (ev) => {
  ev.preventDefault();
  b.submit(ev.target, async () => {
    const name = document.getElementById("tripName").value.trim(),
      file = document.getElementById("tripVideo").files[0];
    if (!name) throw new Error("Enter a trip name.");
    let video = null,
      path = null;
    if (file) {
      if (file.size > 50 * 1024 * 1024)
        throw new Error("Choose a video smaller than 50 MB.");
      path = crypto.randomUUID() + "_" + file.name.replace(/[^\w.-]/g, "_");
      const { error } = await c.storage.from("trip-videos").upload(path, file);
      if (error) throw error;
      video = c.storage.from("trip-videos").getPublicUrl(path).data.publicUrl;
    }
    const { error } = await c.from("trip_events").insert({ name, video });
    if (error) {
      if (path) await c.storage.from("trip-videos").remove([path]);
      throw error;
    }
    ev.target.reset();
    await load();
    b.toast("Trip added.");
  });
};
await load();
