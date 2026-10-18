// A member edits one saved RSVP. submit_rsvp also enforces this in the database.
import { londonToday } from "./event-experience.js?v=2027-simple-1";

export const rsvpClosed = (event) => event.cancelled || event.date < londonToday();
export const rsvpChangeLocked = (event, response, admin = false) => {
  if (!response || admin) return false;
  const cutoff = new Date(`${event.date}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 6);
  return londonToday() >= cutoff.toISOString().slice(0, 10);
};
export const teeTimesPublished = (event) => event.event_type !== "social" && !!event.tee_published_at;
export const withdrawalNotice = "If you need to withdraw from the event please contact the committee.";
export function rsvpStatus(event, response) {
  if (event.cancelled) return { label: "Event cancelled", tone: "neutral" };
  if (!response) return { label: "You haven’t replied yet", tone: "neutral" };
  if (response.reserve) return { label: "You’re on the waiting list", tone: "waiting" };
  if (response.attending) return { label: event.event_type === "social" ? "You’re attending" : "You’re playing", tone: "confirmed" };
  return { label: "You’re not attending this time", tone: "neutral" };
}
export function rsvpButtonLabel(event, response, signedIn) {
  if (teeTimesPublished(event)) return "View tee times";
  return !signedIn ? "Sign in to RSVP" : response ? "Change your RSVP" : "RSVP";
}
let opening = false;

export async function openRsvp(event, b, { onSaved } = {}) {
  if (opening || document.querySelector("dialog.rsvp-dialog[open]")) return;
  opening = true;
  const ev = { ...event };
  const trigger = document.activeElement;
  let dialog, saving = false;
  try {
    if (!b.state.user && !(await b.requireMember())) return;
    const e = b.escape;
    dialog = document.createElement("dialog");
    dialog.id = `rsvp-${ev.id}`;
    dialog.className = "rsvp-dialog simple-rsvp-dialog";
    dialog.setAttribute("aria-labelledby", `rsvp-title-${ev.id}`);
    document.body.append(dialog);
    dialog.addEventListener("cancel", (cancelEvent) => { if (saving) cancelEvent.preventDefault(); });
    dialog.addEventListener("close", () => {
      dialog.remove();
      if (trigger?.isConnected && !trigger.disabled) trigger.focus({ preventScroll: true });
      else document.querySelector("[data-home-rsvp], [data-rsvp], #homeRsvp")?.focus({ preventScroll: true });
    }, { once: true });

    async function loadResponse() {
      dialog.innerHTML = `<h2 id="rsvp-title-${ev.id}">Your RSVP</h2><p>${e(ev.name)}</p><p role="status">Checking your saved response…</p><button type="button" class="secondary" data-cancel>Close</button>`;
      dialog.querySelector("[data-cancel]").onclick = () => dialog.close();
      // Always read the latest record, including after signing in on another device.
      const [own, current] = await Promise.all([
        b.client.from("rsvps").select("*").eq("event_id", ev.id).eq("user_id", b.state.user.id).maybeSingle(),
        b.client.from("events").select("*").eq("id", ev.id).maybeSingle(),
      ]);
      if (!dialog.isConnected || !dialog.open) return;
      if (own.error || current.error) {
        dialog.querySelector("[role=status]").textContent = "We couldn’t check your saved RSVP. Try again before making any changes.";
        const retry = document.createElement("button");
        retry.type = "button";
        retry.textContent = "Try again";
        retry.onclick = loadResponse;
        dialog.append(retry);
        return;
      }
      const r = own.data;
      if (!current.data || Number(current.data.id) !== Number(ev.id)) {
        dialog.querySelector("[role=status]").textContent = "This event is no longer available.";
        return;
      }
      Object.assign(ev, current.data);
      if (rsvpClosed(ev) || teeTimesPublished(ev) || rsvpChangeLocked(ev, r, b.state.admin)) {
        dialog.querySelector("[role=status]").textContent = ev.cancelled ? "This event has been cancelled. Contact the committee if you have a booking."
          : ev.date < londonToday() ? "This event has finished."
          : teeTimesPublished(ev) ? `Tee times are published. ${withdrawalNotice}`
          : "Online changes close six days before the event. Please contact the committee to change your RSVP.";
        return;
      }
      const late = ev.rsvp_deadline && ev.rsvp_deadline < londonToday() && !(r?.attending || r?.reserve) && !b.state.admin;
      const isSocial = ev.event_type === "social";
      dialog.innerHTML = `<form class="rsvp-form">
        <h2 id="rsvp-title-${ev.id}">${r ? "Change your RSVP" : "Your RSVP"}</h2>
        <p class="rsvp-event-name">${e(ev.name)}<br>${e(b.date(ev.date))}</p>
        <p class="simple-rsvp-identity"><strong>${e(b.state.profile?.full_name || "Your account")}</strong><span>${r ? "Your saved response will be updated." : "Your RSVP is saved to your account."}</span></p>
        ${late ? '<p class="notice">The RSVP deadline has passed. Please contact the committee if you would like to attend.</p>' : ""}
        ${r?.reserve ? '<p class="notice">Your place is on the waiting list. Your preferences are already saved.</p>' : ""}
        <fieldset><legend>${isSocial ? "Will you attend?" : "Are you playing?"}</legend><div class="choices">
          <label><input type="radio" name="attending" value="yes" ${r && (r.attending || r.reserve) ? "checked" : ""} ${late ? "disabled" : ""} required><span>${isSocial ? "Yes, I’m attending" : "Yes, I’m playing"}</span></label>
          <label><input type="radio" name="attending" value="no" ${r && !r.attending && !r.reserve ? "checked" : ""} required><span>Not this time</span></label>
        </div></fieldset>
        <div data-playing hidden>
          <label class="check simple-buggy-choice"><input type="checkbox" name="buggy" ${r?.buggy ? "checked" : ""}> I need a buggy</label>
          <details class="simple-rsvp-options"><summary>Tee time preference (optional)</summary>
            <label for="rsvp-time-${ev.id}">Preferred tee time</label><select id="rsvp-time-${ev.id}" name="preferred_time">
              ${[["", "No preference"], ["First", "Early"], ["Middle", "Middle"], ["End", "Late"]].map(([value, label]) => `<option value="${value}" ${(r?.preferred_time || "") === value ? "selected" : ""}>${label}</option>`).join("")}
            </select><p class="muted">The committee will do its best to accommodate requests.</p>
          </details>
          <small>Buggy requests are subject to availability.</small>
        </div>
        ${ev.cancellation_terms ? `<div data-terms hidden><p class="notice preserve-lines">${e(ev.cancellation_terms)}</p><label class="check"><input type="checkbox" name="accept_terms" ${r?.terms_snapshot === ev.cancellation_terms ? "checked" : ""}> I accept the cancellation terms</label></div>` : ""}
        <p class="muted" data-withdraw-note hidden>The committee will review any outstanding fee or refund.</p>
        <p class="form-status" role="status" aria-live="polite"></p>
        <div class="actions"><button type="submit">${r ? "Save changes" : "Save RSVP"}</button><button type="button" class="secondary" data-cancel>Cancel</button></div>
      </form>`;
      const form = dialog.querySelector("form");
      const toggle = () => {
        const playing = form.elements.attending.value === "yes";
        const choices = form.querySelector("[data-playing]");
        choices.hidden = !playing || isSocial;
        choices.querySelectorAll("input, select").forEach((input) => { input.disabled = choices.hidden; });
        if (form.elements.accept_terms) {
          form.elements.accept_terms.required = playing;
          form.elements.accept_terms.disabled = !playing;
          form.querySelector("[data-terms]").hidden = !playing;
        }
        form.querySelector("[data-withdraw-note]").hidden = !(form.elements.attending.value === "no" && (r?.attending || r?.reserve));
      };
      form.querySelectorAll("[name=attending]").forEach((input) => { input.onchange = toggle; });
      form.querySelector("[data-cancel]").onclick = () => { if (!saving) dialog.close(); };
      form.onsubmit = (submitEvent) => {
        submitEvent.preventDefault();
        if (saving) return;
        b.submit(form, async () => {
          saving = true;
          form.querySelector("[data-cancel]").disabled = true;
          try {
            const fields = new FormData(form);
            const playing = fields.get("attending") === "yes";
            const buggy = playing && !isSocial && fields.get("buggy") === "on";
            const payload = {
              event_id: ev.id,
              attending: playing,
              buggy,
              preferred_time: playing && !isSocial ? fields.get("preferred_time") || null : null,
              flexibility: buggy ? r?.flexibility || null : null,
              accept_terms: playing && fields.get("accept_terms") === "on",
            };
            const { data, error } = await b.client.rpc("submit_rsvp", { payload });
            if (error) throw error;
            if (!data) throw new Error("The RSVP confirmation could not be read. Close and reopen to check your saved response.");
            const message = `RSVP saved. ${rsvpStatus(ev, data).label}.`;
            try { await onSaved?.(data); }
            catch { b.toast("Your RSVP is saved. Refresh the page to see your booking."); dialog.close(); return; }
            b.toast(message);
            dialog.close();
          } finally {
            saving = false;
            const cancel = form.querySelector("[data-cancel]");
            if (cancel) cancel.disabled = false;
          }
        });
      };
      toggle();
      form.querySelector("input:checked:not(:disabled), input:not(:disabled)")?.focus({ preventScroll: true });
    }
    dialog.showModal();
    await loadResponse();
    return dialog;
  } catch {
    dialog?.close();
    b.toast("Your RSVP could not open. Please try again.");
  } finally { opening = false; }
}
