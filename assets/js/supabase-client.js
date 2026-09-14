(() => {
  "use strict";

  const config = window.BARFORD_2027_CONFIG;
  if (!config || !window.supabase?.createClient) {
    console.error("The 2027 Supabase connection could not be loaded.");
    window.BarfordAccountSession?.showProblem("The account connection is unavailable. Try again, or sign out to reset your saved sign-in.");
    return;
  }

  const storageKey = `sb-${new URL(config.supabaseUrl).hostname.split(".")[0]}-auth-token`;
  try {
    if (localStorage.getItem(`${storageKey}-reset-pending`)) {
      [storageKey, `${storageKey}-code-verifier`, `${storageKey}-user`].forEach(key => localStorage.removeItem(key));
      localStorage.removeItem(`${storageKey}-reset-pending`);
    }
  } catch {}

  // Bound auth network requests after an outage; retain the SDK's normal locking.
  const authFetch = async (input, options = {}) => {
    const url = typeof input === "string" ? input : input.url;
    if (!url.startsWith(`${config.supabaseUrl}/auth/v1/`)) return fetch(input, options);
    const controller = new AbortController();
    const previousSignal = options.signal || (typeof input === "object" ? input.signal : null);
    const abort = () => controller.abort();
    if (previousSignal?.aborted) abort();
    else previousSignal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, 10000);
    try { return await fetch(input, { ...options, signal: controller.signal }); }
    finally {
      clearTimeout(timer);
      previousSignal?.removeEventListener("abort", abort);
    }
  };

  window.BarfordSupabase = window.supabase.createClient(
    config.supabaseUrl,
    config.supabasePublishableKey,
    {
      global: { fetch: authFetch },
      auth: {
        storageKey,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );

  if (!document.querySelector('link[data-personal-theme],link[href*="personal-theme.css"]')) {
    const personalThemeStyle = document.createElement("link");
    personalThemeStyle.rel = "stylesheet";
    personalThemeStyle.href = "assets/css/personal-theme.css?v=clubhouse76";
    document.head.appendChild(personalThemeStyle);
  }
  window.BarfordInitialSession = window.BarfordSupabase.auth.getSession();
  let contextRevision = 0;
  const publishContext = context => {
    document.body.classList.toggle('is-admin',Boolean(context.session && context.profile?.is_admin === true));
    window.dispatchEvent(new CustomEvent('barford-member-context',{detail:context}));
    return context;
  };
  const loadContext = async session => {
    const revision = ++contextRevision;
    publishContext({session:null,profile:null});
    try {
      try{if(session)localStorage.setItem('barford-score-active-member',session.user.id);else localStorage.removeItem('barford-score-active-member');}catch{}
      if (!session) return {session:null,profile:null};
      const {data:profile,error}=await window.BarfordSupabase.from('profiles')
        .select(document.getElementById('accountContent')?'*':'id,full_name,is_admin,photo_url,theme_primary,theme_accent').eq('id',session.user.id).maybeSingle();
      if(error)throw error;
      const context={session,profile};
      if(revision===contextRevision)publishContext(context);
      return context;
    } catch(error) { if(revision===contextRevision)publishContext({session:null,profile:null}); throw error; }
  };
  window.BarfordMemberContext = window.BarfordInitialSession.then(result=>{
    if(result.error)throw result.error;
    return loadContext(result.data.session);
  });
  window.BarfordSupabase.auth.onAuthStateChange((event,session)=>{
    if(event==='INITIAL_SESSION')return;
    // Hide privileged navigation immediately; fetch outside the auth callback lock.
    ++contextRevision;
    publishContext({session:null,profile:null});
    setTimeout(()=>{window.BarfordMemberContext=loadContext(session);window.BarfordMemberContext.catch(()=>{});},0);
  });
  const personalThemeScript = document.createElement("script");
  personalThemeScript.src = "assets/js/personal-theme.js?v=clubhouse76";
  document.body.appendChild(personalThemeScript);

  if(document.body.classList.contains("gps-page"))window.BarfordMemberContext.then(context=>{
    if(!context.profile?.is_admin)return;
    const setup=document.createElement("script");setup.src="assets/js/course-view-guided-setup.js?v=78";document.body.appendChild(setup);
  }).catch(()=>{});

  // Keep the shared assignment/tee guard, which is not declared in page HTML.
  if (document.body.classList.contains("admin-page")) {
    const workflow = document.createElement("script");
    workflow.src = "assets/js/scorecard-workflow-fix.js?v=speed20";
    workflow.async = true;
    document.body.appendChild(workflow);
  }

  // Dashboard scripts are declared in index.html. Injecting them here as well
  // duplicated downloads, observers and Supabase queries on the busiest page.

  // Normal members never see Admin in navigation. Existing authorised admins
  // get the link back automatically after their signed-in profile is checked.
  window.BarfordMemberContext.catch(() => {});
})();
