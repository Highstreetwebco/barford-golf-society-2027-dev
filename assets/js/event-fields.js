import { field, textfield } from "./operations.js?v=2027-results-1";

export function mountEventFields(form) {
  if (form.querySelector("[data-operation-fields]")) return;
  const area = form.querySelector("[data-event-extra-fields]") || document.createElement("div");
  area.className = "full";
  area.dataset.operationFields = "";
  area.innerHTML = `<details><summary>Additional booking details</summary><div class="form-grid section">${field("Hosting course member price (£)", "course_member_price", "", "number", 'min="0" step="0.01" inputmode="decimal"')}${field("RSVP deadline (end of UK day)", "rsvp_deadline", "", "date")}${field("Payment due", "payment_due", "", "date")}${field("Cancellation deadline (end of UK day)", "cancellation_deadline", "", "date")}${field("Places committed to course / venue", "committed_places", 0, "number", 'min="0" step="1"')}${field("Tee interval (minutes)", "tee_interval", 8, "number", 'min="1" max="60" step="1"')}${textfield("Included in the price", "included")}${textfield("Practice facilities", "practice")}${textfield("Important event notice", "event_notice")}${textfield("Cancellation terms members must accept", "cancellation_terms")}</div><p class="muted">Prices apply to new confirmed bookings. Existing charges keep their agreed amount and can be adjusted in Payments. Leave unknown prices blank.</p></details>`;
  if (!area.isConnected) form.querySelector(".actions.full")?.before(area);
  form.elements.event_type.addEventListener("change", () => updateEventType(form));
  updateEventType(form);
}

export function updateEventType(form) {
  const type = form.elements.event_type.value;
  const social = type === "social", league = type === "league";
  const round = form.elements.round_number;
  if (round) {
    round.disabled = !league;
    round.required = league;
    round.closest("label").hidden = !league;
    if (!league) round.value = "";
  }
  for (const name of ["practice", "tee_interval", "course_member_price", "round_hours"]) {
    const label = form.elements[name]?.closest("label");
    if (label) label.hidden = social;
  }
  const label = form.elements.first_time?.closest("label");
  if (label) {
    const text = [...label.childNodes].find(node => node.nodeType === 3);
    if (text) text.textContent = social ? "Event start time" : "First tee time";
  }
}

export function eventFields(form) {
  const f = new FormData(form), out = {};
  for (const name of [
    "event_type", "refreshment_time", "included", "practice", "event_notice",
    "course_phone", "rsvp_deadline", "payment_due", "cancellation_deadline", "cancellation_terms",
  ]) out[name] = f.get(name) || null;
  if (!["league", "pairs", "social"].includes(out.event_type)) throw new Error("Choose an event type.");
  if (out.event_type === "league") {
    const round = Number(f.get("round_number"));
    if (!Number.isInteger(round) || round < 1 || round > 7) throw new Error("Choose a league round from 1 to 7.");
    out.round_number = round;
  } else out.round_number = null;
  for (const name of ["member_price", "guest_price", "course_member_price"]) {
    const value = f.get(name);
    out[name] = value == null || value === "" ? null : Number(value);
  }
  out.committed_places = Number(f.get("committed_places") || 0);
  out.tee_interval = Number(f.get("tee_interval") || 8);
  // Clear removed briefing fields so old details cannot linger on member pages.
  for (const name of ["arrival_time", "parking", "course_layout", "format_rules", "price"]) out[name] = null;
  if (out.event_type === "social") {
    out.practice = null;
    out.course_member_price = null;
  }
  return out;
}
