/* Most HTML and mutable assets reach the network first. Scoring opens the saved
   shell immediately; each release installs its matching hashed assets. Offline scoring data is
   stored by the scoring app, not here: never clear localStorage or IndexedDB. */
const CACHE='barford-golf-2027-offline-v80-59a78e997965';
const PREFIX='barford-golf-2027-offline-';
const POLICY='network-first-v1';
const SCOPE=new URL('./',self.location.href);
const PAGES=new Set(["404.html","about.html","account.html","admin.html","designs.html","event.html","events.html","gallery.html","halfway-preview.html","hole-view.html","index.html","payments.html","scores.html","scoring-preview.html","scoring.html","shop.html","signup.html","tee-sheet.html","update.html","worldevents.html"]);
const CORE=["index.html","scoring.html","hole-view.html","assets/dist/styles.25b6981ca7d7.css","assets/dist/member-ui.b76801f91af7.css","assets/dist/offline-register.47b92b606ceb.js","assets/dist/site-navigation.cab36c48d3e2.js","assets/dist/app.7a45507511f3.js","assets/dist/supabase-2.116.0.5d9469dec2ac.js","assets/dist/supabase-config.6f1d58a2a0b2.js","assets/dist/supabase-client.bd4aa0131b3e.js","assets/dist/member-workflow.5811dbc0b6a4.js","assets/dist/member-event-view.4ffa8517c76f.js","assets/dist/dashboard-results.0e0c875b0f5e.js","assets/dist/member-dashboard.e6405119f981.js","assets/dist/member-season.8732c42a394f.js","assets/dist/member-guest-gateway.784feb950d4e.js","assets/dist/design-preview.d95251faced6.js","assets/dist/event-day-camera.5044111f5a83.js","assets/dist/scoring-bundle.9115e3547938.css","assets/dist/member-ui.9845d2d8bc32.css","assets/dist/score-model.d5a4f3094f8b.js","assets/dist/scoring-resilience.e08f9a3375c1.js","assets/dist/scoring.a0de25b6f048.js","assets/dist/score-layout.5dffc215400f.js","assets/dist/deep-teal-theme-bundle.adfc76104919.css","assets/dist/personal-theme.a32de06727cf.css","assets/dist/clubhouse-course.153cb4a54a66.css","assets/dist/fairway.6247a9edb681.css","assets/dist/offline-course-view.55f0ae14eddb.js","assets/dist/maps-loader.0cfb130c3915.js","assets/dist/course-view.bc943b2fbea1.js","assets/dist/dashboard-weather.6319ac3159cb.js","assets/dist/personal-theme.276dd9fa3719.js","assets/dist/design-links.2c9376402dbf.css","assets/dist/design-tour.8e16b9523fab.css","assets/dist/design-matchbook.50583303038a.css","assets/dist/design-drive.ec9be01a863f.css","assets/dist/design-round.88da820bffa5.css","assets/dist/design-round.d88cf490c58b.js","assets/dist/design-drive.1bf00145f11b.js","assets/dist/design-drive-two.1f3eea188894.css","assets/dist/design-drive-two.e4294a27a9ae.js","assets/dist/design-matchbook.f931eb5cf3f3.js","manifest.webmanifest","assets/images/barford-golf-society-logo-320.webp","assets/images/barford-golf-society-logo.png"];
const absolute=path=>new URL(path,SCOPE).href;
const pageKey=url=>absolute(url.pathname.slice(SCOPE.pathname.length)||'index.html');
const immutable=path=>/^assets\/dist\/[\w.-]+\.[a-f0-9]{12}\.(?:css|js)$/.test(path);
async function cached(key){
  const current=await caches.open(CACHE),hit=await current.match(key);
  if(hit)return hit;
  for(const name of (await caches.keys()).filter(n=>n.startsWith(PREFIX)&&n!==CACHE).reverse()){
    const hit=await (await caches.open(name)).match(key);if(hit)return hit;
  }
}
async function store(key,response){
  if(response.ok&&response.type!=='opaque'&&!response.redirected){
    try{await (await caches.open(CACHE)).put(key,response.clone());}catch{}
  }
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);let cursor=0;
  const jobs=await Promise.allSettled(Array.from({length:3},async()=>{
    while(cursor<CORE.length){const url=absolute(CORE[cursor++]);
      const response=await fetch(url,{cache:'no-store'});
      if(!response.ok||response.type==='opaque')throw Error('Offline asset unavailable');
      await cache.put(url,response);
    }
  }));
  const failed=jobs.find(job=>job.status==='rejected');
  if(failed){await caches.delete(CACHE);throw failed.reason;}
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const old=(await caches.keys()).filter(name=>name.startsWith(PREFIX)&&name!==CACHE)
    .sort((a,b)=>(parseInt(b.split('-v').pop(),10)||0)-(parseInt(a.split('-v').pop(),10)||0));
  // Preserve one previous release's hashed dependencies for already-open pages.
  await Promise.all(old.slice(1).map(name=>caches.delete(name)));
  await self.clients.claim();
})()));
self.addEventListener('message',event=>{
  if(event.data?.type==='BARFORD_VERSION')event.ports[0]?.postMessage({version:CACHE,policy:POLICY});
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==SCOPE.origin||!url.pathname.startsWith(SCOPE.pathname))return;
  const path=url.pathname.slice(SCOPE.pathname.length);
  if(path==='update.html')return;
  const page=path===''||PAGES.has(path);
  const asset=/^assets\/(?:dist|images|js|css)\//.test(path)||path==='manifest.webmanifest';
  // Never intercept auth, API, database, external storage or recovery-page traffic.
  if(!page&&!asset)return;
  event.respondWith((async()=>{
    const key=page?pageKey(url):url.href;
    // Only content-addressed bundles are cache-first. Never fall back to a
    // versionless URL for a versioned script or stylesheet.
    if(path==='scoring.html'){const hit=await (await caches.open(CACHE)).match(key);if(hit)return hit;}
    if(immutable(path)){const hit=await cached(key);if(hit)return hit;}
    try{
      const response=await fetch(request,{cache:immutable(path)?'default':'no-store'});
      if(response.status>=500){const fallback=await cached(key);if(fallback)return fallback;}
      await store(key,response);return response;
    }catch{
      const fallback=await cached(key);if(fallback)return fallback;
      // Do not substitute the homepage for a missing scorecard/account document.
      return page?new Response('<!doctype html><meta name="viewport" content="width=device-width"><title>Offline | Barford</title><h1>You are offline</h1><p>This page has not been saved on this device. Reconnect and try again. Your saved scores have not been removed.</p>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8'}}):Response.error();
    }
  })());
});
