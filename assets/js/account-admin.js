const b = await window.barfordReady;
const e = b.escape;
let accounts = [];
export async function loadAccounts() {
  const list = document.getElementById("accountList");
  const { data, error } = await b.client.rpc("admin_accounts");
  if (error) {
    list.innerHTML = b.empty("Accounts could not load.", error.message);
    return;
  }
  accounts = data || [];
  render();
  document.getElementById("accountSearch").oninput = render;
  document.getElementById("refreshAccounts").onclick = loadAccounts;
}
function render() {
  const query = document
    .getElementById("accountSearch")
    .value.trim()
    .toLowerCase();
  const visible = accounts.filter(
    (p) =>
      p.username.toLowerCase().includes(query) ||
      (p.mobile || "").includes(query),
  );
  document.getElementById("accountSummary").textContent =
    `${accounts.length} account${accounts.length === 1 ? "" : "s"} · ${accounts.filter((p) => p.is_admin).length} admin${accounts.filter((p) => p.is_admin).length === 1 ? "" : "s"}`;
  const list = document.getElementById("accountList");
  list.innerHTML = visible.length
    ? visible
        .map(
          (p) =>
            `<article class="account-row"><div><h3>${e(p.username)} ${p.id === b.state.user.id ? "<small>(you)</small>" : ""}</h3><p>${p.mobile ? `<a href="tel:${e(p.mobile.replace(/[^+0-9]/g, ""))}">${e(p.mobile)}</a>` : "No mobile number"} · Starting handicap: ${p.handicap ?? "not set"}</p><small>Joined ${e(new Date(p.created_at).toLocaleDateString("en-GB"))}</small></div><div class="account-row-actions"><span class="status-pill ${p.disabled ? "cancelled" : ""}">${p.disabled ? "Name released" : p.is_admin ? "Admin" : "Member"}</span><button class="secondary" data-edit-account="${e(p.id)}" ${p.disabled ? "disabled" : ""}>Edit account</button><button class="text-button" data-reset-account="${e(p.id)}" ${p.disabled ? "disabled" : ""}>Reset password</button></div></article>`,
        )
        .join("")
    : b.empty(
        "No matching accounts.",
        "Try a different name or mobile number.",
      );
  list
    .querySelectorAll("[data-edit-account]")
    .forEach(
      (btn) =>
        (btn.onclick = () =>
          edit(accounts.find((p) => p.id === btn.dataset.editAccount))),
    );
  list
    .querySelectorAll("[data-reset-account]")
    .forEach(
      (btn) =>
        (btn.onclick = () =>
          resetPassword(
            accounts.find((p) => p.id === btn.dataset.resetAccount),
          )),
    );
}
function openDialog(title, contents) {
  const dialog = document.createElement("dialog");
  dialog.className = "account-editor";
  dialog.setAttribute("aria-labelledby", "accountDialogTitle");
  dialog.innerHTML = `<form class="form-stack"><h2 id="accountDialogTitle">${e(title)}</h2>${contents}<p class="form-status" role="status"></p><div class="actions"><button type="submit">Save changes</button><button type="button" class="secondary" data-close>Cancel</button></div></form>`;
  document.body.append(dialog);
  dialog.querySelector("[data-close]").onclick = () => dialog.close();
  dialog.onclose = () => dialog.remove();
  dialog.showModal();
  return dialog;
}
function edit(person) {
  const dialog = openDialog(
    "Edit " + person.username,
    `<label for="managedUsername">Username</label><input id="managedUsername" name="username" value="${e(person.username)}" minlength="2" maxlength="150" required><small>Changing this name changes the member’s sign-in username and their saved RSVP name.</small><label for="managedMobile">Mobile number</label><input id="managedMobile" name="mobile" type="tel" value="${e(person.mobile || "")}" minlength="10" maxlength="25" required><label for="managedHandicap">Season starting handicap</label><input id="managedHandicap" name="handicap" type="number" min="0" max="36" step="0.1" value="${person.handicap ?? ""}"><small>Changing this starting value recalculates handicaps for all published rounds.</small><label class="admin-role-choice"><input name="admin_access" type="checkbox" ${person.is_admin ? "checked" : ""} ${person.id === b.state.user.id ? "disabled" : ""}>Administrator access</label><small>${person.id === b.state.user.id ? "You cannot remove your own admin access." : "Admins can edit all accounts, reset passwords, manage events and appoint other admins. Only give this access to someone you trust."}</small>`,
  );
  const form = dialog.querySelector("form");
  form.onsubmit = (event) => {
    event.preventDefault();
    b.submit(form, async () => {
      const f = new FormData(form),
        adminAccess =
          person.id === b.state.user.id
            ? true
            : form.elements.admin_access.checked;
      if (
        adminAccess !== person.is_admin &&
        !confirm(
          `${adminAccess ? "Give" : "Remove"} admin access ${adminAccess ? "for" : "from"} ${person.username}?${adminAccess ? " They will be able to manage every account and appoint other admins." : ""}`,
        )
      )
        return;
      const { error } = await b.client.rpc("admin_save_account", {
        target: person.id,
        username: String(f.get("username")).trim(),
        mobile: String(f.get("mobile")).trim(),
        society_handicap:
          f.get("handicap") === "" ? null : Number(f.get("handicap")),
        admin_access: adminAccess,
      });
      if (error) throw error;
      dialog.close();
      await b.refresh();
      await loadAccounts();
      b.toast("Account updated.");
    });
  };
}
function resetPassword(person) {
  const dialog = openDialog(
    "Reset password",
    `<p>Set a new password for <strong>${e(person.username)}</strong>. Verify who you are helping before sharing it with them.</p><label for="managedPassword">New password</label><input id="managedPassword" name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required><label for="managedConfirm">Confirm new password</label><input id="managedConfirm" name="confirm" type="password" autocomplete="new-password" minlength="12" maxlength="128" required><small>Use at least 12 characters. Existing passwords cannot be viewed. Ask the member to change this password after signing in.</small>`,
  );
  dialog.querySelector("[type=submit]").textContent = "Reset password";
  const form = dialog.querySelector("form");
  form.onsubmit = (event) => {
    event.preventDefault();
    b.submit(form, async () => {
      const f = new FormData(form);
      if (f.get("password") !== f.get("confirm"))
        throw new Error("The passwords do not match.");
      await b.service("admin_reset_password", {
        target: person.id,
        confirmation_name: person.username,
        password: f.get("password"),
      });
      dialog.close();
      b.toast("Password reset. Share it with the verified member privately.");
    });
  };
}
