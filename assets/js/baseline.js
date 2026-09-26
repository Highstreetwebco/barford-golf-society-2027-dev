/* One isolated 2027 backend. Browser permissions are enforced by Supabase RLS and RPCs. */
window.barfordReady = (async () => {
  const sdk = document.createElement("script");
  sdk.src = "assets/vendor/supabase-2.116.0.js";
  await new Promise((resolve, reject) => {
    sdk.onload = resolve;
    sdk.onerror = () =>
      reject(new Error("Could not load the account service. Please refresh."));
    document.head.append(sdk);
  });
  const raw = window.supabase.createClient(
    "https://xspzmthygrajzktydvvj.supabase.co",
    "sb_publishable_xLM39PjQf4XdTVfNHFOzAQ_i4re6w_c",
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    },
  );
  const tables = new Set([
    "events",
    "rsvps",
    "tee_times",
    "players",
    "scores",
    "products",
    "shop_orders",
    "trip_events",
    "trip_votes",
    "signups",
  ]);
  const client = {
    auth: raw.auth,
    from(name) {
      if (!tables.has(name)) throw new Error("Unknown table");
      return raw.from("baseline_" + name);
    },
    rpc(name, args) {
      return raw.rpc("baseline_" + name, args);
    },
    storage: {
      from(name) {
        if (!["gallery-images", "trip-videos"].includes(name))
          throw new Error("Unknown bucket");
        return raw.storage.from("baseline-" + name);
      },
    },
  };
  const escape = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const safeUrl = (value) => {
    try {
      const u = new URL(value);
      return ["https:", "http:"].includes(u.protocol) ? escape(u.href) : "";
    } catch {
      return "";
    }
  };
  const nextPath = () => {
    const value =
      new URLSearchParams(location.search).get("next") || "index.html";
    return /^(index|events|scores|gallery|shop|worldevents|admin|account|event)\.html(?:\?id=\d+)?(?:#[\w-]+)?$/.test(
      value,
    )
      ? value
      : "events.html";
  };
  const date = (value) =>
    new Date(value + "T12:00:00").toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  const money = (value) =>
    new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
    }).format(Number(value));
  const empty = (title, body) =>
    `<div class="empty-state"><div class="empty-icon" aria-hidden="true">✦</div><h3>${escape(title)}</h3><p>${escape(body)}</p></div>`;
  const state = {
    user: null,
    profile: null,
    admin: false,
    recovery:
      location.hash.includes("type=recovery") ||
      sessionStorage.getItem("barford-password-recovery") === "true",
  };
  async function refresh() {
    const {
      data: { session },
    } = await raw.auth.getSession();
    state.user = session?.user || null;
    state.profile = null;
    state.admin = false;
    if (state.user) {
      const [p, a] = await Promise.all([
        raw
          .from("profiles")
          .select("id,full_name,email,phone")
          .eq("id", state.user.id)
          .maybeSingle(),
        raw.rpc("is_admin"),
      ]);
      if (!p.error && !p.data) {
        await raw.auth.signOut({ scope: "local" });
        state.user = null;
      }
      state.profile = p.data;
      state.admin = !!state.user && !a.error && a.data === true;
    }
    document
      .querySelectorAll("[data-admin]")
      .forEach((el) => (el.hidden = !state.admin));
    const nav = document.getElementById("accountNav");
    if (nav) nav.textContent = state.user ? "My account" : "Sign in";
    return state;
  }
  async function service(action, values = {}) {
    const { data, error } = await raw.functions.invoke("baseline-services", {
      body: { action, ...values },
    });
    if (error) {
      let message = error.message;
      try {
        message = (await error.context.json()).error || message;
      } catch {}
      throw new Error(message);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }
  async function login(username, password) {
    if (username.includes("@")) {
      const { error } = await raw.auth.signInWithPassword({
        email: username,
        password,
      });
      if (error) throw error;
    } else {
      const { session } = await service("login", { username, password });
      const { error } = await raw.auth.setSession(session);
      if (error) throw error;
    }
  }
  let pendingSignIn;
  async function signIn() {
    if (pendingSignIn) return pendingSignIn;
    const el = document.createElement("dialog");
    el.setAttribute("aria-labelledby", "signInTitle");
    const current =
      location.pathname.split("/").pop() + location.search + location.hash;
    el.innerHTML = `<form class="form-stack"><h2 id="signInTitle">Member sign in</h2><p class="muted">Sign in to save your response.</p><label for="dialogEmail">Username (your name)</label><input id="dialogEmail" name="email" type="text" autocomplete="username" required><label for="dialogPassword">Password</label><input id="dialogPassword" name="password" type="password" autocomplete="current-password" required><p class="form-status" role="status"></p><div class="dialog-actions"><button>Sign in</button><button type="button" class="secondary" data-cancel>Cancel</button></div></form><div class="dialog-links"><a href="signup.html?next=${encodeURIComponent(current)}">Create an account</a><a href="account.html?mode=reset">Forgot password?</a></div>`;
    document.body.append(el);
    pendingSignIn = new Promise((resolve) => {
      const finish = (value) => {
        el.close();
        el.remove();
        pendingSignIn = null;
        resolve(value);
      };
      el.querySelector("[data-cancel]").onclick = () => finish(false);
      el.oncancel = (e) => {
        e.preventDefault();
        finish(false);
      };
      el.querySelector("form").onsubmit = async (e) => {
        e.preventDefault();
        await submit(e.target, async () => {
          const data = new FormData(e.target);
          await login(
            String(data.get("email")).trim(),
            String(data.get("password")),
          );
          await refresh();
          finish(true);
        });
      };
    });
    el.showModal();
    return pendingSignIn;
  }
  async function requireMember() {
    await refresh();
    return !!state.user || (await signIn());
  }
  async function isAdmin() {
    await refresh();
    return state.admin;
  }
  async function requireAdmin() {
    if (await isAdmin()) return true;
    if (!state.user && !(await signIn())) return false;
    if (await isAdmin()) return true;
    toast("This account does not have organiser access.");
    return false;
  }
  async function submit(form, fn) {
    const button = form.querySelector(
      'button[type="submit"],button:not([type])',
    );
    const status = form.querySelector('[role="status"]');
    if (button?.disabled) return;
    const oldText = button?.textContent;
    if (button) {
      button.disabled = true;
      button.textContent = "Saving…";
    }
    if (status) {
      status.textContent = "";
      status.classList.remove("success");
    }
    try {
      await fn();
    } catch (error) {
      if (status)
        status.textContent =
          error.message || "Something went wrong. Please try again.";
      else toast(error.message);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = oldText;
      }
    }
  }
  let toastTimer;
  function toast(message) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = message;
    el.style.opacity = "1";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.style.opacity = "0"), 4500);
  }
  raw.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") {
      state.recovery = true;
      sessionStorage.setItem("barford-password-recovery", "true");
      window.dispatchEvent(new Event("barford-recovery"));
    }
    if (event === "SIGNED_OUT")
      setTimeout(() => {
        refresh().then(() =>
          window.dispatchEvent(new Event("barford-signout")),
        );
      }, 0);
  });
  const page = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".site-nav a").forEach((a) => {
    if (a.getAttribute("href") === page) a.setAttribute("aria-current", "page");
  });
  document.getElementById("menuToggle")?.addEventListener("click", (e) => {
    const open = document.getElementById("siteNav").classList.toggle("open");
    e.currentTarget.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", (e) => {
    document.querySelectorAll(".more-nav[open]").forEach((d) => {
      if (!d.contains(e.target)) d.open = false;
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape")
      document.querySelectorAll(".more-nav").forEach((d) => (d.open = false));
  });
  const themeButton = document.getElementById("themeToggle");
  let dark = localStorage.getItem("darkMode") === "on";
  function applyTheme() {
    document.body.classList.toggle("dark-mode", dark);
    themeButton?.setAttribute("aria-pressed", String(dark));
    if (themeButton)
      themeButton.textContent = dark ? "Light mode" : "Dark mode";
  }
  applyTheme();
  themeButton?.addEventListener("click", () => {
    dark = !dark;
    localStorage.setItem("darkMode", dark ? "on" : "off");
    applyTheme();
  });
  let installPrompt;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e;
    document.getElementById("installButton").hidden = false;
  });
  document
    .getElementById("installButton")
    ?.addEventListener("click", async () => {
      if (installPrompt) {
        await installPrompt.prompt();
        installPrompt = null;
        document.getElementById("installButton").hidden = true;
      }
    });
  if ("serviceWorker" in navigator)
    navigator.serviceWorker
      .register("sw.js", {
        scope: new URL("./", location.href).href,
        updateViaCache: "none",
      })
      .then((r) => r.update())
      .catch(() => {});
  window.barford = {
    raw,
    login,
    service,
    client,
    state,
    escape,
    safeUrl,
    nextPath,
    date,
    money,
    empty,
    refresh,
    signIn,
    requireMember,
    requireAdmin,
    isAdmin,
    submit,
    toast,
  };
  await refresh();
  if (state.recovery && state.user && page !== "account.html") {
    sessionStorage.setItem("barford-password-recovery", "true");
    location.href = "account.html?mode=recovery";
  }
  return window.barford;
})();
window.addEventListener("unhandledrejection", (e) => {
  if (!window.barford) {
    const main = document.getElementById("main");
    if (main) {
      const p = document.createElement("p");
      p.className = "notice";
      p.textContent =
        "The account service could not load. Please refresh or try again shortly.";
      main.prepend(p);
    }
  }
});
