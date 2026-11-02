(() => {
  const gate = window.barfordLaunch;
  const form = document.getElementById("previewForm"), password = document.getElementById("previewPassword");
  const button = document.getElementById("previewSubmit"), status = document.getElementById("previewStatus");
  const next = (() => {
    const params = new URLSearchParams(location.search), value = params.get("next"), event = params.get("event");
    if (value) {
      try {
        const url = new URL(value, location.href), root = location.pathname.slice(0, location.pathname.lastIndexOf("/") + 1);
        const relative = url.pathname.slice(root.length);
        if (url.origin === location.origin && url.pathname.startsWith(root) && /^[a-z0-9-]+\.html$/i.test(relative) && relative !== "index.html")
          return relative + url.search + url.hash;
      } catch {}
    }
    return "home.html" + (event && /^[1-9]\d*$/.test(event) ? "?event=" + event : "") + location.hash;
  })();
  async function check() {
    try {
      const access = await gate.request();
      if (access.live || access.preview) { location.replace(next); return; }
      gate.clear();
    } catch (error) { status.textContent = error.message; }
    document.documentElement.removeAttribute("data-launch-pending");
  }
  check();
  let busy = false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); if (busy) return;
    busy = true; button.disabled = true; button.textContent = "Checking…"; status.textContent = "";
    try {
      const access = await gate.request("unlock", password.value); password.value = "";
      if (access.live || access.preview) { location.assign(next); return; }
      throw new Error("Incorrect password. Please try again.");
    } catch (error) { status.textContent = error.message; password.value = ""; password.focus(); }
    finally { busy = false; button.disabled = false; button.textContent = "Enter admin preview →"; }
  });
})();
