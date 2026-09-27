import { coordinates, yardsBetween } from "./hole-map.js?v=2027-holes-1";

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
  dialog.innerHTML = `<div class="finder-head"><div><small data-finder-course></small><h2>Find the green centre</h2></div><button type="button" class="secondary" data-finder-close>Close</button></div><div class="finder-camera"><video autoplay muted playsinline aria-label="Live camera view"></video><div class="finder-marker" hidden aria-hidden="true"><span>◇</span><strong>GREEN CENTRE</strong></div><p class="finder-arrow" hidden></p><p class="finder-prompt">Point your phone around to find the direction of the mapped green centre.</p></div><div class="finder-info"><p class="finder-test-label">TEST MODE · Works away from the course</p><strong data-finder-distance>GPS distance pending</strong><p role="status" data-finder-status>Camera, location and compass access are needed. Your position and camera stay on this phone.</p><button type="button" data-finder-start>Start direction view</button><p class="finder-caution">Direction guide only. Check the satellite map and your surroundings before playing. The pin may be elsewhere on the green.</p></div>`;
  document.body.append(dialog);
  dialog.showModal();
  const $ = (selector) => dialog.querySelector(selector);
  $("[data-finder-course]").textContent = `${courseName || "Course"} · Hole ${hole.number}`;
  let stream = null, watch = null, heading = null, position = null, accuracy = null;
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
    const halfView = 28; // Approximate horizontal camera view; phones vary.
    if (Math.abs(delta) <= halfView) {
      marker.hidden = false;
      marker.style.left = `${50 + delta / halfView * 42}%`;
      status("Turn slowly. This marker points towards the mapped green centre, with GPS and compass uncertainty.");
    } else {
      arrow.hidden = false;
      arrow.textContent = `${delta < 0 ? "← Turn left" : "Turn right →"} · ${Math.round(Math.abs(delta))}° to green centre`;
      status("The green centre is outside your camera view. Follow the arrow, then check the map.");
    }
  }
  function orientation(event) {
    if (closed || !started) return;
    if (Number.isFinite(event.webkitCompassHeading) &&
        (!Number.isFinite(event.webkitCompassAccuracy) || event.webkitCompassAccuracy <= 40)) {
      heading = event.webkitCompassHeading;
    } else if (event.absolute === true && Number.isFinite(event.alpha)) {
      heading = (360 - event.alpha + (screen.orientation?.angle || 0) + 360) % 360;
    } else return;
    update();
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
        if (!point || !Number.isFinite(result.coords.accuracy) || result.coords.accuracy > 35 || age < 0 || age > 15000) {
          position = null; update(); return;
        }
        position = point; accuracy = result.coords.accuracy; lastFix = result.timestamp; update();
      }, (error) => {
        position = null; update();
        status(error.code === 1 ? "Location access was denied. Use the satellite map instead." : "GPS could not find your position. Move into the open or use the map.");
      }, { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 });
      if (compass.status !== "fulfilled" || compass.value !== "granted") status("Compass access was denied. GPS distance may work, but the direction marker is unavailable.");
    } catch { status("The direction view could not start. Use the satellite map instead."); }
  };
  return dialog;
}
