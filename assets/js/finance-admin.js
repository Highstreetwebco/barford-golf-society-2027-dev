const b = await window.barfordReady,
  e = b.escape;
const bucket = b.raw.storage.from("baseline-expense-receipts");
export async function finance(action, payload = {}) {
  const { data, error } = await b.client.rpc("finance", { action, payload });
  if (error) throw error;
  return data;
}
export function expenseBadge(count) {
  const tab = document.querySelector('[data-tab="committee"]');
  if (!tab) return;
  tab.innerHTML = `Expenses & prizes${count ? ` <span class="notification-count" aria-label="${count} unpaid expenses">${count}</span>` : ""}`;
}
function csv(name, rows) {
  const cell = (v) => {
    let s = String(
      typeof v === "number" ? Math.round(v * 100) / 100 : (v ?? ""),
    );
    if (typeof v === "string" && /^[\s]*[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  const url = URL.createObjectURL(
    new Blob(["\ufeff" + rows.map((r) => r.map(cell).join(",")).join("\r\n")], {
      type: "text/csv;charset=utf-8",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function mountFinance(area) {
  const data = await finance("list"),
    items = data.items || [],
    charges = data.charges || [],
    pending = items.filter((x) => !x.done);
  expenseBadge(pending.length);
  const sum = (xs, key) =>
    Math.round(xs.reduce((n, x) => n + Number(x[key] || 0), 0) * 100) / 100;
  const due = sum(pending, "amount"),
    paid = sum(
      items.filter((x) => x.done),
      "amount",
    ),
    received = sum(charges, "received");
  area.innerHTML = `<h2>Expenses & reimbursements</h2><p>Add the claimant, what was bought, the amount and a receipt photo. Mark paid only after the claimant has received the money.</p><div class="finance-totals"><div><small>Awaiting payment</small><strong>${b.money(due)}</strong><span>${pending.length} claims</span></div><div><small>Expenses paid</small><strong>${b.money(paid)}</strong></div><div><small>Payments received</small><strong>${b.money(received)}</strong></div></div><details class="section"><summary>Add an expense</summary><form id="expenseForm" class="form-grid section"><label>Your name / claimant<input name="owner" value="${e(b.state.profile?.full_name || "")}" required maxlength="150" autocomplete="name"></label><label>Amount due (£)<input name="amount" required type="number" min="0.01" max="999999.99" step="0.01" inputmode="decimal"></label><label class="full">What is it for?<input name="description" required maxlength="300"></label><label class="full">Receipt photo<input name="receipt" type="file" accept="image/jpeg,image/png,image/webp" required><small>JPG, PNG or WebP, up to 8 MB. Make sure the whole receipt is readable. Private to admins.</small></label><img id="receiptPreview" class="receipt-preview" alt="Receipt preview" hidden><label class="full">Notes (optional)<textarea name="note" maxlength="1000"></textarea></label><button>Add expense</button><p class="form-status full" role="status"></p></form></details><div class="actions section"><button class="secondary" data-export="expenses">Export expenses CSV</button><button class="secondary" data-export="income">Export income CSV</button><button class="secondary" data-export="summary">Export finance summary</button><button class="secondary" data-refresh-finance>Refresh expenses</button></div><p class="muted">Exports are a snapshot of recorded payments and expenses, not a bank balance.</p><div class="expense-list stack">${items.length ? items.map((x) => `<article class="expense-card panel"><div class="section-heading"><div><p class="eyebrow">${x.done ? "PAID" : "AWAITING PAYMENT"}</p><h3>${e(x.description)}</h3><p>${e(x.owner)}</p></div><strong>${b.money(x.amount)}</strong></div><p>${x.created_at ? "Submitted " + e(new Date(x.created_at).toLocaleDateString("en-GB")) : ""}${x.done ? " · Paid " + e(x.paid_at ? new Date(x.paid_at).toLocaleDateString("en-GB") : "date not recorded") + " by " + e(x.paid_by_name || "admin") : ""}</p>${x.note ? `<p>${e(x.note)}</p>` : ""}<div class="actions">${x.receipt_path ? `<button class="secondary" data-receipt="${e(x.receipt_path)}">View receipt</button>` : '<span class="muted">No receipt attached (legacy record)</span>'}${!x.done ? `<button data-paid="${x.id}" data-revision="${x.revision}">Mark paid</button>` : ""}</div><p role="status"></p></article>`).join("") : "<p>No expenses recorded yet.</p>"}</div>`;
  const form = area.querySelector("#expenseForm");
  let previewUrl;
  form.elements.receipt.onchange = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const file = form.elements.receipt.files[0],
      img = area.querySelector("#receiptPreview");
    img.hidden = !file;
    if (file) {
      previewUrl = URL.createObjectURL(file);
      img.src = previewUrl;
    }
  };
  let uploaded = null;
  form.onsubmit = (event) => {
    event.preventDefault();
    b.submit(form, async () => {
      const f = new FormData(form),
        file = form.elements.receipt.files[0];
      if (
        !file ||
        !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
        file.size > 8388608
      )
        throw new Error("Choose a JPG, PNG or WebP receipt photo up to 8 MB.");
      if (!uploaded || uploaded.file !== file) {
        const path = `${b.state.user.id}/${crypto.randomUUID()}.${{ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[file.type]}`;
        const { error } = await bucket.upload(path, file, {
          contentType: file.type,
          upsert: false,
        });
        if (error) throw error;
        uploaded = { file, path };
      }
      await finance("add", {
        owner: String(f.get("owner")).trim(),
        description: String(f.get("description")).trim(),
        amount: Number(f.get("amount")),
        note: f.get("note"),
        receipt_path: uploaded.path,
      });
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      b.toast("Expense added. Awaiting payment.");
      await mountFinance(area);
    });
  };
  area.querySelector("[data-refresh-finance]").onclick = () =>
    mountFinance(area).catch((err) => b.toast(err.message));
  area.querySelectorAll("[data-paid]").forEach(
    (btn) =>
      (btn.onclick = async () => {
        if (
          !confirm(
            "Confirm this claimant has received the money? This records the payment; it does not send money.",
          )
        )
          return;
        btn.disabled = true;
        try {
          await finance("paid", {
            id: Number(btn.dataset.paid),
            revision: Number(btn.dataset.revision),
          });
          b.toast("Expense marked paid.");
          await mountFinance(area);
        } catch (err) {
          btn.closest("article").querySelector("[role=status]").textContent =
            err.message;
          btn.disabled = false;
        }
      }),
  );
  area.querySelectorAll("[data-receipt]").forEach(
    (btn) =>
      (btn.onclick = async () => {
        btn.disabled = true;
        try {
          const { data, error } = await bucket.createSignedUrl(
            btn.dataset.receipt,
            300,
          );
          if (error) throw error;
          const d = document.createElement("dialog");
          d.className = "receipt-dialog";
          d.innerHTML = `<h2>Expense receipt</h2><img src="${b.safeUrl(data.signedUrl)}" alt="Uploaded expense receipt"><div class="actions"><a class="button secondary" href="${b.safeUrl(data.signedUrl)}" target="_blank" rel="noopener">Open full size</a><button>Close receipt</button></div>`;
          document.body.append(d);
          d.querySelector("button").onclick = () => d.close();
          d.onclose = () => d.remove();
          d.showModal();
        } catch (err) {
          btn.closest("article").querySelector("[role=status]").textContent =
            err.message;
        } finally {
          btn.disabled = false;
        }
      }),
  );
  area.querySelectorAll("[data-export]").forEach(
    (btn) =>
      (btn.onclick = () => {
        const date = new Date().toISOString().slice(0, 10),
          type = btn.dataset.export;
        const rows =
          type === "expenses"
            ? [
                [
                  "Claim ID",
                  "Claimant",
                  "What for",
                  "Amount GBP",
                  "Status",
                  "Submitted at",
                  "Submitted by",
                  "Paid at",
                  "Paid by",
                  "Receipt file",
                  "Notes",
                ],
                ...items.map((x) => [
                  x.id,
                  x.owner,
                  x.description,
                  x.amount,
                  x.done ? "Paid" : "Unpaid",
                  x.created_at,
                  x.created_by_name,
                  x.paid_at,
                  x.paid_by_name,
                  x.receipt_path,
                  x.note,
                ]),
              ]
            : type === "income"
              ? [
                  [
                    "Charge ID",
                    "Player",
                    "Event / fee",
                    "Category",
                    "Amount due GBP",
                    "Received GBP",
                    "Outstanding GBP",
                    "Credit GBP",
                    "Due date",
                    "Updated at",
                  ],
                  ...charges.map((x) => [
                    x.id,
                    x.name,
                    x.label,
                    x.category,
                    x.amount,
                    x.received,
                    Math.max(0, x.amount - x.received),
                    Math.max(0, x.received - x.amount),
                    x.due_date,
                    x.updated_at,
                  ]),
                ]
              : [
                  ["Finance snapshot", date],
                  ["Metric", "GBP"],
                  ["Payments received", received],
                  ["Expenses paid", paid],
                  ["Unpaid expense claims", due],
                  [
                    "Unpaid player charges",
                    charges.reduce(
                      (s, x) => s + Math.max(0, x.amount - x.received),
                      0,
                    ),
                  ],
                  [
                    "Player credits",
                    charges.reduce(
                      (s, x) => s + Math.max(0, x.received - x.amount),
                      0,
                    ),
                  ],
                  [
                    "Recorded income less paid expenses (not bank balance)",
                    Math.round((received - paid) * 100) / 100,
                  ],
                ];
        csv(`barford-2027-${type}-${date}.csv`, rows);
      }),
  );
}
