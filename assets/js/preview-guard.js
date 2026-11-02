/* Fail closed before app code runs. Supabase independently protects the Data API. */
window.barfordGate = (async () => {
  const gate = window.barfordLaunch, page = location.pathname.split("/").pop() || "home.html";
  const back = () => location.replace("index.html?next=" + encodeURIComponent(page + location.search + location.hash));
  const ready = () => document.body ? Promise.resolve() : new Promise(resolve => {
    const observer = new MutationObserver(() => { if (document.body) { observer.disconnect(); resolve(); } });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
  const hold = () => new Promise(() => {});
  try {
    const access = await gate.request();
    if (!access.live && !access.preview) { gate.clear(); back(); return hold(); }
    await ready();
    if (!access.live) {
      const bar = document.createElement("aside");
      bar.className = "launch-preview-bar"; bar.setAttribute("aria-label", "Site preview");
      bar.innerHTML = '<span><strong>Admin preview</strong> · Everyone else sees Coming soon</span><div><button type="button" id="makeSiteLive">Make live for everyone</button><button type="button" id="exitPreview" class="launch-secondary">Exit preview</button></div>';
      document.body.prepend(bar);
      document.getElementById("exitPreview").onclick = () => { gate.clear(); location.assign("index.html"); };
      document.getElementById("makeSiteLive").onclick = () => {
        if (document.getElementById("launchDialog")) return;
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
            const result = await gate.request("publish", input.value); input.value = "";
            if (!result.live) throw new Error("The site is still closed. Please try again.");
            dialog.close(); dialog.remove();
            bar.innerHTML = '<span role="status"><strong>The site is live for everyone.</strong> The coming-soon screen has been removed.</span><a href="index.html">View homepage →</a>';
          } catch (error) { message.textContent = error.message; input.value = ""; input.focus(); }
          finally { busy = false; submit.disabled = false; submit.textContent = "Make live for everyone"; }
        };
        dialog.showModal(); dialog.querySelector("input").focus();
      };
    }
    document.getElementById("preview-lock")?.remove(); document.documentElement.style.visibility = "";
    return { ...access, token: gate.token() };
  } catch {
    await ready();
    const panel = document.createElement("main"); panel.className = "launch-unavailable";
    panel.innerHTML = '<h1>The website is being prepared.</h1><p>We couldn’t check preview access. Please try again.</p><a href="index.html">Back to Coming soon</a>';
    document.body.replaceChildren(panel);
    document.getElementById("preview-lock")?.remove(); document.documentElement.style.visibility = "";
    return hold();
  }
})();
