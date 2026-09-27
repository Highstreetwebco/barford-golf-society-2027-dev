import { coordinates, distanceMetres, yardsBetween } from "./hole-map.js?v=2027-green-finder-test-4";

export function bearingTo(from, to) {
  const a = coordinates(from), b = coordinates(to);
  if (!a || !b) return null;
  const radians = Math.PI / 180;
  const delta = (b.lng - a.lng) * radians;
  const y = Math.sin(delta) * Math.cos(b.lat * radians);
  const x = Math.cos(a.lat * radians) * Math.sin(b.lat * radians) -
    Math.sin(a.lat * radians) * Math.cos(b.lat * radians) * Math.cos(delta);
  return (Math.atan2(y, x) / radians + 360) % 360;
}

export const angleTo = (bearing, heading) => ((bearing - heading + 540) % 360) - 180;

export function openGreenFinder(hole, courseName) {
  if (!hole?.reviewed || !coordinates(hole.green)) return;
  const dialog = document.createElement("dialog");
  dialog.className = "green-finder";
  dialog.setAttribute("aria-label", `Find green centre for hole ${hole.number}`);
  dialog.innerHTML = `<div class="finder-head"><div><small data-finder-course></small><h2>Find the green centre</h2></div><button type="button" class="secondary" data-finder-close>Close</button></div><div class="finder-camera"><video autoplay muted playsinline aria-label="Live camera view"></video><div class="finder-marker" hidden aria-hidden="true"><span>◇</span><strong>GREEN CENTRE</strong></div><p class="finder-arrow" hidden></p><p class="finder-prompt">Point your phone around to find the direction of the mapped green centre.</p></div><div class="finder-info"><p class="finder-test-label">TEST MODE · Works away from the course</p><p class="finder-elevation" data-finder-elevation>Vertical position pending · hold phone upright</p><small class="finder-elevation-credit" data-finder-credit hidden>Terrain elevation: Google Maps</small><strong data-finder-distance>GPS distance pending</strong><p role="status" data-finder-status>Camera, location and compass access are needed. Your position and camera stay on this phone.</p><button type="button" data-finder-start>Start direction view</button><p class="finder-caution">Direction guide only. Check the satellite map and your surroundings before playing. The pin may be elsewhere on the green.</p></div>`;
  document.body.append(dialog);
  dialog.showModal();
  const $ = (selector) => dialog.querySelector(selector);
  $("[data-finder-course]").textContent = `${courseName || "Course"} · Hole ${hole.number}`;
  let stream = null, watch = null, heading = null, position = null, accuracy = null;
  let pitch = null, verticalAngle = null, elevationPending = false, elevationAttempted = false;
  let lastFix = 0, closed = false, started = false;
  const freshness = setInterval(() => { if (started && !closed) update(); }, 3000);
  const status = (message) => { $("[data-finder-status]").textContent = message; };
  function update() {
    const marker = $(".finder-marker"), arrow = $(".finder-arrow");
    marker.hidden = arrow.hidden = true;
    if (!position || Date.now() - lastFix > 15000) {
      $("[data-finder-distance]").textContent = "Waiting for accurate GPS";
      if (started) status("Move into the open and wait for a fresh GPS fix. Use the satellite map if it stays unavailable.");
      return;
    }
    const yards = yardsBetween(position, hole.green);
    $("[data-finder-distance]").textContent = `${yards >= 1760 ? `${(yards / 1760).toFixed(1)} miles` : `${yards} yards`} to green centre · GPS ±${Math.round(accuracy)} m`;
    if (heading == null) {
      status("Compass direction unavailable. Your GPS distance is shown, but the camera marker cannot be positioned reliably.");
      return;
    }
    const delta = angleTo(bearingTo(position, hole.green), heading);
    const offCourse = yards >= 2187;
    const targetAngle = Number.isFinite(verticalAngle) ? verticalAngle : offCourse ? 0 : null;
    const verticalReady = Number.isFinite(pitch) && Number.isFinite(targetAngle);
    const verticalDelta = verticalReady ? targetAngle - pitch : null;
    $("[data-finder-elevation]").textContent = verticalReady
      ? Number.isFinite(verticalAngle)
        ? `Terrain angle ${verticalAngle > 1 ? "uphill" : verticalAngle < -1 ? "downhill" : "near level"} · ${Math.round(Math.abs(verticalAngle))}° · approximate`
        : "TEST: level-height reference only · green height unknown"
      : "Vertical position unavailable · horizontal direction only";
    const halfView = 28; // Approximate horizontal camera view; phones vary.
    if (Math.abs(delta) <= halfView && (!verticalReady || Math.abs(verticalDelta) <= 25)) {
      marker.hidden = false;
      marker.style.left = `${50 + delta / halfView * 42}%`;
      marker.style.top = verticalReady ? `${50 - verticalDelta / 25 * 38}%` : "42%";
      status(Number.isFinite(verticalAngle) ? "Approximate green-centre direction and height. Terrain and phone sensors may shift the marker." : verticalReady ? "Off-course tilt test: marker follows phone tilt using a level reference, not the green height." : "Horizontal direction only. Terrain height or phone tilt is unavailable.");
    } else {
      arrow.hidden = false;
      arrow.textContent = Math.abs(delta) > halfView
        ? `${delta < 0 ? "← Turn left" : "Turn right →"} · ${Math.round(Math.abs(delta))}° to green centre`
        : `${verticalDelta > 0 ? "↑ Tilt up" : "↓ Tilt down"} · approximate green-centre height`;
      status("The green centre is outside your camera view. Follow the cue, then check the map.");
    }
  }
  function orientation(event) {
    if (closed || !started) return;
    // Portrait only: with the rear camera, beta 90° points near the horizon.
    pitch = window.innerHeight >= window.innerWidth && Number.isFinite(event.beta) ? event.beta - 90 : null;
    if (Number.isFinite(event.webkitCompassHeading) &&
        (!Number.isFinite(event.webkitCompassAccuracy) || event.webkitCompassAccuracy <= 40)) {
      heading = event.webkitCompassHeading;
    } else if (event.absolute === true && Number.isFinite(event.alpha)) {
      heading = (360 - event.alpha + (screen.orientation?.angle || 0) + 360) % 360;
    } else return;
    update();
  }
  async function loadTerrainHeight(point) {
    if (elevationPending || elevationAttempted || distanceMetres(point, hole.green) > 2000) return;
    elevationAttempted = elevationPending = true;
    try {
      const { loadGoogleMaps } = await import("./hole-map.js?v=2027-green-finder-test-4");
      const maps = await loadGoogleMaps();
      const { ElevationService } = await maps.importLibrary("elevation");
      const { results } = await new ElevationService().getElevationForLocations({ locations: [point, hole.green] });
      if (closed || results?.length !== 2 || results.some(r => !Number.isFinite(r.elevation) || !Number.isFinite(r.resolution) || r.resolution > 30)) return;
      const distance = distanceMetres(point, hole.green);
      if (distance < 30) return;
      // Both terrain samples use the same vertical datum. Approximate eye height is 1.6m.
      verticalAngle = Math.atan2(results[1].elevation - results[0].elevation - 1.6, distance) * 180 / Math.PI;
      $("[data-finder-credit]").hidden = false;
      update();
    } catch {
      if (!closed) $("[data-finder-elevation]").textContent = "Terrain elevation unavailable · horizontal direction only";
    } finally { elevationPending = false; }
  }
  function cleanup() {
    if (closed) return;
    closed = true;
    if (watch != null) navigator.geolocation?.clearWatch(watch);
    clearInterval(freshness);
    stream?.getTracks().forEach((track) => track.stop());
    window.removeEventListener("deviceorientation", orientation);
    window.removeEventListener("deviceorientationabsolute", orientation);
    document.removeEventListener("visibilitychange", visibility);
    dialog.remove();
  }
  function visibility() { if (document.hidden && dialog.open) dialog.close(); }
  $("[data-finder-close]").onclick = () => dialog.close();
  dialog.addEventListener("close", cleanup, { once: true });
  document.addEventListener("visibilitychange", visibility);
  $("[data-finder-start]").onclick = async (event) => {
    if (started) return;
    event.currentTarget.disabled = true;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !navigator.geolocation) {
      status("This phone cannot provide camera and GPS in this browser. Use the satellite map instead.");
      event.currentTarget.disabled = false;
      return;
    }
    // Both permission requests begin inside the button gesture (needed on iPhone).
    let compassPermission;
    try { compassPermission = typeof window.DeviceOrientationEvent?.requestPermission === "function"
      ? window.DeviceOrientationEvent.requestPermission(true) : Promise.resolve("granted"); }
    catch { compassPermission = Promise.resolve("denied"); }
    const cameraPermission = navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "environment" } });
    started = true;
    status("Starting camera and locating you…");
    try {
      const [camera, compass] = await Promise.allSettled([cameraPermission, compassPermission]);
      if (closed) { if (camera.status === "fulfilled") camera.value.getTracks().forEach(track => track.stop()); return; }
      if (camera.status !== "fulfilled") { status("Camera access was denied or unavailable. Use the satellite map instead."); started = false; event.currentTarget.disabled = false; return; }
      stream = camera.value;
      $("video").srcObject = stream;
      $(".finder-prompt").hidden = true;
      $("video").play().catch(() => status("The camera could not start. Use the satellite map instead."));
      if (compass.status === "fulfilled" && compass.value === "granted") {
        window.addEventListener("deviceorientation", orientation);
        window.addEventListener("deviceorientationabsolute", orientation);
      }
      watch = navigator.geolocation.watchPosition((result) => {
        if (closed) return;
        const point = coordinates({ lat: result.coords.latitude, lng: result.coords.longitude });
        const age = Date.now() - result.timestamp;
        if (!point || !Number.isFinite(result.coords.accuracy) || result.coords.accuracy > 150 || age < 0 || age > 15000) {
          position = null; update(); return;
        }
        position = point; accuracy = result.coords.accuracy; lastFix = result.timestamp; update();
        if (accuracy <= 35) loadTerrainHeight(point);
      }, (error) => {
        position = null; update();
        status(error.code === 1 ? "Location access was denied. Use the satellite map instead." : "GPS could not find your position. Move into the open or use the map.");
      }, { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 });
      if (compass.status !== "fulfilled" || compass.value !== "granted") status("Compass access was denied. GPS distance may work, but the direction marker is unavailable.");
    } catch { status("The direction view could not start. Use the satellite map instead."); }
  };
  return dialog;
}
