import { field, textfield } from "./operations.js?v=2027-refined-1";
export function mountEventFields(form) {
  if (form.querySelector("[data-operation-fields]")) return;
  const area = document.createElement("div");
  area.className = "full";
  area.dataset.operationFields = "";
  area.innerHTML = `<h3>Event format</h3><label>Type<select name="event_type"><option value="league">League round / individual golf</option><option value="pairs">Pairs / Invitational</option><option value="social">Social / presentation evening</option></select></label><details class="section" open><summary>Arrival & event briefing</summary><div class="form-grid section">${field("Arrive from (UK time)", "arrival_time", "", "time")}${field("Refreshments from (UK time)", "refreshment_time", "", "time")}${field("Course / venue telephone", "course_phone", "", "tel", 'maxlength="40"')}${textfield("Included in the price", "included")}${textfield("Parking and access", "parking")}${textfield("Practice facilities (golf only)", "practice")}${textfield("Course layout / loops (golf only)", "course_layout")}${textfield("Format and playing rules", "format_rules")}${textfield("Important event notice", "event_notice")}</div></details><details class="section"><summary>Prices & deadlines</summary><div class="form-grid section">${field("Society member price (£)", "member_price", "", "number", 'min="0" step="0.01"')}${field("Guest price (£)", "guest_price", "", "number", 'min="0" step="0.01"')}${field("Hosting course member price (£)", "course_member_price", "", "number", 'min="0" step="0.01"')}${field("RSVP deadline (end of UK day)", "rsvp_deadline", "", "date")}${field("Payment due", "payment_due", "", "date")}${field("Cancellation deadline (end of UK day)", "cancellation_deadline", "", "date")}${textfield("Cancellation terms members must accept", "cancellation_terms")}${field("Places committed to course / venue", "committed_places", 0, "number", 'min="0" step="1"')}${field("Tee interval (minutes, golf only)", "tee_interval", 8, "number", 'min="1" max="60" step="1"')}</div><p>Prices create charges for confirmed bookings. Existing charges retain their agreed amount; adjust them in Payments. Leave unknown prices blank. No payment or refund happens automatically.</p></details>`;
  form.querySelector("button[type=submit]")?.closest(".actions")?.before(area);
  if (!area.isConnected) form.prepend(area);
  form.elements.event_type.addEventListener("change", () =>
    updateEventType(form),
  );
}
export function updateEventType(form) {
  const social = form.elements.event_type.value === "social";
  form.elements.round_number.disabled =
    form.elements.event_type.value !== "league";
  if (form.elements.round_number.disabled)
    form.elements.round_number.value = "";
  for (const n of [
    "practice",
    "course_layout",
    "tee_interval",
    "course_member_price",
  ]) {
    form.elements[n].closest("label").hidden = social;
  }
  const label = form.elements.first_time?.closest("label");
  if (label) {
    let text = [...label.childNodes].find((x) => x.nodeType === 3);
    if (text) text.textContent = social ? "Event start time" : "First tee time";
  }
}
export function eventFields(form) {
  const f = new FormData(form),
    out = {};
  for (const n of [
    "event_type",
    "arrival_time",
    "refreshment_time",
    "included",
    "parking",
    "practice",
    "course_layout",
    "event_notice",
    "format_rules",
    "course_phone",
    "rsvp_deadline",
    "payment_due",
    "cancellation_deadline",
    "cancellation_terms",
  ])
    out[n] = f.get(n) || null;
  for (const n of ["member_price", "guest_price", "course_member_price"])
    out[n] = f.get(n) === "" ? null : Number(f.get(n));
  out.committed_places = Number(f.get("committed_places") || 0);
  out.tee_interval = Number(f.get("tee_interval") || 8);
  if (out.event_type !== "league") out.round_number = null;
  return out;
}
