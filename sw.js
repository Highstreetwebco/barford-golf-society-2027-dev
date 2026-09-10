const CACHE="barford-golf-2027-offline-v75";
const ESSENTIALS=["./","./index.html","./scoring.html","./hole-view.html","./manifest.webmanifest","./assets/images/barford-golf-society-logo-320.webp","./assets/js/app.js","./assets/js/offline-register.js","./assets/js/member-dashboard.js","./assets/js/personal-theme.js","./assets/js/scoring.js","./assets/js/scoring-resilience.js","./assets/js/offline-course-view.js","./assets/js/course-view.js","./assets/js/course-view-guided-setup.js","./assets/js/supabase-config.js","./assets/js/supabase-client.js","./assets/css/styles.css","./assets/css/members.css","./assets/css/deep-teal-theme.css","./assets/css/personal-theme.css","./assets/css/matchday-redesign.css","./assets/css/hole-view-light.css","./assets/css/scoring.css","./assets/css/scoring-simple.css","./assets/css/score-halfway-actions.css","./assets/css/score-competitions.css","https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2","./event.html","./events.html","./payments.html","./account.html","./signup.html","./scores.html","./gallery.html","./assets/js/member-workflow.js","./assets/js/member-event-view.js","./assets/js/event-hub.js","./assets/js/events-live.js","./assets/js/payments-hub.js","./assets/js/member-season.js","./assets/js/member-auth.js","./assets/js/account-session.js","./assets/js/score-model.js","./assets/js/passkeys.js","./assets/js/scores.js","./assets/js/scores-data.js","./assets/js/handicap-engine.js","./assets/js/gallery-live.js","./assets/js/accessible-mobile.js","./assets/js/dashboard-weather.js","./assets/js/event-day-camera.js","./assets/css/member-simple.css"];
const canonical=request=>{const url=new URL(typeof request==='string'?request:request.url,self.location.href);if(url.origin===self.location.origin)url.search='';return url.href;};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>Promise.allSettled(ESSENTIALS.map(url=>cache.add(new Request(url,{cache:'reload'}))))).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('barford-golf-2027-offline-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin&&url.hostname!=='cdn.jsdelivr.net')return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE),key=canonical(event.request),cached=await cache.match(key);
    const isPage=event.request.mode==='navigate';
    const update=()=>fetch(event.request,{cache:'no-store',...(isPage?{signal:AbortSignal.timeout(5000)}:{})}).then(fresh=>{if(fresh.ok&&fresh.type!=='opaque')event.waitUntil(cache.put(key,fresh.clone()));return fresh;});
    if(isPage){try{return await update();}catch{return cached||await cache.match(canonical('./index.html'))||Response.error();}}
    if(cached){event.waitUntil(update().catch(()=>{}));return cached;}
    try{return await update();}catch{return Response.error();}
  })());
});
