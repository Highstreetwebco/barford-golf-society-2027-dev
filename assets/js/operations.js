import { mountGuestInvites } from "./guest-invites.js?v=2027-simple-events-1";
const b = await window.barfordReady,
  e = b.escape;
export async function operation(action, payload = {}) {
  const { data, error } = await b.client.rpc("operations", { action, payload });
  if (error) throw error;
  return data;
}
export async function reservationNotices(area, event) {
  const { data, error } = await b.client.rpc("reservation_notices", { event });
  if (error) {
    area.innerHTML = "<p>Reservation notices could not load.</p>";
    return;
  }
  area.innerHTML = (data || [])
    .map(
      (n) =>
        `<div class="notice"><strong>Check existing buggy booking · ${e(n.booking_name)}</strong><p>${e(n.message)}</p><button class="secondary" data-resolve-reservation="${n.id}">I’ve checked this with the course</button></div>`,
    )
    .join("");
  area.querySelectorAll("[data-resolve-reservation]").forEach(
    (btn) =>
      (btn.onclick = async () => {
        btn.disabled = true;
        const r = await b.client.rpc("reservation_notices", {
          event,
          resolve_id: Number(btn.dataset.resolveReservation),
        });
        if (r.error) {
          b.toast(r.error.message);
          btn.disabled = false;
        } else await reservationNotices(area, event);
      }),
  );
}
export const field = (label, name, value = "", type = "text", extra = "") =>
  `<label>${label}<input name="${name}" type="${type}" value="${e(value ?? "")}" ${extra}></label>`;
export const textfield = (label, name, value = "") =>
  `<label class="full">${label}<textarea name="${name}" rows="3" maxlength="2000">${e(value ?? "")}</textarea></label>`;
export const stamp = (value) =>
  value
    ? new Date(value).toLocaleString("en-GB", {
        timeZone: "Europe/London",
        dateStyle: "medium",
        timeStyle: "short",
      }) + " UK time"
    : "";
