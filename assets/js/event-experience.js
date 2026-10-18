// Small shared helpers for the member event pages. Course maps load on demand.
export const londonToday = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
}).format(new Date());

export function slots(event, count) {
  if (event.cancelled) return "Event cancelled";
  if (count == null) return "Places checked when you RSVP";
  const total = Number(count);
  if (event.max_players == null) return `${total} ${event.event_type === "social" ? "attending" : "playing"}`;
  const left = Math.max(0, Number(event.max_players) - total);
  return left ? `${left} ${left === 1 ? "place" : "places"} available` : "Full · waiting list available";
}

export function directions(event) {
  const destination = event.latitude != null && event.longitude != null
    ? `${event.latitude},${event.longitude}`
    : event.address || event.location || event.course_name || event.name;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

let holeStyles;
function ensureHoleStyles() {
  if (holeStyles) return holeStyles;
  holeStyles = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "assets/css/holes.css?v=2027-simple-1";
    css.dataset.holeStyles = "true";
    css.onload = resolve;
    css.onerror = () => { css.remove(); holeStyles = null; reject(new Error("Course styles unavailable")); };
    document.head.append(css);
  });
  return holeStyles;
}

export async function openCourseHoles(event, b, button) {
  if (!event || event.cancelled || event.event_type === "social") {
    b.toast("Choose a golf event to open its course hole view.");
    return;
  }
  if (button?.getAttribute("aria-busy") === "true") return;
  button?.setAttribute("aria-busy", "true");
  try {
    if (!b.state.user && !(await b.requireMember())) return;
    const [, { openHolePicker }] = await Promise.all([
      ensureHoleStyles(), import("./hole-view.js?v=2027-par-camera-1"),
    ]);
    openHolePicker(event, b);
  } catch {
    b.toast("The course hole view could not open. Please try again.");
  } finally {
    button?.removeAttribute("aria-busy");
  }
}

export async function updateSlots(event, root = document) {
  const b = await window.barfordReady;
  const { data, error } = await b.client.rpc("event_counts");
  const count = error ? null : (data || []).find((row) => Number(row.event_id) === Number(event.id))?.playing || 0;
  root.querySelectorAll("[data-live-slots]").forEach((node) => {
    node.textContent = slots(event, count);
  });
}
