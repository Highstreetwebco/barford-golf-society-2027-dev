/* HTML prefers the network, but a saved page limits waiting to 150ms. Scoring opens the saved
   shell immediately; each release installs its matching hashed assets. Offline scoring data is
   stored by the scoring app, not here: never clear localStorage or IndexedDB. */
const CACHE='barford-golf-2027-offline-v__RELEASE__';
const PREFIX='barford-golf-2027-offline-';
const POLICY='network-first-v1';
const SCOPE=new URL('./',self.location.href);
const PAGES=new Set(__PAGES__);
const CORE=__CORE__;
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
    // Only static same-origin documents/images use the fast fallback. Member
    // records, sign-in, payments and score writes never pass through this cache.
    const saved=(page||path.startsWith('assets/images/'))?await cached(key):null;
    const network=(async()=>{
      try{
      const response=await fetch(request,{cache:immutable(path)?'default':'no-store'});
      if(response.status>=500){const fallback=await cached(key);if(fallback)return fallback;}
      await store(key,response);return response;
    }catch{
      const fallback=await cached(key);if(fallback)return fallback;
      // Do not substitute the homepage for a missing scorecard/account document.
      return page?new Response('<!doctype html><meta name="viewport" content="width=device-width"><title>Offline | Barford</title><h1>You are offline</h1><p>This page has not been saved on this device. Reconnect and try again. Your saved scores have not been removed.</p>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8'}}):Response.error();
    }
    })();
    if(!saved)return network;
    // Keep the fetch alive to replace a stale shell for the next navigation.
    event.waitUntil(network.then(()=>{},()=>{}));
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>resolve(saved),150);
      network.then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
    });
  })());
});