export function bindForms(area, save) {
  for (const form of area.querySelectorAll("form"))
    form.onsubmit = (event) => {
      event.preventDefault();
      b.submit(form, () =>
        save(form, Object.fromEntries(new FormData(form)), event.submitter),
      );
    };
}
export function eventBrief(ev) {
  const facts = [
    ["Arrive from", ev.arrival_time],
    ["Refreshments from", ev.refreshment_time],
    ["Included in your fee", ev.included],
    ["Parking", ev.parking],
    ["Practice facilities", ev.practice],
    ["Course layout", ev.course_layout],
    ["Format & rules", ev.format_rules],
  ];
  const dates = [
    ["RSVP by", ev.rsvp_deadline],
    ["Pay by", ev.payment_due],
    ["Cancellation deadline", ev.cancellation_deadline],
  ];
  return `<section class="panel event-brief section"><p class="eyebrow">PLAN YOUR DAY · UK TIMES</p><h2>${ev.event_type === "social" ? "Your event briefing" : "Before you tee off"}</h2>${ev.event_notice ? `<p class="notice preserve-lines">${e(ev.event_notice)}</p>` : ""}<dl class="brief-grid">${facts
    .filter((x) => x[1])
    .map(
      ([k, v]) =>
        `<div><dt>${k}</dt><dd class="preserve-lines">${e(v)}</dd></div>`,
    )
    .join("")}${dates
    .filter((x) => x[1])
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${e(b.date(v))}</dd></div>`)
    .join(
      "",
    )}</dl>${!facts.some((x) => x[1]) && !ev.event_notice ? "<p>Arrival and refreshments details will be confirmed by the organisers.</p>" : ""}${ev.cancellation_terms ? `<details><summary>Cancellation terms</summary><p class="preserve-lines">${e(ev.cancellation_terms)}</p><p>Withdrawing does not automatically cancel a fee or issue a refund. An organiser will review your booking.</p></details>` : ""}${ev.course_phone ? `<p><a href="tel:${e(ev.course_phone.replace(/[^+0-9]/g, ""))}">Call the ${ev.event_type === "social" ? "venue" : "course"}: ${e(ev.course_phone)}</a></p>` : ""}</section>`;
}
function chargeHTML(c, compact = false) {
  const due = Math.max(0, Number(c.amount) - Number(c.received)),
    credit = Math.max(0, Number(c.received) - Number(c.amount));
  return `<article class="payment-card"><div><h3>${e(c.label)}</h3><strong>${due ? `${b.money(due)} to pay` : credit ? `${b.money(credit)} credit — contact organiser` : "Paid"}</strong>${c.due_date ? `<p>Due ${e(b.date(c.due_date))}</p>` : ""}<small>Total ${b.money(c.amount)} · Received ${b.money(c.received)}</small>${c.cancellation_review ? '<p class="notice">Withdrawal awaiting payment review. Your balance has not been refunded or removed.</p>' : ""}${c.reported && due ? '<p class="notice">Transfer reported — awaiting organiser confirmation.</p>' : ""}</div>${!compact && due && !c.reported ? `<button class="secondary" data-report="${c.id}">I’ve sent the transfer</button>` : ""}</article>`;
}
export async function mountPayments(
  area,
  { eventId = null, compact = false } = {},
) {
  if (!b.state.user) {
    area.hidden = true;
    return;
  }
  try {
    const data = await operation("member", { event_id: eventId });
    const charges = data.charges.filter(
      (c) =>
        !eventId || c.event_id === eventId || c.scope === "membership:2027",
    );
    area.innerHTML = `<h2>Your payments</h2>${charges.length ? charges.map((c) => chargeHTML(c, compact)).join("") : "<p>No charges have been assigned yet. Organisers will confirm any fees due.</p>"}${compact ? '<a class="button secondary" href="account.html#payments">Payment details</a>' : `<p>Your reference: <strong>BGS-${e(b.state.user.id.slice(0, 8).toUpperCase())}</strong></p><p>Include the event name with your reference.</p><div class="notice preserve-lines">${e(data.settings.bank_instructions || "Bank-transfer instructions will appear here when confirmed by the treasurer.")}</div><p class="muted">A transfer is only shown as received after an organiser checks it.</p>`}<p role="status"></p>`;
    area.querySelectorAll("[data-report]").forEach(
      (btn) =>
        (btn.onclick = async () => {
          btn.disabled = true;
          try {
            await operation("report_payment", {
              id: Number(btn.dataset.report),
            });
            await mountPayments(area, { eventId, compact });
          } catch (err) {
            area.querySelector("[role=status]").textContent = err.message;
            btn.disabled = false;
          }
        }),
    );
  } catch (err) {
    area.innerHTML = `<p class="notice">Payment details could not load: ${e(err.message)}</p>`;
  }
}
export async function mountEventOperations(area, ev, { compact = false, showBookingLink = true, showBookingStatus = true, showInvites = true, showBrief = true } = {}) {
  const options = { compact, showBookingLink, showBookingStatus, showInvites, showBrief };
  if (!b.state.user) {
    area.hidden = true;
    return;
  }
  area.hidden = false;
  try {
    const data = await operation("member", { event_id: ev.id });
    const { data: r, error } = await b.client
      .from("rsvps")
      .select("*")
      .eq("event_id", ev.id)
      .eq("user_id", b.state.user.id)
      .maybeSingle();
    if (error) throw error;
    const pair = data.pairs.find((p) =>
      [p.first_user, p.second_user].includes(b.state.user.id),
    );
    const name = (id) =>
      data.players.find((p) => p.id === id)?.name || "Member";
    const changes = data.changes.length
      ? `<div class="notice"><h3>Your tee group has changed</h3>${data.changes
          .slice(0, 1)
          .map(
            (c) =>
              `<p>${c.old_time === c.new_time ? `Your playing group changed; your tee time remains ${e(c.new_time)}.` : `Your tee time moved from ${e(c.old_time)} to ${e(c.new_time)}.`} Updated ${e(stamp(c.created_at))}.</p>`,
          )
          .join(
            "",
          )}<button class="secondary" data-seen>I’ve seen this update</button></div>`
      : "";
    area.innerHTML = `<div data-reservation-notices></div>${changes}${showBookingStatus ? `<div class="booking-status"><p class="eyebrow">YOUR BOOKING</p><h2>${ev.cancelled ? "Event cancelled" : r?.reserve ? "You’re on the waiting list" : r?.attending ? "You’re booked" : "You’re not booked"}</h2>${r?.attending || r?.reserve ? `<p>${ev.event_type === "social" ? "Attendance saved" : `${r.buggy ? "Buggy requested" : "Walking"} · Tee preference: ${e(r.preferred_time || "None")}`}</p>` : ""}${compact && showBookingLink ? `<a class="button secondary" href="index.html?event=${ev.id}#rsvp">${r?.attending || r?.reserve ? "Change booking or withdraw" : "View event & RSVP"}</a>` : ""}</div>` : ""}${compact ? '<section class="section" data-guest-invites></section>' + (showBrief ? '<details class="compact-brief"><summary>Fees & event briefing</summary>' + eventBrief(ev) + "</details>" : "") : ""}<div data-event-payment class="section"></div>${!compact && ev.event_type !== "social" && r?.attending ? '<button class="secondary" data-course-member>I’m a member of this golf club — request my price</button>' : ""}
 ${
   !compact && ev.event_type === "pairs"
     ? `<section class="section"><h2>Your playing partner</h2><p>Playing partners are separate from buggy partners. Both players need their own confirmed booking.</p>${
         pair
           ? `<p>${pair.status === "looking" ? "You’re looking for a partner." : `${e(name(pair.first_user))} & ${e(name(pair.second_user))} — ${pair.status === "confirmed" ? "confirmed" : "awaiting acceptance"}`}</p><div class="actions">${pair.status === "requested" && pair.second_user === b.state.user.id ? `<button data-pair-action="accept" data-id="${pair.id}">Accept partner</button>` : ""}<button class="secondary" data-pair-action="clear" data-id="${pair.id}">Clear partner request</button></div>`
           : `<form data-partner class="form-stack"><label>Choose a confirmed player<select name="partner_id"><option value="">Find me a partner</option>${data.players
               .filter(
                 (p) =>
                   p.id !== b.state.user.id &&
                   !data.pairs.some(
                     (q) =>
                       q.status !== "looking" &&
                       [q.first_user, q.second_user].includes(p.id),
                   ),
               )
               .map((p) => `<option value="${p.id}">${e(p.name)}</option>`)
               .join(
                 "",
               )}</select></label><button>Save partner request</button><p role="status"></p></form>`
       }</section>`
     : ""
 }
 ${!compact ? '<section class="section" data-guest-invites></section>' : ""}${!compact ? `<details class="section"><summary>Guest handicap policy</summary><p class="preserve-lines">${e(data.settings.guest_policy)}</p></details>` : ""}<p data-operation-status role="status"></p>`;
    const act = async (action, payload, btn) => {
      if (btn) btn.disabled = true;
      try {
        await operation(action, { event_id: ev.id, ...payload });
        await mountEventOperations(area, ev, options);
      } catch (err) {
        area.querySelector("[data-operation-status]").textContent = err.message;
        if (btn) btn.disabled = false;
      }
    };
    area
      .querySelector("[data-seen]")
      ?.addEventListener("click", (ev) =>
        act("seen_changes", {}, ev.currentTarget),
      );
    area
      .querySelector("[data-course-member]")
      ?.addEventListener("click", async (event) => {
        const btn = event.currentTarget;
        btn.disabled = true;
        try {
          await operation("course_member", { event_id: ev.id });
          btn.textContent = "Price review requested";
        } catch (err) {
          area.querySelector("[data-operation-status]").textContent =
            err.message;
          btn.disabled = false;
        }
      });
    area
      .querySelectorAll("[data-pair-action]")
      .forEach(
        (btn) =>
          (btn.onclick = () =>
            act(
              "pair",
              { mode: btn.dataset.pairAction, id: Number(btn.dataset.id) },
              btn,
            )),
      );
    bindForms(area, async (form, f) => {
      await operation(
        form.hasAttribute("data-guest") ? "invite_guest" : "pair",
        {
          event_id: ev.id,
          ...f,
          handicap: f.handicap || null,
          partner_id: f.partner_id || null,
        },
      );
      await mountEventOperations(area, ev, options);
    });
    await mountGuestInvites(
      area.querySelector("[data-guest-invites]"),
      ev,
      data.category,
      { showCreate: showInvites, showManagement: showInvites },
    );
    await reservationNotices(
      area.querySelector("[data-reservation-notices]"),
      ev.id,
    );
    await mountPayments(area.querySelector("[data-event-payment]"), {
      eventId: ev.id,
      compact,
    });
  } catch (err) {
    area.innerHTML = `<p class="notice">Booking details could not load: ${e(err.message)}</p>`;
  }
}
