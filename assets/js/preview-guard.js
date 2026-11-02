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
