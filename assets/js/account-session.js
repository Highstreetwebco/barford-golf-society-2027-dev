(() => {
  "use strict";

  // This runs before the account SDK so recovery does not depend on it loading.
  const storageKey = "sb-xspzmthygrajzktydvvj-auth-token";
  const resetKey = `${storageKey}-reset-pending`;
  const authKeys = [storageKey, `${storageKey}-code-verifier`, `${storageKey}-user`];
  let signingOut = false;
  let loadingTimer;

  if (!document.getElementById("accountConnection") && document.getElementById("accountContent")) {
    const panel = document.createElement("section");
    panel.id = "accountConnection";
    panel.className = "section shell";
    panel.innerHTML = '<div class="account-panel"><p id="accountConnectionStatus" role="status" aria-live="polite">Loading your account…</p><div class="account-connection-actions"><button id="accountRetry" class="button button-primary hidden" type="button">Try again</button> <button class="button button-outline" type="button" data-account-sign-out>Sign out</button></div></div>';
    document.getElementById("accountContent").before(panel);
  }

  const withTimeout = (operation, milliseconds = 12000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Account connection timed out")), milliseconds);
    Promise.resolve(operation).then(resolve, reject).finally(() => clearTimeout(timer));
  });
  const showProblem = (text = "Your account could not be loaded. Try again, or sign out and sign back in.") => {
    clearTimeout(loadingTimer);
    if (signingOut) return;
    document.getElementById("accountContent")?.classList.add("hidden");
    document.getElementById("accountSignedOut")?.classList.add("hidden");
    const panel = document.getElementById("accountConnection");
    panel?.classList.remove("hidden");
    panel?.setAttribute("aria-busy", "false");
    const message = document.getElementById("accountConnectionStatus");
    if (message) message.textContent = text;
    document.getElementById("accountRetry")?.classList.remove("hidden");
  };
  const loading = () => {
    if (signingOut) return;
    clearTimeout(loadingTimer);
    document.getElementById("accountContent")?.classList.add("hidden");
    document.getElementById("accountSignedOut")?.classList.add("hidden");
    const panel = document.getElementById("accountConnection");
    panel?.classList.remove("hidden");
    panel?.setAttribute("aria-busy", "true");
    const message = document.getElementById("accountConnectionStatus");
    if (message) message.textContent = "Loading your account…";
    document.getElementById("accountRetry")?.classList.add("hidden");
    loadingTimer = setTimeout(() => showProblem(), 15000);
  };
  const ready = () => {
    clearTimeout(loadingTimer);
    document.getElementById("accountConnection")?.classList.add("hidden");
  };

  const signOut = async () => {
    if (signingOut) return;
    signingOut = true;
    try{localStorage.removeItem("barford-score-active-member");}catch{}
    clearTimeout(loadingTimer);
    document.querySelectorAll("#accountSignOut, [data-account-sign-out]").forEach(button => {
      button.disabled = true;
      button.textContent = "Signing out…";
    });
    try { localStorage.setItem(resetKey, "1"); } catch {}
    try {
      const client = window.BarfordSupabase;
      if (client) await withTimeout(client.auth.signOut({ scope: "local" }), 2500);
    } catch {
      // A stale session, offline request or SDK lock must not trap this device.
    }
    try {
      // GitHub Pages shares an origin with other apps: remove only this login.
      authKeys.forEach(key => localStorage.removeItem(key));
      sessionStorage.removeItem("barford-first-login");
    } catch {
      signingOut = false;
      showProblem("Your browser could not clear the saved sign-in. Allow site storage, then try signing out again.");
      document.querySelectorAll("#accountSignOut, [data-account-sign-out]").forEach(button => {
        button.disabled = false;
        button.textContent = "Sign out";
      });
      return;
    }
    // Reload drops any in-memory session and releases this page's auth locks.
    window.location.replace("account.html?signedout=1");
  };

  window.BarfordAccountSession = { withTimeout, loading, ready, showProblem, signOut,
    get signingOut() { return signingOut; }
  };
  document.addEventListener("click", event => {
    if (!event.target.closest("#accountSignOut, [data-account-sign-out]")) return;
    event.preventDefault();
    signOut();
  });
  document.getElementById("accountRetry")?.addEventListener("click", () => window.location.reload());
  loading();
})();
