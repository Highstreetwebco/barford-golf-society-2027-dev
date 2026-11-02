/* Admin controls stay in the dashboard; member pages are ready for filming. */
export async function mountSiteControls(host, b) {
  if (!b.state.adminAccess) return;
  const access = await window.barfordGate;
  const gate = window.barfordLaunch;
  host.innerHTML = `<div>
    <h2>Member view</h2>
    <p id="memberViewStatus">Your website pages always show the normal member view. Editing controls and secret round results stay in Admin.</p>
    <a id="openMemberView" class="button secondary" href="home.html">Open member view</a>
    <p class="muted admin-return-note">Return here through Menu → Admin dashboard. Your account keeps full admin access, so there is no need to sign out.</p>
  </div><div>
    <h2>Website launch</h2>
    <p id="siteLaunchStatus" role="status"></p>
    <div class="actions"><button type="button" id="makeSiteLive" hidden>Make live for everyone</button><button type="button" id="exitPreview" class="secondary" hidden>Exit preview</button></div>
  </div>`;
  const status = host.querySelector("#siteLaunchStatus"), publish = host.querySelector("#makeSiteLive"), exit = host.querySelector("#exitPreview");
  status.textContent = access.live ? "The site is live for everyone." : "Coming soon is on. The website is open only to people with preview access.";
  publish.hidden = access.live;
  exit.hidden = access.live;
  exit.onclick = () => { gate.clear(); location.assign("index.html"); };
  let opening = false;
  publish.onclick = async () => {
    if (opening || document.getElementById("launchDialog")) return;
    opening = true;
    try {
      if (!(await b.isAdmin())) { b.toast("Admin sign-in required."); return; }
      const dialog = document.createElement("dialog"); dialog.id = "launchDialog"; dialog.className = "launch-dialog";
      dialog.setAttribute("aria-labelledby", "launchTitle");
      dialog.innerHTML = '<form><h2 id="launchTitle">Make live for everyone</h2><p>This removes the coming-soon screen for all visitors. Your member and admin sign-in protection stays in place.</p><label for="launchPassword">Launch password</label><input id="launchPassword" type="password" autocomplete="current-password" required maxlength="128"><p class="launch-message" role="status"></p><div class="launch-actions"><button type="button" class="launch-secondary" data-cancel>Cancel</button><button type="submit">Make live for everyone</button></div></form>';
      document.body.append(dialog);
      let busy = false;
      const close = () => { if (!busy) { dialog.close(); dialog.remove(); } };
      dialog.querySelector("[data-cancel]").onclick = close;
      dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
      dialog.querySelector("form").onsubmit = async event => {
        event.preventDefault(); if (busy) return; busy = true;
        const input = dialog.querySelector("input"), submit = dialog.querySelector('[type="submit"]'), message = dialog.querySelector('[role="status"]');
        submit.disabled = true; submit.textContent = "Publishing…"; message.textContent = "";
        try {
          if (!(await b.isAdmin())) throw new Error("Admin sign-in required.");
          const result = await gate.request("publish", input.value); input.value = "";
          if (!result.live) throw new Error("The site is still closed. Please try again.");
          dialog.close(); dialog.remove(); publish.hidden = true; exit.hidden = true;
          status.textContent = "The site is live for everyone.";
        } catch (error) { message.textContent = error.message; input.value = ""; input.focus(); }
        finally { busy = false; submit.disabled = false; submit.textContent = "Make live for everyone"; }
      };
      dialog.showModal(); dialog.querySelector("input").focus();
    } catch { b.toast("Could not check admin access. Please try again."); }
    finally { opening = false; }
  };
}
