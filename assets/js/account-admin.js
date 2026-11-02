const b = await window.barfordReady, e = b.escape;
let accounts = [], generation = 0, editingDirty = false;
window.addEventListener("beforeunload", ev => { if (editingDirty) { ev.preventDefault(); ev.returnValue = ""; } });

export async function loadAccounts() {
  const ticket = ++generation, list = document.getElementById("accountList"), refresh = document.getElementById("refreshAccounts");
  refresh.disabled = true;
  list.innerHTML = '<p class="muted" role="status">Loading members…</p>';
  try {
    const { data, error } = await b.client.rpc("admin_members");
    if (ticket !== generation) return;
    if (error) throw error;
    accounts = data || [];
    render();
    document.getElementById("accountSearch").oninput = render;
  } catch (error) {
    if (ticket === generation) list.innerHTML = b.empty("Could not load members.", error.message);
  } finally { if (ticket === generation) refresh.disabled = false; }
  refresh.onclick = loadAccounts;
}
function render() {
  const query = document.getElementById("accountSearch").value.trim().toLowerCase();
  const active = accounts.filter(p => !p.disabled);
  const visible = accounts.filter(p => (query || !p.disabled) && ((p.username || "").toLowerCase().includes(query) || (p.mobile || "").includes(query)));
  document.getElementById("accountSummary").textContent = `${active.length} members · ${active.filter(p => p.registered !== false).length} with a login · ${active.filter(p => p.is_admin).length} admins`;
  const list = document.getElementById("accountList");
  list.innerHTML = visible.length ? visible.map(p => `<article class="account-row"><div><h3>${e(p.username)}${p.id === b.state.user.id ? " <small>(you)</small>" : ""}</h3><p>${p.mobile ? `<a href="tel:${e(p.mobile.replace(/[^+0-9]/g, ""))}">${e(p.mobile)}</a>` : "No mobile number"} · Starting handicap: ${p.handicap ?? "not set"}</p></div><div class="account-row-actions"><span class="status-pill ${p.disabled ? "cancelled" : ""}">${p.disabled ? "Name released" : p.registered === false ? "No login yet" : p.is_admin ? "Admin" : "Member"}</span><button type="button" class="secondary" data-edit-account="${e(p.id)}" ${p.disabled ? "disabled" : ""}>Edit member</button>${p.member_id && !p.disabled ? `<button type="button" class="secondary" data-edit-photo="${e(p.id)}">Edit photo</button>` : ""}${p.registered !== false ? `<button type="button" class="text-button" data-reset-account="${e(p.id)}" ${p.disabled ? "disabled" : ""}>Reset password</button>` : ""}</div></article>`).join("") : b.empty("No matching members.", "Try a different name or mobile number.");
  list.querySelectorAll("[data-edit-account]").forEach(button => button.onclick = () => edit(accounts.find(p => p.id === button.dataset.editAccount)));
  list.querySelectorAll("[data-reset-account]").forEach(button => button.onclick = () => resetPassword(accounts.find(p => p.id === button.dataset.resetAccount)));
  list.querySelectorAll("[data-edit-photo]").forEach(button => button.onclick = async () => {
    button.disabled = true;
    try { const { editMemberPhoto } = await import("./admin-member-photos.js?v=2027-admin-photos-1"); await editMemberPhoto(accounts.find(p => p.id === button.dataset.editPhoto)); }
    catch { b.toast("Could not open the photo editor. Please refresh and try again."); }
    finally { button.disabled = false; }
  });
}
function openDialog(title, contents) {
  const dialog = document.createElement("dialog");
  dialog.className = "account-editor"; dialog.setAttribute("aria-labelledby", "accountDialogTitle");
  dialog.innerHTML = `<form class="form-stack"><h2 id="accountDialogTitle">${e(title)}</h2>${contents}<p class="form-status" role="status"></p><div class="actions"><button type="submit">Save changes</button><button type="button" class="secondary" data-close>Cancel</button></div></form>`;
  document.body.append(dialog);
  const form = dialog.querySelector("form");
  form.oninput = () => editingDirty = true;
  dialog.querySelector("[data-close]").onclick = () => { if (!dialog.dataset.busy) dialog.close(); };
  dialog.oncancel = ev => { if (dialog.dataset.busy) ev.preventDefault(); };
  dialog.onclose = () => { editingDirty = false; dialog.remove(); };
  dialog.showModal();
  return dialog;
}
async function saveDialog(dialog, work) {
  if (dialog.dataset.busy) return;
  const form = dialog.querySelector("form"), status = form.querySelector(".form-status");
  const invalid = form.querySelector(":invalid");
  if (invalid?.closest("details")) invalid.closest("details").open = true;
  if (!form.reportValidity()) return;
  dialog.dataset.busy = "true"; form.inert = true; status.textContent = "Saving… Please wait.";
  try { await work(); }
  catch (error) { status.textContent = error.message || "Could not save. Please try again."; }
  finally { delete dialog.dataset.busy; form.inert = false; }
}
function edit(person) {
  if (!person) return;
  const registered = person.registered !== false;
  const dialog = openDialog("Edit member", `<p class="muted">${e(person.username)}</p>${registered ? "" : '<p class="notice">This member has not created a login yet. You can prepare their details here.</p>'}<label for="managedUsername">Member name</label><input id="managedUsername" name="username" value="${e(person.username)}" minlength="2" maxlength="150" required><small>${registered ? "This is also the member's sign-in name." : "They will select this name when creating their login. Existing bookings stay linked."}</small><label for="managedMobile">Mobile number${registered ? "" : " (optional)"}</label><input id="managedMobile" name="mobile" type="tel" value="${e(person.mobile || "")}" minlength="10" maxlength="25" ${registered ? "required" : ""}><label for="managedHandicap">Season starting handicap</label><input id="managedHandicap" name="handicap" type="number" min="0" max="36" step="0.1" value="${person.handicap ?? ""}"><small>Correcting this starting value recalculates handicaps for completed rounds.</small>${registered ? `<details class="admin-extra"><summary>Admin access</summary><label class="admin-role-choice"><input name="admin_access" type="checkbox" ${person.is_admin ? "checked" : ""} ${person.id === b.state.user.id ? "disabled" : ""}>Allow this member to use admin</label><small>${person.id === b.state.user.id ? "You cannot remove your own admin access." : "Admins can manage members, passwords, events and scores. Only give this access to a committee member who needs it."}</small></details>` : '<small>Password and admin access settings become available after this member creates a login.</small>'}`);
  const form = dialog.querySelector("form");
  form.onsubmit = ev => {
    ev.preventDefault();
    saveDialog(dialog, async () => {
      const f = new FormData(form), adminAccess = registered && (person.id === b.state.user.id ? true : form.elements.admin_access.checked);
      const handicap = f.get("handicap") === "" ? null : Number(f.get("handicap"));
      if (registered && adminAccess !== person.is_admin && !confirm(`${adminAccess ? "Give admin access to" : "Remove admin access from"} ${person.username}?`)) return;
      if (person.handicap != null && handicap !== person.handicap && !confirm(`Change ${person.username}'s season starting handicap from ${person.handicap} to ${handicap ?? "not set"}? Completed-round handicaps will be recalculated.`)) return;
      const payload = { target: person.id, username: String(f.get("username") || "").trim(), mobile: String(f.get("mobile") || "").trim(), society_handicap: handicap };
      if (registered) payload.admin_access = adminAccess;
      const { error } = await b.client.rpc(registered ? "admin_save_account" : "admin_save_roster_member", payload);
      if (error) throw error;
      dialog.close();
      await b.refresh(); await loadAccounts();
      window.dispatchEvent(new CustomEvent("barford:member-account-saved"));
      b.toast("Member saved.");
    });
  };
}
function resetPassword(person) {
  if (!person || person.registered === false) return;
  const dialog = openDialog("Reset password", `<p>Set a new password for <strong>${e(person.username)}</strong>. Check who you are helping before sharing it privately.</p><label for="managedPassword">New password</label><input id="managedPassword" name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required><label for="managedConfirm">Confirm new password</label><input id="managedConfirm" name="confirm" type="password" autocomplete="new-password" minlength="12" maxlength="128" required><small>Use at least 12 characters. Ask the member to change it after signing in.</small>`);
  dialog.querySelector('[type="submit"]').textContent = "Reset password";
  const form = dialog.querySelector("form");
  form.onsubmit = ev => {
    ev.preventDefault();
    saveDialog(dialog, async () => {
      const f = new FormData(form);
      if (f.get("password") !== f.get("confirm")) throw new Error("The passwords do not match.");
      await b.service("admin_reset_password", { target: person.id, confirmation_name: person.username, password: f.get("password") });
      dialog.close(); b.toast("Password reset. Share it with the verified member privately.");
    });
  };
}
