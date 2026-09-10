const CACHE='barford-golf-2027-offline-v79-presentation-rehearsal-fixes';
const PREFIX='barford-golf-2027-offline-';
const SCOPE=new URL('./',self.location.href);
const PAGES=new Set(["404.html","about.html","account.html","admin.html","event.html","events.html","gallery.html","hole-view.html","index.html","payments.html","scores.html","scoring.html","shop.html","signup.html","worldevents.html"]);
const CORE=["index.html","scoring.html","hole-view.html","assets/dist/styles.25b6981ca7d7.css","assets/dist/members.b528a5339545.css","assets/dist/member-ui.49d5a6a1e11e.css","assets/dist/app.4d1a78f9d9e6.js","assets/dist/supabase-2.116.0.5d9469dec2ac.js","assets/dist/supabase-config.6f1d58a2a0b2.js","assets/dist/supabase-client.fedbdb18f939.js","assets/dist/member-workflow.3bd4b64f82f8.js","assets/dist/member-event-view.c059a772e85b.js","assets/dist/member-dashboard.2ac1496ca9a2.js","assets/dist/member-season.8732c42a394f.js","assets/dist/accessible-mobile.dea27d303f10.js","assets/dist/scoring-bundle.9115e3547938.css","assets/dist/member-ui.b7cb476775f9.css","assets/dist/offline-register.effae5eac4ef.js","assets/dist/score-model.d5a4f3094f8b.js","assets/dist/scoring-resilience.762a870a61b7.js","assets/dist/scoring.f9ff656c5f26.js","assets/dist/deep-teal-theme-bundle.adfc76104919.css","assets/dist/personal-theme.a32de06727cf.css","assets/dist/clubhouse-course.153cb4a54a66.css","assets/dist/offline-course-view.41bd60256c8d.js","assets/dist/course-view.a93de75df2d4.js","assets/dist/dashboard-weather.6319ac3159cb.js","assets/dist/event-day-camera.cac06aa35a7a.js","assets/dist/personal-theme.276dd9fa3719.js","manifest.webmanifest","assets/images/barford-golf-society-logo-320.webp"];
const absolute=path=>new URL(path,SCOPE).href;
const keyFor=url=>{
 const path=url.pathname.slice(SCOPE.pathname.length);
 if(path===''||PAGES.has(path))return absolute(path||'index.html');
 return url.href;
};
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);let cursor=0;
 // Bounded concurrency avoids competing with the first member-data requests.
 // Reject the install if any critical dependency fails; the old worker remains usable.
 const installed=await Promise.allSettled(Array.from({length:3},async()=>{
  while(cursor<CORE.length){const url=absolute(CORE[cursor++]);const response=await fetch(url,{cache:'reload'});if(!response.ok||response.type==='opaque')throw Error('Offline asset unavailable');await cache.put(url,response);}
 }));
 const failure=installed.find(result=>result.status==='rejected');if(failure){await caches.delete(CACHE);throw failure.reason;}
 await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 const keys=(await caches.keys()).filter(key=>key.startsWith(PREFIX)&&key!==CACHE).reverse().sort((a,b)=>parseInt(b.split('-v').pop(),10)-parseInt(a.split('-v').pop(),10));
 // Keep one previous release for an already-open page's deferred, hashed dependencies.
 await Promise.all(keys.slice(1).map(key=>caches.delete(key)));
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==SCOPE.origin||!url.pathname.startsWith(SCOPE.pathname))return;
 const relative=url.pathname.slice(SCOPE.pathname.length);
 const page=relative===''||PAGES.has(relative);
 const asset=/^assets\/(?:dist|images|js|css)\//.test(relative)||relative==='manifest.webmanifest';
 if(!page&&!asset)return; // Auth, database, storage and Maps never use the shell cache.
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE),key=keyFor(url),saved=await cache.match(key);
  if(saved)return saved;
  if(asset){
   for(const name of await caches.keys())if(name.startsWith(PREFIX)&&name!==CACHE){const previousCache=await caches.open(name);const previous=await previousCache.match(key)||(/^assets\/(?:js|css)\//.test(relative)?await previousCache.match(new URL(url.pathname,SCOPE).href):null);if(previous)return previous;}
  }
  try{
   const response=await fetch(request);
   if(response.ok&&response.type!=='opaque')try{await cache.put(key,response.clone());}catch{}
   return response;
  }catch{
   for(const name of await caches.keys())if(name.startsWith(PREFIX)&&name!==CACHE){const previousCache=await caches.open(name);const previous=await previousCache.match(key)||(/^assets\/(?:js|css)\//.test(relative)?await previousCache.match(new URL(url.pathname,SCOPE).href):null);if(previous)return previous;}
   return page?await cache.match(absolute('index.html'))||Response.error():Response.error();
  }
 })());
});
