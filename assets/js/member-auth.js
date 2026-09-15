(function initialiseMemberAuth() {
  "use strict";

  // A previously cached account page may not yet declare the recovery script.
  if (document.getElementById("accountContent") && !window.BarfordAccountSession) {
    const script = document.createElement("script");
    script.src = "assets/js/account-session.js?v=account73";
    script.onload = initialiseMemberAuth;
    script.onerror=()=>{document.getElementById("accountContent")?.classList.add("hidden");const el=document.getElementById("accountConnectionStatus");if(el)el.textContent="Please refresh this page to reconnect your account.";};
    document.head.appendChild(script);
    return;
  }

  const client = window.BarfordSupabase;
  const $ = selector => document.querySelector(selector);
  const message = (selector, text, isError = false) => {
    const element = $(selector);
    if (!element) return;
    element.textContent = text;
    element.classList.toggle("error", isError);
  };

  if (!client) {
    message(".form-status", "The secure account connection is unavailable. Please refresh the page.", true);
    window.BarfordAccountSession?.showProblem("The account connection is unavailable. Try again, or sign out to reset your saved sign-in.");
    return;
  }

  const accountSession = window.BarfordAccountSession;
  const bounded = operation => accountSession ? accountSession.withTimeout(operation) : window.BarfordMemberFlow.bounded(operation);
  const returnTo=()=>window.BarfordMemberFlow.safeReturn(new URLSearchParams(location.search).get("returnTo"));
  document.querySelectorAll('a[href="signup.html"],a[href="account.html"]').forEach(link=>{if(new URLSearchParams(location.search).has('returnTo'))link.href=link.getAttribute('href')+'?returnTo='+encodeURIComponent(returnTo());});
  const storedEmail=()=>{try{return localStorage.getItem("barford-login-email")||"";}catch{return "";}};

  const isIPhone = /iPhone|iPod/i.test(navigator.userAgent);
  const faceIdReady = () => {try{return localStorage.getItem("barford-passkey-offered") === "complete";}catch{return false;}};

  const escapeHtml = value => String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  const friendlyDate = value => value
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" })
      .format(new Date(`${value}T12:00:00`))
    : "Date not announced";

  const initials = name => String(name || "BG").split(/\s+/).filter(Boolean).slice(0, 2)
    .map(part => part[0].toUpperCase()).join("");

  const setAvatar = (element, profile) => {
    if (!element) return;
    element.textContent = initials(profile?.full_name);
  };

  const photoRequests = new Map();
  const signedPhoto = path => {
    if(!photoRequests.has(path)) {
      const pending=bounded(client.storage.from("profile-images").createSignedUrl(path,3600))
        .then(result=>{if(result.error||!result.data?.signedUrl){photoRequests.delete(path);return null;}return result.data.signedUrl;})
        .catch(()=>{photoRequests.delete(path);return null;});
      photoRequests.set(path,pending);
    }
    return photoRequests.get(path);
  };
  const renderProfilePhoto = async (element, profile) => {
    if (!element) return;
    setAvatar(element, profile);
    element.classList.remove("has-photo");
    delete element.dataset.profilePhoto;delete element.dataset.photoPath;
    if (!profile?.photo_url){element.removeAttribute("role");element.removeAttribute("tabindex");element.removeAttribute("aria-label");return;}
    const path=profile.photo_url;element.dataset.photoPath=path;
    const url=await signedPhoto(path);
    if(!url||accountSession?.signingOut||element.dataset.photoPath!==path)return;
    element.innerHTML = `<img src="${escapeHtml(url)}" alt="" decoding="async">`;
    element.classList.add("has-photo");
    element.dataset.profilePhoto = url;
    element.tabIndex = 0;
    element.setAttribute("role", "button");
    element.setAttribute("aria-label", `View ${profile.full_name || "member"} profile photo`);
  };

  const signupForm = $("#memberSignupForm");
  const signupNameSelect = $("#signupName");
  const signupNewNameWrap = $("#signupNewNameWrap");
  const signupNewName = $("#signupNewName");
  const themeText = colour => {
    const value = String(colour || "#000000").replace("#", "");
    const [red, green, blue] = [0, 2, 4].map(index => parseInt(value.slice(index, index + 2), 16));
    return (.299 * red + .587 * green + .114 * blue) > 150 ? "#17231D" : "#FFFFFF";
  };
  const renderThemePreview = (prefix, primary, accent) => {
    const preview = $(`#${prefix}ThemePreview`);
    if (!preview) return;
    const header = preview.querySelector(".theme-preview-header");
    const button = preview.querySelector(".theme-preview-body b");
    if (header) { header.style.background = primary; header.style.color = themeText(primary); }
    if (button) { button.style.background = accent; button.style.color = themeText(accent); }
  };
  const connectThemePreview = prefix => {
    const primary = $(`#${prefix}ThemePrimary`), accent = $(`#${prefix}ThemeAccent`);
    if (!primary || !accent) return;
    const paint = () => renderThemePreview(prefix, primary.value, accent.value);
    primary.addEventListener("input", paint);
    accent.addEventListener("input", paint);
    paint();
  };
  connectThemePreview("signup");
  connectThemePreview("account");

  const loadSignupNames = async () => {
    if (!signupNameSelect) return;
    let data,error;
    try{({data,error}=await bounded(client.functions.invoke("legacy-2026-stats",{body:{action:"roster"}})));}catch(e){error=e;}
    if(signupNameSelect.value)return;
    const names=!error&&Array.isArray(data?.players)?data.players:[];
    signupNameSelect.innerHTML='<option value="">Select your name…</option>'+names.map(name=>`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')+'<option value="__new__">My name isn’t listed / I’m a new member</option>';
    if(error)message('#signupStatus','Choose “My name isn’t listed” to type your name.');
  };
  signupNameSelect?.addEventListener("change", () => {
    const isNew = signupNameSelect.value === "__new__";
    signupNewNameWrap?.classList.toggle("hidden", !isNew);
    if (signupNewName) signupNewName.required = isNew;
    if (isNew) signupNewName?.focus();
  });
  loadSignupNames();

  document.querySelectorAll("[data-password-toggle]").forEach(button => {
    button.addEventListener("click", () => {
      const ids = String(button.dataset.passwordToggle || "").split(",").map(value => value.trim()).filter(Boolean);
      const fields = ids.map(id => document.getElementById(id)).filter(Boolean);
      const show = fields.some(field => field.type === "password");
      fields.forEach(field => { field.type = show ? "text" : "password"; });
      button.textContent = show ? "Hide password" : "Show password";
      button.setAttribute("aria-pressed", String(show));
    });
  });

  signupForm?.addEventListener("submit", async event => {
    event.preventDefault();
    const button = signupForm.querySelector("button[type=submit]");
    const selectedName = signupNameSelect?.value || "";
    const fullName = selectedName === "__new__" ? signupNewName?.value.trim() : selectedName.trim();
    const email = $("#signupEmail").value.trim().toLowerCase();
    const phone = $("#signupPhone").value.trim();
    const playingCategory = $("#signupPlayingCategory").value;
    const password = $("#signupPassword").value;
    const confirmation = $("#signupPasswordConfirm").value;
    const themePrimary = $("#signupThemePrimary")?.value || "#315C4A";
    const themeAccent = $("#signupThemeAccent")?.value || "#C7A96B";

    if (!fullName) {
      message("#signupStatus", "Please select your name, or choose the new member option.", true);
      return;
    }
    if (!["men", "women"].includes(playingCategory)) {
      message("#signupStatus", "Choose Men’s or Women’s playing category.", true);
      return;
    }
    if (password !== confirmation) {
      message("#signupStatus", "Those passwords do not match. Please try again.", true);
      return;
    }

    button.disabled = true;
    button.textContent = "Creating account…";
    message("#signupStatus", "");

    try{
      const {data,error}=await bounded(client.auth.signUp({email,password,options:{data:{full_name:fullName,phone,playing_category:playingCategory,theme_primary:themePrimary,theme_accent:themeAccent}}}));
      if(error)throw error;
      try{localStorage.setItem('barford-login-email',email);}catch{}
      if(data.session){window.location.href=returnTo();return;}
      message('#signupStatus','Check your email to finish creating your account, then sign in.');
      button.textContent='Account created — check your email';
      const link=document.createElement('a');link.href=window.BarfordMemberFlow.loginUrl(returnTo());link.className='button button-outline';link.textContent='Go to sign in';signupForm.append(link);
    }catch(error){message('#signupStatus',error.message||'Could not connect. Please try again.',true);button.disabled=false;button.textContent='Create my account';}

  });

  const loginForm = $("#accountLoginForm");
  const passwordLoginButton = $("#accountPasswordLoginButton");
  const resetLoginButton = () => {
    if (passwordLoginButton) passwordLoginButton.textContent = "Sign in";
  };

  loginForm?.addEventListener("submit", async event => {
    event.preventDefault();
    const button = loginForm.querySelector("button[type=submit]");
    button.disabled = true;
    button.textContent = "Signing in…";

    let result;
    try {
      result = await bounded(client.auth.signInWithPassword({
        email: $("#accountLoginEmail").value.trim().toLowerCase(),
        password: $("#accountLoginPassword").value
      }));
    } catch {
      message("#accountLoginStatus", "Sign-in could not connect. Please try again.", true);
      button.disabled = false;
      resetLoginButton();
      return;
    }
    const { error } = result;
    if (accountSession?.signingOut) return;

    if (error) {
      message("#accountLoginStatus", "Email or password not recognised.", true);
      button.disabled = false;
      resetLoginButton();
      return;
    }
    try{sessionStorage.removeItem("barford-first-login");}catch{}
    window.location.href = returnTo();
  });

  $("#accountPasskeyLogin")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    if (!window.BarfordPasskeys?.supported) {
      message("#accountLoginStatus", "This browser does not support device sign-in. Please use email and password.", true);
      return;
    }
    button.disabled = true;
    button.textContent = "Waiting for your device…";
    try {
      await window.BarfordPasskeys.login();
      window.location.href = returnTo();
    } catch (error) {
      message("#accountLoginStatus", error.name === "NotAllowedError" ? "Device sign-in was cancelled." : error.message, true);
      button.disabled = false;
      button.innerHTML = '<span aria-hidden="true">⌁</span> Use device sign-in';
    }
  });

  const loadMemberScores = async memberId => {
    const list = $("#accountRoundList");
    if (!list) return;
    const { data, error } = await client
      .from("scores")
      .select("points,handicap_used,next_handicap,dnp,winner,runner_up,third_place,nearest_pin,longest_drive,rounds(round_number,name,played_on,events(name,venue,event_date))")
      .eq("member_id", memberId);

    if (error) {
      message("#accountScoresStatus", "Your scores could not be loaded. Please refresh the page.", true);
      return;
    }

    const scores = (data || []).sort((a, b) =>
      Number(a.rounds?.round_number || 0) - Number(b.rounds?.round_number || 0));
    const played = scores.filter(score => !score.dnp && Number.isFinite(Number(score.points)));
    const best = played.length ? Math.max(...played.map(score => Number(score.points))) : null;
    const average = played.length
      ? (played.reduce((total, score) => total + Number(score.points), 0) / played.length).toFixed(1)
      : null;
    const latestHandicap = [...scores].reverse().find(score => score.next_handicap != null)?.next_handicap;

    $("#accountRoundsPlayed").textContent = String(played.length);
    $("#accountAveragePoints").textContent = average ?? "N/A";
    $("#accountBestPoints").textContent = best ?? "N/A";
    $("#accountCurrentHandicap").textContent = latestHandicap ?? ($("#accountHandicap")?.value || "N/A");

    if (!scores.length) {
      list.innerHTML = '<p class="account-round-empty">Your round-by-round scores will appear here when results are published.</p>';
      return;
    }

    list.innerHTML = scores.map(score => {
      const round = score.rounds || {};
      const event = round.events || {};
      const honours = [
        score.winner ? "Winner" : "",
        score.runner_up ? "Runner-up" : "",
        score.third_place ? "Third" : "",
        score.nearest_pin ? "Nearest pin" : "",
        score.longest_drive ? "Longest drive" : ""
      ].filter(Boolean);
      return `<article class="account-round-row">
        <div class="account-round-number">R${escapeHtml(round.round_number || "—")}</div>
        <div class="account-round-course">
          <strong>${escapeHtml(event.name || round.name || "Society round")}</strong>
          <small>${escapeHtml(friendlyDate(event.event_date || round.played_on))}${event.venue ? ` · ${escapeHtml(event.venue)}` : ""}</small>
          ${honours.length ? `<span class="account-round-honours">${honours.map(item => `<b>${escapeHtml(item)}</b>`).join("")}</span>` : ""}
        </div>
        <div class="account-round-score">
          <strong>${score.dnp ? "DNP" : score.points ?? "—"}</strong>
          <span>${score.dnp ? "Did not play" : "Points"}</span>
        </div>
        <div class="account-round-handicap">
          <strong>${score.handicap_used ?? "—"}</strong>
          <span>Handicap</span>
        </div>
      </article>`;
    }).join("");
  };

  let initialAccountLoad=true;
  const loadAccount = async () => {
    const useInitial=initialAccountLoad;initialAccountLoad=false;
    const signedOut = $("#accountSignedOut");
    const content = $("#accountContent");
    if (!signedOut || !content) return;

    accountSession?.loading();
    let session;
    try {
      const result = await bounded(useInitial && window.BarfordInitialSession ? window.BarfordInitialSession : client.auth.getSession());
      if (result.error) throw result.error;
      session = result.data.session;
    } catch {
      accountSession?.showProblem();
      return;
    }
    if (accountSession?.signingOut) return;
    signedOut.classList.toggle("hidden", Boolean(session));
    if (!session) {
      content.classList.add("hidden");
      accountSession?.ready();
      document.body.classList.remove("is-admin");
      $("#accountHeroName").textContent = "Member account";
      const firstLogin = sessionStorage.getItem("barford-first-login") === "1" ||
        new URLSearchParams(window.location.search).get("account") === "created";
      const showFaceId = Boolean(window.BarfordPasskeys?.supported);
      $("#accountPasskeyLogin")?.classList.toggle("hidden", !showFaceId);
      $("#accountLoginDivider")?.classList.toggle("hidden", !showFaceId);
      const savedEmail = localStorage.getItem("barford-login-email");
      if (savedEmail && $("#accountLoginEmail")) $("#accountLoginEmail").value = savedEmail;
      if (firstLogin) {
        $("#accountLoginHeading").textContent = "Account created — sign in";
        $("#accountLoginIntro").textContent = isIPhone
          ? "Enter your email and password once. Your iPhone will then ask whether to set up Face ID for future logins."
          : "Enter your email and password to open your account.";
        $("#accountLoginPassword")?.focus();
      }
      return;
    }

    let profile;
    try {
      const shared=useInitial && window.BarfordMemberContext ? await bounded(window.BarfordMemberContext) : null;
      const result=shared ? {data:shared.session?.user.id===session.user.id ? shared.profile : null} : await bounded(client.from("profiles").select("*").eq("id",session.user.id).single());
      if (result.error || !result.data) throw result.error || new Error("Profile unavailable");
      profile = result.data;
    } catch {
      accountSession?.showProblem("We could not load your account details. Try again, or sign out and sign back in.");
      return;
    }
    if (accountSession?.signingOut) return;

    $("#accountHeroName").textContent = profile.full_name;
    $("#accountMemberNumber").textContent = `Member ${profile.id.slice(0, 8).toUpperCase()}`;
    $("#accountName").value = profile.full_name || "";
    $("#accountEmail").value = profile.email || session.user.email || "";
    $("#accountPhone").value = profile.phone || "";
    $("#accountHomeClub").value = profile.home_club || "";
    $("#accountHandicap").value = profile.handicap ?? "";
    $("#accountHandicap").readOnly=true;
    $("#accountHandicap").required=false;
    $("#accountHandicap").placeholder='Awaiting admin';
    $("#accountHandicap").setAttribute('aria-readonly','true');
    $("#accountHandicap").parentElement.querySelector('small').textContent=profile.handicap==null?'Awaiting admin. The committee will set your society handicap. You can still RSVP for events.':'The committee manages your society handicap. It updates after completed rounds.';
    $("#accountPlayingCategory").value = profile.playing_category || "";
    if ($("#accountThemePrimary")) $("#accountThemePrimary").value = profile.theme_primary || "#315C4A";
    if ($("#accountThemeAccent")) $("#accountThemeAccent").value = profile.theme_accent || "#C7A96B";
    renderThemePreview("account", profile.theme_primary || "#315C4A", profile.theme_accent || "#C7A96B");
    content.classList.remove("hidden");
    if(location.hash==="#profile-photo")$("#profile-photo details")?.setAttribute("open","");
    accountSession?.ready();
    document.body.classList.toggle("is-admin", Boolean(profile.is_admin));
    $("#removeAccountPhoto")?.classList.toggle("hidden", !profile.photo_url);
    $("#accountPhotoInput").dataset.currentPath = profile.photo_url || "";
    // Optional photos and scores must never hold the account form or sign-out.
    await Promise.allSettled([
      renderProfilePhoto($("#accountHeroAvatar"), profile),
      renderProfilePhoto($("#accountPhotoPreview"), profile),
      loadMemberScores(session.user.id)
    ]);
  };

  $("#accountPhotoInput")?.addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      message("#accountPhotoStatus", "Please choose a JPG, PNG or WebP image.", true);
      event.target.value = "";
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      message("#accountPhotoStatus", "That photo is larger than 5 MB. Please choose a smaller one.", true);
      event.target.value = "";
      return;
    }
    const { data: { user } } = await client.auth.getUser();
    if (!user) return;
    message("#accountPhotoStatus", "Uploading your photo…");
    const extension = file.type.split("/")[1] === "jpeg" ? "jpg" : file.type.split("/")[1];
    const path = `${user.id}/profile-${Date.now()}.${extension}`;
    const oldPath = event.target.dataset.currentPath;
    const { error: uploadError } = await client.storage.from("profile-images").upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type
    });
    if (uploadError) {
      message("#accountPhotoStatus", uploadError.message, true);
      return;
    }
    const { error: profileError } = await client.from("profiles")
      .update({ photo_url: path, updated_at: new Date().toISOString() })
      .eq("id", user.id);
    if (profileError) {
      await client.storage.from("profile-images").remove([path]);
      message("#accountPhotoStatus", profileError.message, true);
      return;
    }
    if (oldPath) await client.storage.from("profile-images").remove([oldPath]);
    const profile = { full_name: $("#accountName").value, photo_url: path };
    await Promise.all([
      renderProfilePhoto($("#accountHeroAvatar"), profile),
      renderProfilePhoto($("#accountPhotoPreview"), profile)
    ]);
    event.target.dataset.currentPath = path;
    $("#removeAccountPhoto")?.classList.remove("hidden");
    message("#accountPhotoStatus", "Profile photo saved.");
  });

  $("#removeAccountPhoto")?.addEventListener("click", async event => {
    const input = $("#accountPhotoInput");
    const path = input?.dataset.currentPath;
    const { data: { user } } = await client.auth.getUser();
    if (!user || !path) return;
    if (!confirm("Remove your profile photo?\n\nYou can add another photo at any time.")) return;
    event.currentTarget.disabled = true;
    const { error } = await client.from("profiles")
      .update({ photo_url: null, updated_at: new Date().toISOString() })
      .eq("id", user.id);
    if (error) {
      message("#accountPhotoStatus", error.message, true);
      event.currentTarget.disabled = false;
      return;
    }
    await client.storage.from("profile-images").remove([path]);
    const profile = { full_name: $("#accountName").value };
    photoRequests.delete(path);
    renderProfilePhoto($("#accountHeroAvatar"), profile);
    renderProfilePhoto($("#accountPhotoPreview"), profile);
    input.dataset.currentPath = "";
    event.currentTarget.classList.add("hidden");
    event.currentTarget.disabled = false;
    message("#accountPhotoStatus", "Profile photo removed.");
  });

  $("#accountProfileForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const button=event.currentTarget.querySelector("button[type=submit]");button.disabled=true;button.textContent="Saving…";
    try{
    const { user }=await window.BarfordMemberFlow.request(client.auth.getUser());
    if(!user)throw Error("Please sign in again to save your details.");
    const changes = {
      full_name: $("#accountName").value.trim(),
      phone: $("#accountPhone").value.trim() || null,
      home_club: $("#accountHomeClub").value.trim() || null,
      playing_category: $("#accountPlayingCategory").value,
      theme_primary: $("#accountThemePrimary")?.value || "#315C4A",
      theme_accent: $("#accountThemeAccent")?.value || "#C7A96B",
      updated_at: new Date().toISOString()
    };
    const saved=await window.BarfordMemberFlow.request(client.from("profiles").update(changes).eq("id",user.id).select("id").single());
    if(!saved?.id)throw Error("Your details could not be confirmed. Please try again.");
    $("#accountHeroName").textContent = changes.full_name;
    if(!$("#accountHeroAvatar").classList.contains("has-photo"))setAvatar($("#accountHeroAvatar"), changes);
    window.BarfordPersonalTheme?.apply(changes.theme_primary, changes.theme_accent, `barford-personal-theme-${user.id}`);
    message("#accountSaveStatus", "Your changes have been saved.");
    }catch(error){message("#accountSaveStatus",error.message||"Could not save. Please try again.",true);}
    finally{button.disabled=false;button.textContent="Save my details";}
  });

  $('#setupDeviceSignIn')?.addEventListener('click',async event=>{
    const button=event.currentTarget;button.disabled=true;
    try{if(!window.BarfordPasskeys?.supported)throw Error('This browser does not support device sign-in. You can keep using your password.');await window.BarfordPasskeys.register();try{localStorage.setItem('barford-passkey-offered','complete');}catch{}message('#deviceSignInStatus','Device sign-in is ready. You can still use your password.');}
    catch(error){message('#deviceSignInStatus',error.name==='NotAllowedError'?'Setup cancelled. You can try again whenever you like.':error.message,true);}
    finally{button.disabled=false;}
  });
  // account-session.js owns sign-out independently of profile loading and the SDK.
  loadAccount().catch(() => accountSession?.showProblem());
})();
