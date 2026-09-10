const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..'),source=file=>fs.readFileSync(path.join(root,file),'utf8');
const cacheName=source('sw.js').match(/const CACHE='([^']+)'/)[1];
function worker({fail=false,quota=false}={}){
 const listeners={},stores=new Map(),calls=[];let skipped=false,active=0,maxActive=0,offline=false;
 const caches={async open(name){if(!stores.has(name))stores.set(name,new Map());const data=stores.get(name);return {async match(key){return data.get(String(key))?.clone();},async put(key,response){if(quota)throw Error('Quota exceeded');data.set(String(key),response.clone());}};},async keys(){return [...stores.keys()];},async delete(key){return stores.delete(key);}};
 const context={URL,Response,Promise,Set,console,caches,self:{location:{href:'https://example.com/golf/sw.js?v=78'},addEventListener:(name,fn)=>listeners[name]=fn,skipWaiting:async()=>{skipped=true;},clients:{claim:async()=>{}}},fetch:async input=>{const url=typeof input==='string'?input:input.url;calls.push(url);if(offline)throw Error('Offline');active++;maxActive=Math.max(active,maxActive);await new Promise(resolve=>setImmediate(resolve));active--;return new Response(url,{status:fail&&url.endsWith('/scoring.html')?503:200});}};
 vm.createContext(context);vm.runInContext(source('sw.js'),context);
 const dispatch=async name=>{let task;listeners[name]({waitUntil(p){task=p;}});return task;};
 const get=url=>{let task;listeners.fetch({request:{method:'GET',url},respondWith(p){task=p;}});return task;};
 return {dispatch,get,caches,stores,calls,offline:()=>offline=true,skipped:()=>skipped,maxActive:()=>maxActive};
}
test('critical offline installation completes atomically at a maximum of three downloads',async()=>{
 const w=worker();await w.dispatch('install');assert.equal(w.skipped(),true);assert.ok(w.maxActive()<=3);const broken=worker({fail:true});await assert.rejects(broken.dispatch('install'));assert.equal(broken.skipped(),false);assert.equal(broken.stores.has(cacheName),false);
});
test('saved scoring navigation preserves query-driven rounds and makes no network request',async()=>{
 const w=worker();await w.dispatch('install');const before=w.calls.length;w.offline();const result=await w.get('https://example.com/golf/scoring.html?event=one&card=two&hole=7');assert.match(await result.text(),/scoring.html$/);assert.equal(w.calls.length,before);
 const m=JSON.parse(source('assets/asset-manifest.json'));await w.get('https://example.com/golf/'+m.sdk);assert.equal(w.calls.length,before);
});
test('service worker excludes member APIs and neighbouring sites',()=>{
 const w=worker();for(const url of ['https://db.supabase.co/rest/v1/profiles','https://example.com/other-site/index.html','https://example.com/golf/private-api'])assert.equal(w.get(url),undefined);
});
test('cache quotas never discard a successfully downloaded page',async()=>{
 const w=worker({quota:true});const result=await w.get('https://example.com/golf/account.html');assert.equal(result.status,200);assert.match(await result.text(),/account.html$/);
});
test('activation retains previous release and leaves other applications untouched',async()=>{
 const w=worker();for(const name of ['barford-golf-2027-offline-v76','barford-golf-2027-offline-v77','another-site'])await w.caches.open(name);await w.dispatch('install');await w.dispatch('activate');assert.deepEqual([...w.stores.keys()].sort(),['another-site','barford-golf-2027-offline-v77',cacheName]);
 const old=await w.caches.open('barford-golf-2027-offline-v77');await old.put('https://example.com/golf/account.html',new Response('saved account'));w.offline();assert.equal(await(await w.get('https://example.com/golf/account.html?returnTo=event.html')).text(),'saved account');
});
function flow(){
 const calls=[],event={id:'event-1',tee_times_status:'draft'},session={user:{id:'member-1'}};
 const client={auth:{getSession:async()=>({data:{session}})},from(table){const call={table,filters:{}};const q={select(fields){call.fields=fields;return q;},eq(k,v){call.filters[k]=v;return q;},limit(){return q;},single(){return q;},maybeSingle(){return q;},then(resolve,reject){calls.push(call);const data=table==='events'?event:table==='rsvps'?null:[{event_scorecards:{id:'card-1',event_id:'event-1',status:'ready',scorer_id:null}}];return Promise.resolve({data}).then(resolve,reject);}};return q;},rpc(name){calls.push({rpc:name});return Promise.resolve({data:name==='get_event_rsvp_lock_status'?false:[]});}};
 const c={window:{BarfordSupabase:client},URL,Promise,Date,setTimeout,clearTimeout,location:{href:'https://example.com/golf/index.html'}};vm.createContext(c);vm.runInContext(source('assets/js/member-workflow.js'),c);return {F:c.window.BarfordMemberFlow,calls,event,session};
}
test('dashboard event reuse removes duplicate reads and skips unpublished groups',async()=>{
 const h=flow();const m=await h.F.loadEvent('event-1',{event:h.event,session:h.session,rsvp:null});assert.equal(m.bookingError,false);assert.equal(m.rsvp,null);assert.equal(m.card.id,'card-1');assert.equal(h.calls.length,3);assert.equal(h.calls.filter(c=>c.table==='event_scorecard_players').length,1);assert.equal(h.calls.some(c=>c.table==='events'||c.table==='rsvps'||c.rpc==='get_my_event_tee_group'),false);assert.equal(h.calls[2].filters['event_scorecards.event_id'],'event-1');
});
test('a fresh event read still checks the stored booking and lock',async()=>{
 const h=flow();await h.F.loadEvent('event-1');assert.ok(h.calls.some(c=>c.table==='events'));assert.ok(h.calls.some(c=>c.table==='rsvps'));assert.ok(h.calls.some(c=>c.rpc==='get_event_rsvp_lock_status'));
});
test('leaderboard returns numbers while one batched photo request is pending',async()=>{
 let resolvePhotos,reads=0,signs=0;const events=[];
 const query={select(){return this;},eq(){return this;},gte(){return this;},order(){return this;},limit(){return Promise.resolve({data:[]});}};
 const client={rpc:async()=>{reads++;return{data:{players:[{id:'one',photoUrl:'one.jpg'},{id:'two',photoUrl:'two.jpg'}],rounds:[]}};},from:()=>query,storage:{from:()=>({createSignedUrls(paths){signs++;assert.deepEqual(Array.from(paths),['one.jpg','two.jpg']);return new Promise(resolve=>resolvePhotos=resolve);}})}};
 const flow={today:()=> '2026-09-10',bounded:p=>p,request:async p=>(await p).data};
 const c={window:{BarfordSupabase:client,BarfordMemberFlow:flow,dispatchEvent:e=>events.push(e)},Date,Promise,Set,Map,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}}};vm.createContext(c);vm.runInContext(source('assets/js/scores-data.js').replaceAll('export const','const')+'\nthis.ScoresData=ScoresData;',c);
 const [a,b]=await Promise.all([c.ScoresData.getSnapshot('user-1'),c.ScoresData.getSnapshot('user-1')]);assert.equal(reads,1);assert.equal(signs,1);assert.equal(a.players.length,2);assert.equal(b.players[0].photoUrl,null);
 resolvePhotos({data:[{path:'one.jpg',signedUrl:'https://signed.example/one'}]});await new Promise(r=>setImmediate(r));assert.equal(events[0].type,'scores:photos-ready');assert.equal((await c.ScoresData.getSnapshot('user-1')).players[0].photoUrl,'https://signed.example/one');
});
test('course restore skips corrupt entries and failed refresh preserves saved holes and maps',async()=>{
 const saved={eventId:'event-1',courseId:'course-1',eventData:{latitude:52,longitude:-1},holes:[{hole_number:1,par:4}],views:[{hole_number:1,tee_lat:52,green_lat:52.01}],savedAt:100};
 const storage=new Map([['barford-course-broken:event-1','{bad'],['barford-course-course-1:event-1',JSON.stringify(saved)]]),calls=[];
 const client={from(table){const q={select(){return q;},eq(){return q;},maybeSingle(){return q;},order(){return q;},then(resolve,reject){calls.push(table);return Promise.resolve(table==='course_hole_maps'?{error:{message:'Failed to fetch'}}:{data:table==='events'?{latitude:52,longitude:-1,course_scorecard_id:'course-1'}:[{hole_number:1,par:5}]}).then(resolve,reject);}};return q;}};
 const c={window:{BarfordSupabase:client},document:{getElementById(){}},location:{search:'?event=event-1'},localStorage:{get length(){return storage.size;},key:i=>[...storage.keys()][i],getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},URLSearchParams,Map,Promise,Date,setTimeout,clearTimeout,console};vm.createContext(c);
 const code=source('assets/js/course-view.js').replace(/start\(\)\.catch\(error=>\{console\.error\(error\);window\.dispatchEvent\(new CustomEvent\("barford-map-failed"\)\);\}\);/,'window.courseTest={restore,fresh,state:()=>({courseId,holes,views:[...views.values()]})};');vm.runInContext(code,c);
 c.window.courseTest.restore();assert.equal(c.window.courseTest.state().courseId,'course-1');assert.equal(c.window.courseTest.state().views.length,1);
 await assert.rejects(c.window.courseTest.fresh());assert.equal(storage.get('barford-course-course-1:event-1'),JSON.stringify(saved));assert.equal(c.window.courseTest.state().holes[0].par,4);assert.equal(calls.filter(name=>name==='events').length,1);
});
test('every declared scoring, map and return-page asset belongs to the offline core',()=>{
 const manifest=JSON.parse(source('assets/asset-manifest.json')),core=new Set(JSON.parse(source('sw.js').match(/^const CORE=(.+);$/m)[1]));
 for(const page of ['index.html','scoring.html','hole-view.html'])for(const asset of manifest.pages[page])assert.ok(core.has(asset),`${page}: ${asset}`);
});
