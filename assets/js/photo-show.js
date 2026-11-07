(() => {
  const play = document.getElementById("playPhotos");
  const stage = document.getElementById("photoShow");
  const frame = document.getElementById("photoFrame");
  const close = document.getElementById("endShow");
  const status = document.getElementById("photoStatus");
  const storage = "https://xspzmthygrajzktydvvj.supabase.co/storage/v1";
  const bucket = "baseline-gallery-images";
  const apiKey = "sb_publishable_xLM39PjQf4XdTVfNHFOzAQ_i4re6w_c";
  let session;
  let controlsTimer;

  async function listPhotos(signal) {
    const urls = [];
    for (let offset = 0; ; offset += 100) {
      const response = await fetch(storage + "/object/list/" + bucket, {
        method: "POST", signal, headers: { apikey: apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ prefix: "uploads", limit: 100, offset, sortBy: { column: "name", order: "asc" } })
      });
      if (!response.ok) throw new Error("Gallery unavailable");
      const items = await response.json();
      for (const item of items) {
        if (item.id && !item.name.startsWith(".")) urls.push(storage + "/object/public/" + bucket + "/uploads/" + encodeURIComponent(item.name));
      }
      if (items.length < 100) return urls;
    }
  }

  async function keepAwake(run) {
    if (run !== session || document.hidden || run.lock || run.requesting || !navigator.wakeLock) return;
    run.requesting = true;
    try {
      const lock = await navigator.wakeLock.request("screen");
      if (session !== run) { await lock.release(); return; }
      run.lock = lock;
      lock.addEventListener("release", () => { if (run.lock === lock) run.lock = null; });
    } catch { /* Device power policy may decline a screen lock. */ }
    finally { run.requesting = false; }
  }

  function stop(message) {
    if (!session) return;
    const run = session;
    session = null;
    clearTimeout(run.timer);
    clearTimeout(controlsTimer);
    run.controller.abort();
    run.lock?.release().catch(() => {});
    if (document.fullscreenElement === stage) document.exitFullscreen().catch(() => {});
    stage.hidden = true;
    close.hidden = true;
    frame.replaceChildren();
    run.background.forEach(el => el.inert = false);
    status.textContent = message || "";
    status.hidden = !message;
    play.focus({ preventScroll: true });
  }

  async function advance(run) {
    let attempts = 0;
    while (session === run && attempts++ < run.urls.length) {
      const image = new Image();
      image.alt = "Barford Golf Society gallery photo";
      image.src = run.urls[run.index];
      run.index = (run.index + 1) % run.urls.length;
      let timeout;
      try {
        await Promise.race([image.decode(), new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("Image timed out")), 12000);
        })]);
      } catch { continue; }
      finally { clearTimeout(timeout); }
      if (session !== run) return;
      frame.replaceChildren(image);
      keepAwake(run);
      run.timer = setTimeout(() => advance(run), 8000);
      return;
    }
    if (session === run) stop("The photos couldn’t load. Check your connection and select Play photos to retry.");
  }

  play.addEventListener("click", async () => {
    if (session) return;
    const run = session = { controller: new AbortController(), index: 0,
      background: Array.from(document.querySelectorAll("body > header, body > main, body > footer")).filter(el => !el.inert) };
    status.hidden = true;
    stage.hidden = false;
    run.background.forEach(el => el.inert = true);
    stage.focus();
    stage.requestFullscreen?.({ navigationUI: "hide" }).catch(() => {});
    keepAwake(run);
    const timeout = setTimeout(() => run.controller.abort(), 20000);
    try {
      run.urls = await listPhotos(run.controller.signal);
      if (session !== run) return;
      if (!run.urls.length) return stop("There are no gallery photos to play yet.");
      advance(run);
    } catch { if (session === run) stop("The gallery couldn’t load. Select Play photos to try again."); }
    finally { clearTimeout(timeout); }
  });

  stage.addEventListener("click", event => {
    if (event.target === close) return stop();
    close.hidden = false;
    clearTimeout(controlsTimer);
    controlsTimer = setTimeout(() => { close.hidden = true; stage.focus(); }, 3500);
  });
  document.addEventListener("keydown", event => {
    if (!session) return;
    if (event.key === "Escape") { event.preventDefault(); stop(); }
    if (event.key === "Tab") { event.preventDefault(); clearTimeout(controlsTimer); close.hidden = false; close.focus(); }
  });
  document.addEventListener("fullscreenchange", () => {
    if (session && document.fullscreenElement !== stage) stop();
  });
  document.addEventListener("visibilitychange", () => { if (session) keepAwake(session); });
  window.addEventListener("pagehide", () => stop());
})();
