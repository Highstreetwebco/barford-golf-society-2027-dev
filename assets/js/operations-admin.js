import { mountFinance } from "./finance-admin.js?v=2027-results-1";
import { guestAction } from "./guest-invites.js?v=2027-results-1";
import {
  operation,
  field,
  textfield,
  bindForms,
  stamp,
  reservationNotices,
} from "./operations.js?v=2027-results-1";
import { handicapAt } from "./league-rules.js?v=2027-results-1";
const b = await window.barfordReady,
  e = b.escape;
let token = 0;
export const operationTabs = {
  adjustments: "Manual handicap adjustments",
  payments: "Payments",
  guests: "Guests & playing partners",
  checklist: "Event checklist",
  committee: "Expenses & prizes",
};
export async function showOperations(tab, event) {
  const ticket = ++token;
  if (!operationTabs[tab]) return;
  const area = document.getElementById("adminOp-" + tab);
  area.innerHTML = "<p>Loading organiser tools…</p>";
  try {
    const data = await operation("admin", { event_id: event?.id || null });
    if (ticket !== token) return;
    if (tab === "adjustments") {
      await adjustments(area, data);
      return;
    }
    if (tab === "payments") payments(area, data, event);
    if (tab === "guests") guests(area, data, event);
    if (tab === "checklist") {
      const countResult = await b.client.rpc("event_counts");
      data.counts = countResult.data?.find((x) => x.event_id === event?.id) || {
        playing: 0,
        waiting: 0,
      };
      checklist(area, data, event);
      if (event)
        await reservationNotices(
          area.querySelector("[data-reservation-notices]"),
          event.id,
        );
    }
    if (tab === "committee") {
      area.innerHTML =
        '<div id="expenseWorkspace"></div><details class="panel section"><summary>Prize stock</summary><div id="prizeWorkspace"></div></details>';
      committee(area.querySelector("#prizeWorkspace"), {
        ...data,
        items: data.items.filter((x) => x.kind === "prize"),
      });
      await mountFinance(area.querySelector("#expenseWorkspace"));
    }
  } catch (err) {
    area.innerHTML = `<p class="notice">${e(err.message)}</p>`;
  }
}
function select(name, label, options, value) {
  return `<label>${label}<select name="${name}">${options.map(([v, l]) => `<option value="${e(v)}" ${String(value) === String(v) ? "selected" : ""}>${e(l)}</option>`).join("")}</select></label>`;
}
async function adjustments(area, ops) {
  const { data, error } = await b.client.rpc("league_admin");
  if (error) throw error;
  const last = Math.max(
    0,
    ...data.rounds
      .filter((r) => r.published_entries)
      .map((r) => r.round_number),
  );
  const rounds = Array.from({ length: 7 }, (_, i) => i + 1).filter(
    (n) => n > last && n >= 2,
  );
  area.innerHTML = `<h2>Manual handicap adjustments</h2><p>Record a committee decision for an individual player from a future round. Earlier results and their starting handicap stay intact. Automatic adjustments continue from the new value.</p>${
    rounds.length
      ? `<form class="form-grid">${select(
          "who",
          "Player",
          data.players.map((p) => [p.id, p.name]),
          data.players[0]?.id,
        )}${select(
          "from_round",
          "Apply from round",
          rounds.map((n) => [n, "Round " + n]),
          rounds[0],
        )}<p class="notice full" data-preview></p>${field("New handicap", "new_handicap", "", "number", 'required min="0" max="100" step="0.1"')}${textfield("Committee decision / reason", "reason")}<div class="actions full"><button name="action" value="save">Save adjustment</button><button class="secondary" name="action" value="remove">Remove this round’s override</button></div><p class="full" role="status"></p></form>`
      : "<p>All seven rounds are published. There is no future round to adjust.</p>"
  }<details class="section"><summary>Recorded committee decisions</summary><div class="stack section">${ops.handicap_history.length ? ops.handicap_history.map((h) => `<article class="panel"><strong>${e(data.players.find((p) => p.id === h.details.user_id)?.name || "Former member")} · Round ${h.details.from_round}</strong><p>${h.details.before} → ${h.details.after}${h.details.removed ? " · Override removed" : ""}</p><p>${e(h.details.reason)}</p><small>${e(h.actor_name || "Organiser")} · ${e(stamp(h.created_at))}</small></article>`).join("") : "<p>No manual decisions recorded yet.</p>"}</div></details>`;
  const form = area.querySelector("form");
  if (!form) return;
  form.elements.reason.required = true;
  form.elements.reason.minLength = 5;
  const preview = () => {
    const p = data.players.find((p) => p.id === form.elements.who.value),
      n = Number(form.elements.from_round.value),
      h = p ? handicapAt(p, n, data.rounds) : null;
    const missing = Array.from({ length: n - 1 }, (_, i) => i + 1).filter(
      (r) =>
        !data.rounds.some((x) => x.round_number === r && x.published_entries),
    );
    form.querySelector("[data-preview]").textContent =
      `Current round ${n} handicap: ${h ?? "Starting handicap not set"}.${missing.length ? " Provisional: earlier rounds are still unpublished. Your manual value will remain fixed when those results are entered." : ""}`;
    const override = p?.adjustments?.find((x) => x.round_number === n);
    form.elements.new_handicap.value = override?.handicap ?? "";
    form.elements.reason.value = override?.reason || "";
    form.querySelector("[value=remove]").disabled = !override;
  };
  form.elements.who.onchange = preview;
  form.elements.from_round.onchange = preview;
  preview();
  form.querySelector("[value=remove]").formNoValidate = true;
  bindForms(area, async (form, f, button) => {
    const remove = button?.value === "remove";
    if (!f.reason || f.reason.trim().length < 5)
      throw new Error("Record a reason of at least five characters.");
    const p = data.players.find((p) => p.id === f.who);
    if (
      !confirm(
        `${remove ? "Remove the override" : "Set handicap to " + f.new_handicap} for ${p.name} from round ${f.from_round}? Earlier rounds will not change.`,
      )
    )
      return;
    const r = await b.client.rpc("manual_handicap", {
      who: f.who,
      from_round: Number(f.from_round),
      new_handicap: remove ? null : Number(f.new_handicap),
      reason: f.reason,
      expected_revision: data.revision,
      remove,
    });
    if (r.error) throw r.error;
    await showOperations("adjustments", null);
    b.toast("Future-round handicap updated.");
  });
}
function payments(area, data, event) {
  const shown = data.charges.filter(
    (c) => !event || c.event_id === event.id || c.scope === "membership:2027",
  );
  const total = shown.reduce(
    (s, c) => s + Math.max(0, c.amount - c.received),
    0,
  );
  area.innerHTML = `<h2>Payments</h2><p>${event ? e(event.name) + " and annual membership" : "All events and annual membership"} · <strong>${b.money(total)} outstanding</strong></p><p>Confirm transfers against the bank statement. Record the total received; a player’s “transfer sent” flag is not proof of payment. Negative balances are shown as credits, not automatic refunds.</p>${event ? '<button class="secondary" id="generateCharges">Create missing event charges</button>' : ""}<label class="section">Find a payment<input type="search" id="paymentSearch" placeholder="Player or event name"></label><div class="stack section">${
    shown.length
      ? shown
          .map(
            (c) =>
              `<form class="panel form-grid" data-charge="${c.id}" data-revision="${c.revision}" data-search="${e((c.name + " " + c.label).toLowerCase())}"><div class="full"><h3>${e(c.name)} · ${e(c.label)}</h3><p>Reference BGS-${e(c.user_id.slice(0, 8).toUpperCase())} · ${c.reported ? "Transfer reported — check statement" : "No pending transfer report"}${c.cancellation_review ? " · WITHDRAWAL NEEDS REVIEW" : ""}</p></div>${select(
                "category",
                "Price category",
                [
                  ["member", "Society member"],
                  ["guest", "Guest"],
                  ["course_member", "Course member"],
                  ["custom", "Individual price"],
                ],
                c.category,
              )}${field("Amount charged (£)", "amount", c.amount, "number", 'required min="0" step="0.01"')}${field("Total received (£)", "received", c.received, "number", 'required min="0" step="0.01"')}${field("Payment due", "due_date", c.due_date, "date")}${textfield("Private organiser notes / reason for price change", "note", c.note)}<label class="check"><input name="cancellation_review" type="checkbox" ${c.cancellation_review ? "checked" : ""}> Withdrawal still needs review</label><label class="check"><input name="clear_report" type="checkbox" checked> Clear transfer report after checking</label><button>Save payment record</button><p class="full" role="status"></p></form>`,
          )
          .join("")
      : "<p>No charges yet. Set prices in Event details and the annual fee below.</p>"
  }</div><details class="section"><summary>Annual fee, bank details & guest policy</summary><form data-settings class="form-grid section">${field("2027 annual membership (£)", "membership_fee", data.settings.membership_fee, "number", 'min="0" step="0.01"')}${field("Membership due", "membership_due", data.settings.membership_due, "date")}${textfield("Bank-transfer instructions (members only)", "bank_instructions", data.settings.bank_instructions)}${textfield("Agreed guest handicap policy", "guest_policy", data.settings.guest_policy)}<label class="check full"><input type="checkbox" name="create_membership_charges"> Create missing annual charges for society members</label><p class="muted full">Existing charges keep their agreed price. Update individual records above if needed. Guests do not get automatic annual charges.</p><button>Save settings</button><p class="full" role="status"></p></form></details><details class="section"><summary>Member / guest account categories</summary><p>Category changes apply to new charges. Existing payment records are kept for review.</p>${data.accounts
    .map(
      (p) =>
        `<form data-member-type="${p.id}" class="response-row"><strong>${e(p.name)}</strong>${select(
          "category",
          "Category",
          [
            ["member", "Society member"],
            ["guest", "Guest"],
          ],
          p.category,
        )}<button>Save category</button><p role="status"></p></form>`,
    )
    .join("")}</details><p data-status role="status"></p>`;
  area.querySelector("#paymentSearch").oninput = (ev) =>
    area
      .querySelectorAll("[data-search]")
      .forEach(
        (f) =>
          (f.hidden = !f.dataset.search.includes(
            ev.target.value.toLowerCase(),
          )),
      );
  area
    .querySelector("#generateCharges")
    ?.addEventListener("click", async (ev) => {
      ev.currentTarget.disabled = true;
      try {
        await operation("generate_charges", { event_id: event.id });
        await showOperations("payments", event);
      } catch (err) {
        area.querySelector("[data-status]").textContent = err.message;
      }
    });
  area.querySelectorAll("[data-charge]").forEach(
    (form) =>
      (form.elements.category.onchange = () => {
        const c = shown.find((c) => c.id === Number(form.dataset.charge));
        if (c.event_id === event?.id) {
          const price = {
            member: event.member_price,
            guest: event.guest_price,
            course_member: event.course_member_price,
          }[form.elements.category.value];
          if (price != null) form.elements.amount.value = price;
        }
      }),
  );
  bindForms(area, async (form, f) => {
    if (form.hasAttribute("data-settings"))
      await operation("settings", {
        ...f,
        membership_fee: f.membership_fee || null,
        membership_due: f.membership_due || null,
        create_membership_charges: !!f.create_membership_charges,
      });
    else if (form.hasAttribute("data-member-type"))
      await operation("member_type", {
        user_id: form.dataset.memberType,
        category: f.category,
      });
    else
      await operation("save_charge", {
        ...f,
        id: Number(form.dataset.charge),
        revision: Number(form.dataset.revision),
        due_date: f.due_date || null,
        cancellation_review: !!f.cancellation_review,
        clear_report: !!f.clear_report,
      });
    await showOperations("payments", event);
    b.toast("Payment settings saved.");
  });
}
function guests(area, data, event) {
  const requests = data.guests.filter((g) => !event || g.event_id === event.id);
  const name = (id) => data.accounts.find((p) => p.id === id)?.name || "Member";
  area.innerHTML = `<h2>Guests & playing partners</h2><p>Guests join from their host’s shared invitation. Their RSVP is saved immediately; review any new handicap before play. Older invitation requests can still be approved below.</p><div class="stack">${requests.length ? requests.map((g) => `<form data-guest="${g.id}" class="panel form-grid"><div class="full"><h3>${e(g.name)} · ${e(g.status)}</h3><p>Invited by ${e(g.host_name)} · ${e(g.phone)} · Suggested HCP ${g.requested_handicap ?? "Not given"}</p></div>${g.status === "pending" ? `${field("Approved starting handicap (golf only)", "handicap", g.requested_handicap, "number", 'min="0" max="36" step="0.1"')}<div class="actions"><button name="decision" value="approve">${g.link_token ? "Approve handicap" : "Approve invitation"}</button>${g.link_token ? "" : '<button class="secondary" name="decision" value="reject">Decline request</button>'}</div><p role="status"></p>` : g.link_token ? "<p>Guest account created and RSVP saved. Manage attendance under RSVPs.</p>" : "<p>Request reviewed. The guest still needs to complete their own booking.</p>"}</form>`).join("") : "<p>No guest requests.</p>"}</div>${
    event?.event_type === "pairs"
      ? `<section class="section"><h3>Playing pairs</h3><div class="stack">${data.pairs.map((p) => `<form data-existing-pair="${p.id}" data-player="${p.first_user}" class="response-row"><p>${e(name(p.first_user))}${p.second_user ? " & " + e(name(p.second_user)) : ""} · ${e(p.status)}</p>${p.status === "requested" ? '<button name="mode" value="accept">Confirm pair</button>' : ""}<button class="secondary" name="mode" value="clear">Clear pair</button><p role="status"></p></form>`).join("")}</div><form data-admin-pair class="form-grid section">${select(
          "user_id",
          "First player",
          data.accounts.map((p) => [p.id, p.name]),
          "",
        )}${select(
          "partner_id",
          "Second player",
          data.accounts.map((p) => [p.id, p.name]),
          "",
        )}<p class="full">Both players must be confirmed RSVPs. Clear any existing partner requests first.</p><button>Confirm playing pair</button><p role="status"></p></form></section>`
      : ""
  }`;
  bindForms(area, async (form, f, button) => {
    if (
      form.dataset.guest &&
      requests.find((g) => g.id === form.dataset.guest)?.link_token
    )
      await guestAction("review", {
        id: form.dataset.guest,
        handicap: f.handicap || null,
      });
    else if (form.dataset.guest)
      await operation("approve_guest", {
        id: form.dataset.guest,
        approve: button?.value === "approve",
        handicap: f.handicap || null,
      });
    else
      await operation("pair", {
        event_id: event.id,
        ...f,
        user_id: form.dataset.player || f.user_id,
        id: form.dataset.existingPair || null,
        mode: button?.value || "request",
        confirmed: true,
      });
    await showOperations("guests", event);
  });
}
function checklist(area, data, event) {
  if (!event) {
    area.innerHTML = "<h2>Event checklist</h2><p>Choose an event above.</p>";
    return;
  }
  const tasks = [
    "Course confirmed",
    "Numbers submitted",
    "Payments checked",
    "Handicaps ready",
    "Tee groups published",
    "Scorecards prepared",
    "Prizes assigned",
  ];
  area.innerHTML = `<h2>${e(event.name)} · Event checklist</h2><div data-reservation-notices></div><p class="notice">${data.counts?.playing || 0} confirmed · ${data.counts?.waiting || 0} waiting</p><p>Places committed to the ${event.event_type === "social" ? "venue" : "course"}: <strong>${event.committed_places || 0}</strong>. This is separate from the live RSVP count; update it in Event details when you agree numbers.</p><div class="stack">${tasks
    .filter(
      (t) =>
        event.event_type !== "social" ||
        ![
          "Handicaps ready",
          "Tee groups published",
          "Scorecards prepared",
        ].includes(t),
    )
    .map((task) => {
      const t = data.tasks.find((x) => x.task === task) || {};
      return `<form class="response-row" data-task="${task}"><strong>${task}</strong>${field("Responsible person", "owner", t.owner)}<label class="check"><input name="done" type="checkbox" ${t.done ? "checked" : ""}> Complete</label><button>Save</button><p role="status"></p></form>`;
    })
    .join(
      "",
    )}</div>${event.event_type !== "social" ? `<details class="section"><summary>Buggy reservations</summary>${data.buggies.map((p) => `<p><strong>${e(p.first_name)} & ${e(p.second_name)}</strong><br>${p.confirmed_at ? "Booking confirmed " + e(stamp(p.confirmed_at)) : p.booking_name ? e(p.booking_name) + " is arranging it" : "Nobody has taken booking responsibility"}</p>`).join("") || "<p>No published buggy pairs.</p>"}</details>` : ""}<details class="section"><summary>Quick organiser guide</summary><ol><li>Set prices, deadlines, arrival details and committed places in Event details.</li><li>Check RSVPs, guest approvals and missing handicaps.</li><li>Review and publish tee groups. Copy the latest update for the society chat.</li><li>Use Setup next round score cards to prepare the cards.</li><li>After play, use Input scores, review adjustments, then Complete round.</li><li>Use Manual handicap adjustments for a committee decision affecting a future round.</li></ol></details>`;
  bindForms(area, async (form, f) => {
    await operation("task", {
      event_id: event.id,
      task: form.dataset.task,
      owner: f.owner,
      done: !!f.done,
    });
    form.querySelector("[role=status]").textContent = "Saved.";
  });
}
function committee(area, data) {
  const edit = (x = {}) =>
    `${select(
      "kind",
      "Type",
      [["prize", "Prize stock"]],
      x.kind || "prize",
    )}${field("Description", "description", x.description, "text", 'required maxlength="300"')}${field("Owner / held by", "owner", x.owner, "text", 'maxlength="150"')}${field("Cost (£)", "amount", x.amount ?? 0, "number", 'required min="0" step="0.01"')}${field("Quantity", "quantity", x.quantity ?? 1, "number", 'required min="0" step="1"')}${textfield("Notes", "note", x.note)}${x.id ? `<label class="check"><input type="checkbox" name="done" ${x.done ? "checked" : ""}> ${x.kind === "expense" ? "Reimbursed" : "No longer held / allocated"}</label>` : ""}<button>${x.id ? "Save item" : "Add item"}</button><p class="full" role="status"></p>`;
  area.innerHTML = `<h2>Prize stock</h2><p>Private committee records. Record what was bought, who holds it, and whether reimbursement is complete.</p><details><summary>Add a prize</summary><form class="form-grid section">${edit()}</form></details><div class="stack section">${data.items.length ? data.items.map((x) => `<details class="panel"><summary>${e(x.description)} · ${x.kind === "expense" ? b.money(x.amount) : x.quantity + " in stock"} · ${e(x.owner)}${x.done ? " · Complete" : ""}</summary><form data-item="${x.id}" data-revision="${x.revision}" class="form-grid section">${edit(x)}</form></details>`).join("") : "<p>No expenses or stock recorded yet.</p>"}</div>`;
  area
    .querySelectorAll("[data-item] select[name=kind]")
    .forEach((s) => (s.disabled = true));
  bindForms(area, async (form, f) => {
    await operation("item", {
      ...f,
      id: form.dataset.item || null,
      revision: form.dataset.revision ? Number(form.dataset.revision) : null,
      done: !!f.done,
    });
    await showOperations("committee", null);
  });
}
