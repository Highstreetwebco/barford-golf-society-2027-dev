// One member RSVP flow, shared by the homepage and older event links.
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
export const rsvpClosed = (event) => event.cancelled || event.date < today();
export const rsvpChangeLocked = (event, response, admin = false) => {
  if (!response || admin) return false;
  const cutoff = new Date(`${event.date}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 6);
  return today() >= cutoff.toISOString().slice(0, 10);
};
let opening = false;

function radio(e, name, legend, options, selected) {
  return `<fieldset><legend>${legend}</legend><div class="choices">${options.map(([value, label]) => `<label><input type="radio" name="${name}" value="${e(value)}" ${selected === value ? "checked" : ""} required><span>${label}</span></label>`).join("")}</div></fieldset>`;
}

export async function openRsvp(ev, b, { onSaved } = {}) {
  if (opening || document.querySelector("dialog.rsvp-dialog[open]")) return;
  opening = true;
  ev = { ...ev };
  const trigger = document.activeElement;
  let dialog;
  try {
    if (!b.state.user && !(await b.requireMember())) return;
    if (rsvpClosed(ev)) {
      b.toast(ev.cancelled ? "This event has been cancelled." : "Bookings for this event are closed.");
      return;
    }
    const e = b.escape;
    dialog = document.createElement("dialog");
    dialog.id = `form-${ev.id}`;
    dialog.className = "rsvp-dialog";
    dialog.setAttribute("aria-labelledby", `rsvp-title-${ev.id}`);
    document.body.append(dialog);
    let saving = false;
    dialog.addEventListener("cancel", (event) => { if (saving) event.preventDefault(); });
    dialog.addEventListener("close", () => {
      dialog.remove();
      if (trigger?.isConnected && !trigger.disabled) trigger.focus({ preventScroll: true });
      else document.querySelector("[data-home-rsvp], [data-rsvp]")?.focus({ preventScroll: true });
    }, { once: true });
    async function loadResponse() {
      dialog.innerHTML = `<h2 id="rsvp-title-${ev.id}">Your RSVP</h2><p>${e(ev.name)}</p><p role="status">Loading your response…</p><button type="button" class="secondary" data-cancel>Cancel</button>`;
      dialog.querySelector("[data-cancel]").onclick = () => dialog.close();
      const [own, current, guests] = await Promise.all([
        b.client.from("rsvps").select("*").eq("event_id", ev.id).eq("user_id", b.state.user.id).maybeSingle(),
        b.client.from("events").select("*").eq("id", ev.id).maybeSingle(),
        b.client.rpc("guest_invitations", { action: "mine", payload: { event_id: ev.id } }),
      ]);
      const { data: r } = own;
      const error = own.error || current.error || guests.error || (!guests.data?.category ? new Error("Account type unavailable") : null);
      if (!dialog.isConnected) return;
      if (error) {
        dialog.querySelector("[role=status]").textContent = "Your response could not load. Please try again.";
        const retry = document.createElement("button");
        retry.type = "button";
        retry.textContent = "Try again";
        retry.onclick = loadResponse;
        dialog.append(retry);
        return;
      }
      if (!current.data || Number(current.data.id) !== Number(ev.id)) {
        dialog.querySelector("[role=status]").textContent = "This event is no longer available.";
        return;
      }
      Object.assign(ev, current.data);
      if (rsvpClosed(ev)) {
        dialog.querySelector("[role=status]").textContent = ev.cancelled ? "This event has been cancelled." : "Bookings for this event are closed.";
        return;
      }
      if (rsvpChangeLocked(ev, r, b.state.admin)) {
        dialog.querySelector("[role=status]").textContent = "Online RSVP changes close six days before the event. Contact the committee to change your RSVP.";
        return;
      }
      if (guests.data.category === "guest" && !(guests.data.bookings || []).some((booking) => Number(booking.event_id) === Number(ev.id))) {
        dialog.querySelector("[role=status]").textContent = "A member needs to invite you to this event. Open their invitation link to book your guest place.";
        return;
      }
      const late = ev.rsvp_deadline && ev.rsvp_deadline < today() && !(r?.attending || r?.reserve) && !b.state.admin;
      dialog.innerHTML = `<form class="rsvp-form"><h2 id="rsvp-title-${ev.id}">${r ? "Update your RSVP" : "Your RSVP"}</h2><p class="rsvp-event-name">${e(ev.name)} · ${e(b.date(ev.date))}</p><p class="identity">For ${e(b.state.profile?.full_name || "your account")}</p>${late ? '<p class="notice">The RSVP deadline has passed. Contact an organiser if you would like a place.</p>' : ""}${r?.reserve ? '<p class="notice">You’re on the waiting list. Your preferences are saved while you wait for a place.</p>' : ""}${radio(e, "attending", ev.event_type === "social" ? "Attending?" : "Playing?", [["yes", ev.event_type === "social" ? "Yes, I’m attending" : "Yes, I’m playing"], ["no", "Not this time"]], r ? (r.attending || r.reserve ? "yes" : "no") : null)}<div data-playing>${radio(e, "buggy", "Buggy?", [["yes", "Yes, please"], ["no", "No, I’ll walk"]], r?.buggy ? "yes" : "no")}${radio(e, "preferred_time", "Preferred tee time (optional)", [["", "No preference"], ["First", "First"], ["Middle", "Middle"], ["End", "End"]], r?.preferred_time || "")}<label class="check"><input type="checkbox" name="flexibility" ${r?.flexibility === "walk" ? "checked" : ""}> Happy to walk if there is an odd number of buggy players</label><small>We’ll do our best to match your preference. A buggy request is subject to availability.</small></div>${ev.cancellation_terms ? `<div data-terms><p class="notice preserve-lines">${e(ev.cancellation_terms)}</p><label class="check"><input type="checkbox" name="accept_terms" ${r?.terms_snapshot === ev.cancellation_terms ? "checked" : ""}> I accept the cancellation terms</label></div>` : ""}<p class="muted" data-withdraw-note hidden>Withdrawing does not automatically cancel a fee or issue a refund. An organiser will review your booking.</p><div class="actions"><button type="submit">${r ? "Save changes" : "Save RSVP"}</button><button type="button" class="secondary" data-cancel>Cancel</button></div><p class="form-status" role="status" aria-live="polite"></p></form>`;
      const form = dialog.querySelector("form");
      if (late) form.querySelector('[name="attending"][value="yes"]').disabled = true;
      const toggle = () => {
        const no = form.elements.attending.value === "no";
        const choices = form.querySelector("[data-playing]");
        choices.hidden = no || ev.event_type === "social";
        choices.querySelectorAll("input").forEach((input) => { input.disabled = choices.hidden; });
        const terms = form.elements.accept_terms;
        if (terms) {
          terms.required = form.elements.attending.value === "yes";
          terms.disabled = no;
          form.querySelector("[data-terms]").hidden = no;
        }
        form.querySelector("[data-withdraw-note]").hidden = !(no && (r?.attending || r?.reserve));
      };
      form.querySelectorAll("[name=attending]").forEach((input) => { input.onchange = toggle; });
      form.querySelector("[data-cancel]").onclick = () => { if (!saving) dialog.close(); };
      form.onsubmit = (event) => {
        event.preventDefault();
        b.submit(form, async () => {
          saving = true;
          form.querySelector("[data-cancel]").disabled = true;
          try {
            const f = new FormData(form);
            const playing = f.get("attending") === "yes";
            const golf = playing && ev.event_type !== "social";
            const payload = { event_id: ev.id, attending: playing, buggy: golf && f.get("buggy") === "yes", preferred_time: golf ? f.get("preferred_time") || null : null, flexibility: golf && f.get("flexibility") ? "walk" : null, accept_terms: playing && f.get("accept_terms") === "on" };
            const { data, error } = await b.client.rpc("submit_rsvp", { payload });
            if (error) throw error;
            const message = data.reserve ? "Saved. You’re on the waiting list." : data.attending ? ev.event_type === "social" ? "Saved. You’re attending!" : "Saved. You’re playing!" : "Saved. You’re not playing this time.";
            try { await onSaved?.(data); }
            catch { b.toast("Your RSVP is saved. Refresh the page to see the latest booking details."); dialog.close(); return; }
            b.toast(message);
            dialog.close();
          } finally {
            saving = false;
            form.querySelector("[data-cancel]").disabled = false;
          }
        });
      };
      toggle();
      form.querySelector("input:not(:disabled)")?.focus({ preventScroll: true });
    }
    const loading = loadResponse();
    dialog.showModal();
    await loading;
    return dialog;
  } catch (error) {
    dialog?.close();
    b.toast(error.message || "Your RSVP could not open. Please try again.");
  } finally { opening = false; }
}
