function coordinates(event) {
  const lat = event.latitude, lon = event.longitude;
  return typeof lat === "number" && Number.isFinite(lat) && Math.abs(lat) <= 90
    && typeof lon === "number" && Number.isFinite(lon) && Math.abs(lon) <= 180
    ? `${lat},${lon}` : "";
}

export function navigationLinks(event) {
  // An address edited by the organiser takes priority over an older map pin.
  const address = String(event.address || "").trim();
  const destination = address || coordinates(event);
  if (!destination) return { destination: "", links: [] };
  const encoded = encodeURIComponent(destination);
  return { destination, links: [
    { name: "Google Maps", url: `https://www.google.com/maps/dir/?api=1&destination=${encoded}&travelmode=driving&dir_action=navigate` },
    { name: "Waze", url: `https://waze.com/ul?${address ? "q" : "ll"}=${encoded}&navigate=yes&utm_source=barfordgolf` },
    { name: "Apple Maps", url: `https://maps.apple.com/directions?destination=${encoded}&mode=driving` },
  ] };
}

export function openDirections(event, b, trigger = document.activeElement) {
  if (document.querySelector("dialog.event-directions-dialog[open]")) return;
  const { destination, links } = navigationLinks(event), e = b.escape;
  const region = trigger?.closest("#homeTeeGroup, #nextEvent, #eventList")?.id;
  const dialog = document.createElement("dialog");
  dialog.className = "event-directions-dialog";
  dialog.setAttribute("aria-labelledby", "directionsTitle");
  dialog.innerHTML = `<h2 id="directionsTitle">Directions to event</h2><p class="directions-event">${e(event.name)}</p>
    ${destination ? `<p class="directions-address">${e(destination)}</p><p class="muted">Choose an app for driving directions from your current location.</p><div class="directions-options">${links.map(link => `<a class="button secondary" href="${e(link.url)}" target="_blank" rel="noopener noreferrer">${link.name}<span aria-hidden="true">↗</span></a>`).join("")}</div>` : '<p class="notice">The event address hasn’t been added yet. Please contact the committee for directions.</p>'}
    <div class="actions">${destination ? '<button type="button" class="secondary" data-copy-address>Copy address</button>' : ""}<button type="button" data-close-directions>Close</button></div><p class="form-status" role="status"></p>`;
  document.body.append(dialog);
  dialog.querySelector("[data-close-directions]").onclick = () => dialog.close();
  const copy = dialog.querySelector("[data-copy-address]");
  if (copy) copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(destination);
      dialog.querySelector('[role="status"]').textContent = "Address copied.";
    } catch { dialog.querySelector('[role="status"]').textContent = "Select and copy the address above."; }
  };
  dialog.addEventListener("keydown", key => { if (key.key === "Escape") key.stopPropagation(); });
  dialog.addEventListener("close", () => {
    dialog.remove();
    requestAnimationFrame(() => {
      const target = trigger?.isConnected ? trigger : document.getElementById(region)?.querySelector("[data-event-directions]");
      target?.focus({ preventScroll: true });
    });
  }, { once: true });
  dialog.showModal();
  dialog.querySelector("a, [data-close-directions]").focus({ preventScroll: true });
}
