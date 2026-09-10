(() => {
  "use strict";
  const config = window.BARFORD_2027_CONFIG;
  if (!config) {
    console.error("The isolated 2027 account configuration is unavailable.");
    return;
  }
  const endpoint = `${config.supabaseUrl}/functions/v1/passkeys`;
  const encode = value => {
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer);
    let binary = "";
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  const decode = value => {
    const normal = String(value).replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normal.padEnd(Math.ceil(normal.length / 4) * 4, "="));
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  };
  const request = async (action, body = {}, accessToken = "") => {
    const response = await fetch(`${endpoint}/${action}`, {
      method: "POST",
      signal: AbortSignal.timeout(12000),
      headers: {
        "Content-Type": "application/json",
        apikey: config.supabasePublishableKey,
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
      },
      body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Device sign-in is temporarily unavailable.");
    return result;
  };
  const registrationJSON = credential => ({
    id: credential.id, rawId: encode(credential.rawId), type: credential.type,
    response: {
      clientDataJSON: encode(credential.response.clientDataJSON),
      attestationObject: encode(credential.response.attestationObject),
      transports: credential.response.getTransports?.() || []
    },
    clientExtensionResults: credential.getClientExtensionResults()
  });
  const authenticationJSON = credential => ({
    id: credential.id, rawId: encode(credential.rawId), type: credential.type,
    response: {
      clientDataJSON: encode(credential.response.clientDataJSON),
      authenticatorData: encode(credential.response.authenticatorData),
      signature: encode(credential.response.signature),
      userHandle: credential.response.userHandle ? encode(credential.response.userHandle) : null
    },
    clientExtensionResults: credential.getClientExtensionResults()
  });

  window.BarfordPasskeys = {
    supported: Boolean(window.PublicKeyCredential && navigator.credentials),
    async register() {
      const { data: { session } } = await window.BarfordSupabase.auth.getSession();
      if (!session) throw new Error("Please sign in before adding this device.");
      const options = await request("register-options", {}, session.access_token);
      options.challenge = decode(options.challenge);
      options.user.id = decode(options.user.id);
      options.excludeCredentials = (options.excludeCredentials || []).map(item => ({ ...item, id: decode(item.id) }));
      const credential = await navigator.credentials.create({ publicKey: options });
      if (!credential) throw new Error("Device sign-in was cancelled.");
      await request("register-verify", { credential: registrationJSON(credential) }, session.access_token);
    },
    async login() {
      const options = await request("login-options");
      options.challenge = decode(options.challenge);
      options.allowCredentials = (options.allowCredentials || []).map(item => ({ ...item, id: decode(item.id) }));
      const credential = await navigator.credentials.get({ publicKey: options });
      if (!credential) throw new Error("Device sign-in was cancelled.");
      const result = await request("login-verify", { credential: authenticationJSON(credential) });
      const { error } = await window.BarfordSupabase.auth.verifyOtp({ token_hash: result.tokenHash, type: "magiclink" });
      if (error) throw error;
    }
  };
})();
