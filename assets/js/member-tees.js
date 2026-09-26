import { photoUrls } from "./member-photos.js?v=2027-results-1";
const b = await window.barfordReady,
  e = b.escape;
const rendered = new WeakMap();
export async function mountMemberTees(area, eventId, { home = false } = {}) {
  if (!b.state.user) {
    area.innerHTML = "";
    return null;
  }
  const { data, error } = await b.client.rpc("event_tee_groups", {
    event: eventId,
  });
  if (error) {
    area.innerHTML =
      '<p class="notice">Tee groups could not load. Refresh to try again.</p>';
    return null;
  }
  if (data.status !== "published") {
    rendered.delete(area);
    area.innerHTML = `<p class="notice">${data.status === "reviewing" ? "The player list has changed. Organisers are reviewing the tee times." : data.status === "cancelled" ? "This event is cancelled." : "Your tee group will appear here once tee times are published."}</p>`;
    return null;
  }
  const own = data.groups.find((g) =>
    g.players.some((p) => p.user_id === b.state.user.id),
  );
  const urls = await photoUrls(
    data.groups.flatMap((g) => g.players.map((p) => p.avatar_path)),
  );
  const key = JSON.stringify([data, urls, home]);
  if (rendered.get(area) === key) return own?.tee_time || null;
  rendered.set(area, key);
  const expanded = area.querySelector(".all-tee-groups")?.open;
  const publication = data.published_at
    ? `<p class="muted">Published ${b.escape(new Date(data.published_at).toLocaleString("en-GB", { timeZone: "Europe/London" }))} UK time · Version ${data.revision}</p>`
    : "";
  const warning = data.provisional
    ? '<p class="notice">Handicaps are provisional until earlier rounds are published.</p>'
    : "";
  function card(g) {
    return `<section class="member-tee-card"><div class="section-heading"><h3>Group ${g.group_number}</h3><strong class="tee-clock">${e(g.tee_time)}</strong></div><ul class="member-tee-players">${g.players
      .map((p) => {
        const url = urls[p.avatar_path],
          initials = p.name
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((x) => x[0])
            .join("")
            .toUpperCase();
        return `<li>${url ? `<button class="portrait-button" data-portrait="${e(p.user_id)}" aria-label="Enlarge photo of ${e(p.name)}"><img src="${e(url)}" alt="${e(p.name)}" loading="lazy"></button>` : `<span class="portrait-initials" aria-label="No profile photo for ${e(p.name)}">${e(initials)}</span>`}<span><strong>${e(p.name)}${p.user_id === b.state.user.id ? " <small>(you)</small>" : ""}</strong><small>${p.handicap_secret ? "Handicap held by organisers to protect the secret rounds" : `${data.round_number ? "Round " + data.round_number : "Starting"} HCP: ${p.handicap ?? "Not set"}`}${p.type === "buggy" ? " · Buggy" : ""}</small></span></li>`;
      })
      .join("")}</ul></section>`;
  }
  area.innerHTML = home
    ? `<h2>Your tee group</h2>${publication}${warning}${own ? card(own) : "<p>You are not assigned to a published tee group for this event.</p>"}<details class="all-tee-groups"><summary class="button secondary">View all tee groups</summary><div class="tee-grid section">${data.groups.map(card).join("")}</div></details>`
    : `<h3>Tee times &amp; playing groups</h3>${publication}${warning}<div class="tee-grid">${data.groups.map(card).join("")}</div>`;
  if (expanded && area.querySelector(".all-tee-groups"))
    area.querySelector(".all-tee-groups").open = true;
  for (const button of area.querySelectorAll("[data-portrait]"))
    button.onclick = () => {
      const p = data.groups
          .flatMap((g) => g.players)
          .find((p) => p.user_id === button.dataset.portrait),
        url = urls[p?.avatar_path];
      if (!url) return;
      const dialog = document.createElement("dialog");
      dialog.className = "portrait-dialog";
      dialog.setAttribute("aria-label", p.name + " profile photo");
      dialog.innerHTML = `<img src="${e(url)}" alt="${e(p.name)}"><h2>${e(p.name)}</h2><button>Close photo</button>`;
      document.body.append(dialog);
      dialog.querySelector("button").onclick = () => dialog.close();
      dialog.onclose = () => dialog.remove();
      dialog.showModal();
    };
  return own?.tee_time || null;
}
