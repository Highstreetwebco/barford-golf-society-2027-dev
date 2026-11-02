/* Passwords are checked by Supabase. Only an expiring preview token stays in this tab. */
(() => {
  const key = "barford-2027-preview-session";
  const endpoint = "https://xspzmthygrajzktydvvj.supabase.co/rest/v1/rpc/baseline_site_gate";
  const apiKey = "sb_publishable_xLM39PjQf4XdTVfNHFOzAQ_i4re6w_c";
  const token = () => { try { return sessionStorage.getItem(key) || ""; } catch { return ""; } };
  const clear = () => { try { sessionStorage.removeItem(key); } catch {} };
  async function request(action = "status", password = null) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(endpoint, {
        method: "POST", cache: "no-store", signal: controller.signal,
        headers: { apikey: apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ p_action: action, p_password: password, p_token: token() }),
      });
      if (!response.ok) throw new Error("Unable to check website access. Please try again.");
      const result = await response.json();
      if (!result || typeof result.live !== "boolean" || typeof result.preview !== "boolean")
        throw new Error("Unable to check website access. Please try again.");
      if (result.error) throw new Error(result.error);
      if (result.token) {
        if (!/^[a-f0-9]{64}$/.test(result.token)) throw new Error("Unable to check website access.");
        try { sessionStorage.setItem(key, result.token); }
        catch { throw new Error("Allow session storage in your browser to use the admin preview."); }
      }
      return result;
    } finally { clearTimeout(timeout); }
  }
  window.barfordLaunch = { request, token, clear };
})();
