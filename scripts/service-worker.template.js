const CACHE='barford-golf-2027-offline-v__RELEASE__';
const PREFIX='barford-golf-2027-offline-';
const SCOPE=new URL('./',self.location.href);
const PAGES=new Set(__PAGES__);
const CORE=__CORE__;
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
