// Run with: node --test tests/member-experience.test.cjs
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const source=name=>fs.readFileSync(path.join(root,'assets/js',name),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
function flow(){const context={window:{},location:{href:'https://example.com/golf/event.html',origin:'https://example.com'},URL,Date,URLSearchParams,setTimeout,clearTimeout,Promise};vm.createContext(context);vm.runInContext(source('member-workflow.js'),context);return context.window.BarfordMemberFlow;}
const F=flow();
const base=()=>({event:{id:'event-1',status:'scheduled',event_date:'2099-01-01',price:40},session:{user:{id:'member-1'}},rsvp:null,locked:false,group:[],card:null});
test('booking states distinguish unlimited capacity, reserve and locked bookings',()=>{
 const m=base();m.availability={capacity:null,available:null};assert.equal(F.nextAction(m).label,'Book my place');
 m.availability.available=0;assert.equal(F.nextAction(m).label,'Join reserve list');
 m.rsvp={status:'reserve'};assert.equal(F.nextAction(m).label,'View reserve booking');assert.equal(F.payment(m.event,m.rsvp).due,false);
 m.rsvp=null;m.locked=true;assert.equal(F.nextAction(m).kind,'contact');m.locked=null;assert.equal(F.nextAction(m).kind,'retry');
});
test('paid, waived, free and refunded bookings never ask for another payment',()=>{
 for(const payment_status of ['paid','waived','refunded'])assert.equal(F.payment(base().event,{status:'playing',payment_status}).due,false);
 assert.equal(F.payment({...base().event,price:0},{status:'playing',payment_status:'payment_due'}).due,false);
 assert.equal(F.payment({...base().event,price:null},{status:'playing'}).label,'Price to be confirmed');
});
test('finished and cancelled events cannot invite a new booking or promise upcoming tee times',()=>{
 for(const status of ['completed','cancelled']){const m=base();m.event.status=status;m.rsvp={status:'playing',payment_status:'paid'};assert.ok(!/coming|appear here|all set/i.test(F.nextAction(m).message));assert.notEqual(F.nextAction(m).kind,'book');}
 const m=base();m.event.event_date='2020-01-01';m.rsvp={status:'playing'};assert.equal(F.nextAction(m).label,'View results');
});
test('scoring has priority on event day and submission is distinct from approval',()=>{
 const m=base();m.event.event_date=F.today();m.rsvp={status:'playing',payment_status:'payment_due'};m.card={id:'card-1',status:'in_progress',scorer_id:'member-1'};
 assert.equal(F.nextAction(m).label,'Continue round');m.card.status='submitted';assert.match(F.nextAction(m).message,/Awaiting committee/);m.card.status='locked';assert.equal(F.nextAction(m).label,'View results');
});
test('sign-in returns stay inside this site',()=>{
 assert.equal(F.safeReturn('https://evil.example/account.html'),'index.html');assert.equal(F.safeReturn('/another-site/account.html'),'index.html');assert.match(F.loginUrl('event.html?event=one'),/returnTo=/);
});
function scoreMath(){const c={window:{},Date};vm.createContext(c);vm.runInContext(source('score-model.js'),c);return c.window.BarfordScoreModel;}
const M=scoreMath();
test('acknowledging an older save preserves a newer edit',()=>{
 const dirty={'p:1':'2026-09-10T11:02:00Z','p:2':'2026-09-10T11:01:00Z'};
 const result=M.acknowledge(dirty,{'p:1':'2026-09-10T11:01:00Z','p:2':'2026-09-10T11:01:00Z'});
 assert.deepEqual(clone(result),{'p:1':'2026-09-10T11:02:00Z'});
});
test('server refresh retains unsent corrections and explicitly cleared cells',()=>{
 const remote=[{scorecard_player_id:'p',hole_number:1,strokes:5,client_changed_at:'2026-09-10T10:00:00Z'},{scorecard_player_id:'p',hole_number:2,strokes:5}];
 const local={'p:1':{scorecard_player_id:'p',hole_number:1,strokes:4,changed_at:'2026-09-10T10:01:00Z'}};
 const scores=M.merge(remote,local,{'p:1':local['p:1'].changed_at},['p:2']);assert.equal(scores['p:1'].strokes,4);assert.equal(scores['p:2'],undefined);
});
test('submission requires 18 valid holes for every player; picked-up holes count as complete',()=>{
 const players=[{id:'p'}],holes=Array.from({length:18},(_,i)=>({hole_number:i+1})),scores=Object.fromEntries(holes.map(h=>['p:'+h.hole_number,{strokes:4}]));
 assert.equal(M.complete(players,holes,scores),true);scores['p:18']={strokes:21};assert.equal(M.complete(players,holes,scores),false);scores['p:18']={strokes:null,picked_up:true};assert.equal(M.complete(players,holes,scores),true);delete scores['p:1'];assert.equal(M.complete(players,holes,scores),false);
});
class Element{
 constructor(attrs={},document){this.document=document;this.attrs=attrs;this.dataset={};for(const [k,v]of Object.entries(attrs))if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=v;this.id=attrs.id;this.disabled='disabled'in attrs;this.hidden='hidden'in attrs;this.textContent='';this.children=[];this.listeners={};this.style={};this.isConnected=true;const classes=new Set((attrs.class||'').split(' '));this.classList={add:(...v)=>v.forEach(x=>classes.add(x)),remove:(...v)=>v.forEach(x=>classes.delete(x)),contains:v=>classes.has(v),toggle:(v,on)=>{on=on===undefined?!classes.has(v):on;on?classes.add(v):classes.delete(v);return on;}};if(this.id)document.ids.set(this.id,this);}
 set innerHTML(html){this.html=html;this.children=this.document.parse(html);}
 get innerHTML(){return this.html||'';}
 querySelectorAll(selector){return this.children.filter(e=>this.document.matches(e,selector));}
 querySelector(s){return this.querySelectorAll(s)[0]||null;}
 addEventListener(type,fn){this.listeners[type]=fn;}
 setAttribute(k,v){this.attrs[k]=v;}
 removeAttribute(k){delete this.attrs[k];}
 async click(){if(this.disabled)return;return (this.onclick||this.listeners.click)?.({currentTarget:this,target:this,preventDefault(){}});}
 close(){this.closed=true;}
}
function documentStub(){
 const d={ids:new Map(),all:[],visibilityState:'visible',listeners:{},addEventListener(t,fn){this.listeners[t]=fn;},getElementById(id){return this.ids.get(id)||null;},querySelectorAll(s){return this.all.filter(e=>this.matches(e,s));},querySelector(s){return this.querySelectorAll(s)[0]||null;},createElement(){return new Element({},this);},matches(e,s){if(s.startsWith('#'))return e.id===s.slice(1);const m=s.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);if(m)return m[1]in e.attrs&&(m[2]===undefined||e.attrs[m[1]]===m[2]);return s==='button';},parse(html){const els=[];for(const m of html.matchAll(/<[a-z][a-z0-9-]*\b([^>]*)>/gi)){const attrs={};for(const a of m[1].matchAll(/([^\s=]+)(?:="([^"]*)")?/g))attrs[a[1]]=a[2]||'';const el=new Element(attrs,this);els.push(el);this.all.push(el);}return els;}};
 d.body=new Element({},d);d.parse(fs.readFileSync(path.join(root,'scoring.html'),'utf8'));return d;
}
const settle=async()=>{for(let i=0;i<15;i++)await new Promise(resolve=>setImmediate(resolve));};
function scoringHarness({offline=false,cardStatus='in_progress',view='card',hole=7,networkFailure=false,submitFailure=false,syncFailure=false,authFailure=null,rememberedMember=true,scorerId='member-1'}={}){
 const document=documentStub(),timers=new Set(),calls=[],storage=new Map();
 const players=[{id:'player-1',member_id:'member-1',display_name:'First Member',position:1,playing_category:'women',handicap_used:18},{id:'player-2',member_id:'member-2',display_name:'Second Member',position:2,playing_category:'men',handicap_used:18}];
 const holes=Array.from({length:18},(_,i)=>({hole_number:i+1,par:4,red_par:4,yards:350,red_yards:310,stroke_index:i+1,red_stroke_index:i+1}));
 const card={id:'card-1',event_id:'event-1',scorer_id:scorerId,status:cardStatus};
 const event={id:'event-1',name:'Society round',event_date:F.today(),status:'scheduled'};
 const scores=Object.fromEntries(players.flatMap(p=>holes.map(h=>[M.key(p.id,h.hole_number),{scorecard_player_id:p.id,hole_number:h.hole_number,strokes:4,picked_up:false,changed_at:'2026-09-10T09:00:00Z'}])));
 let cache={userId:'member-1',card:clone(card),players,holes,event,scores,dirty:{},cleared:[],submitQueued:false,hole,selected:'player-1',view,savedAt:1};
 if(rememberedMember)storage.set('barford-score-active-member','member-1');
 const auth={getSession:async()=>authFailure?{data:{session:null},...(authFailure==='signed-out'?{}:{error:{message:authFailure==='network'?'Failed to fetch':'Invalid refresh token'}})}:{data:{session:{user:{id:'member-1'}}}}};
 const client={auth,from(table){const q={filters:{},select(){return this;},eq(k,v){this.filters[k]=v;return this;},in(){return this;},order(){return this;},limit(){return this;},single(){return this;},maybeSingle(){return this;},then(resolve,reject){calls.push({table,filters:this.filters});let data;if(networkFailure&&table==='event_scorecards')return Promise.resolve({error:{message:'Failed to fetch'}}).then(resolve,reject);if(table==='event_scorecards')data=clone(card);else if(table==='event_scorecard_players')data=clone(players);else if(table==='event_holes')data=clone(holes);else if(table==='events')data=clone(event);else if(table==='event_hole_scores')data=Object.values(scores).map(v=>({...v,client_changed_at:v.changed_at}));else data=[];return Promise.resolve({data}).then(resolve,reject);}};return q;},async rpc(name,args){calls.push({rpc:name,args:clone(args)});if(name==='claim_scorecard')card.status='in_progress';if(name==='sync_scorecard'&&syncFailure)return{error:{message:'Failed to fetch'}};if(name==='submit_scorecard'){if(submitFailure)return{error:{message:'Submission refused by server'}};card.status='submitted';}if(name==='handoff_scorecard')card.scorer_id=args.target_new_scorer_id;return{data:card.id};}};
 const context={window:{BarfordSupabase:client,addEventListener(){}},document,navigator:{onLine:!offline},location:{href:'https://example.com/golf/scoring.html?event=event-1&card=card-1',search:'?event=event-1&card=card-1'},localStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k)||null},URL,URLSearchParams,Date,Promise,CustomEvent:class{},setInterval(){},setTimeout(fn,ms){const timer=setTimeout(fn,ms);timers.add(timer);return timer;},clearTimeout(timer){clearTimeout(timer);timers.delete(timer);}};
 vm.createContext(context);vm.runInContext(source('member-workflow.js'),context);vm.runInContext(source('score-model.js'),context);
 context.window.BarfordScoreSafety={read:async()=>clone(cache),save:async model=>{cache=clone(model);return{local:true,backup:true};},legacyPending:async()=>null,removeLegacy:async()=>{}};
 context.window.BarfordMemberFlow.dialog=(title,html)=>{const el=new Element({},document);el.innerHTML=html;context.dialog=el;return el;};
 vm.runInContext(source('scoring.js'),context);
 return{document,context,calls,card,cache:()=>cache,cleanup:()=>timers.forEach(clearTimeout)};
}
test('a ready scorer must claim the round before entering scores',async()=>{
 const h=scoringHarness({cardStatus:'ready'});try{await settle();assert.equal(h.document.getElementById('scoreKeypad').classList.contains('hidden'),true);await h.document.getElementById('startRound').click();await settle();assert.ok(h.calls.some(c=>c.rpc==='claim_scorecard'));assert.equal(h.document.getElementById('scoreKeypad').classList.contains('hidden'),false);}finally{h.cleanup();}
});
test('submission uses the protected RPC and displays success only after server confirmation',async()=>{
 const h=scoringHarness({view:'review'});try{await settle();await h.document.getElementById('finaliseScores').click();await settle();assert.ok(h.calls.some(c=>c.rpc==='submit_scorecard'));assert.equal(h.card.status,'submitted');assert.match(h.document.getElementById('roundReview').innerHTML,/Scores submitted/);assert.equal(h.cache().submitQueued,false);}finally{h.cleanup();}
});
test('a refused submission is not shown as successful and leaves correction available',async()=>{
 const h=scoringHarness({view:'review',submitFailure:true});try{await settle();await h.document.getElementById('finaliseScores').click();await settle();assert.equal(h.card.status,'in_progress');assert.doesNotMatch(h.document.getElementById('roundReview').innerHTML,/Scores submitted/);assert.match(h.document.getElementById('roundReview').innerHTML,/Submission refused/);assert.equal(h.cache().submitQueued,false);assert.equal(h.document.getElementById('finaliseScores').disabled,false);}finally{h.cleanup();}
});
test('no-op saves release the queue and later score changes still reach the server',async()=>{
 const h=scoringHarness();try{await settle();await h.document.getElementById('scoreSyncButton').click();await h.document.getElementById('scoreSyncButton').click();const key=h.document.querySelectorAll('[data-score]').find(b=>b.dataset.score==='5');await key.click();await h.document.getElementById('scoreSyncButton').click();await settle();assert.ok(h.calls.some(c=>c.rpc==='sync_scorecard'&&c.args.score_changes.some(v=>v.strokes===5)));assert.deepEqual(h.cache().dirty,{});}finally{h.cleanup();}
});
test('offline score entry resumes the saved hole and retains card/event/tee when opening the map',async()=>{
 const h=scoringHarness({offline:true,hole:7});try{await settle();assert.equal(h.document.getElementById('holeTitle').textContent,'Hole 7');await h.document.getElementById('viewHole').click();assert.match(h.context.location.href,/event=event-1/);assert.match(h.context.location.href,/card=card-1/);assert.match(h.context.location.href,/hole=7/);assert.match(h.context.location.href,/tee=women/);}finally{h.cleanup();}
});
test('a weak connection reporting online still permits a previously started cached round',async()=>{
 const h=scoringHarness({networkFailure:true});try{await settle();assert.equal(h.document.getElementById('scoreReady').classList.contains('hidden'),false);assert.equal(h.document.getElementById('scoreKeypad').classList.contains('hidden'),false);assert.match(h.document.getElementById('scoreSafetyText').textContent,/saved on this phone/);}finally{h.cleanup();}
});
test('offline submission remains queued and never claims server delivery',async()=>{
 const h=scoringHarness({offline:true,view:'review'});try{await settle();await h.document.getElementById('finaliseScores').click();await settle();assert.equal(h.cache().submitQueued,true);assert.equal(h.calls.some(c=>c.rpc==='submit_scorecard'),false);assert.doesNotMatch(h.document.getElementById('roundReview').innerHTML,/Scores submitted/);}finally{h.cleanup();}
});
test('sign-out recovers from a stalled auth request and preserves saved scorecards and other sites',async()=>{
 const document=documentStub();for(const id of ['accountContent','accountConnection','accountConnectionStatus','accountRetry','accountSignedOut','accountSignOut'])new Element({id},document);
 const key='sb-xspzmthygrajzktydvvj-auth-token',storage=new Map([[key,'stale'],['barford-fast-scorecard-v4','scores'],['other-app-token','keep'],['barford-score-active-member','member-1']]);let destination,scope;
 const timers=new Set(),context={window:{BarfordSupabase:{auth:{signOut:args=>{scope=args.scope;return new Promise(()=>{});}}},location:{replace:url=>destination=url}},document,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},sessionStorage:{removeItem(){}},setTimeout(fn){const timer=setTimeout(fn,5);timers.add(timer);return timer;},clearTimeout(timer){clearTimeout(timer);timers.delete(timer);},Promise};
 vm.createContext(context);vm.runInContext(source('account-session.js'),context);await context.window.BarfordAccountSession.signOut();timers.forEach(clearTimeout);
 assert.equal(scope,'local');assert.equal(destination,'account.html?signedout=1');assert.equal(storage.has(key),false);assert.equal(storage.get('barford-fast-scorecard-v4'),'scores');assert.equal(storage.get('other-app-token'),'keep');assert.equal(storage.has('barford-score-active-member'),false);
});
test('signed-out guests can browse public events and see guest pricing without member queries',async()=>{
 const document=documentStub();new Element({id:'eventList'},document);new Element({id:'eventCalendarSummary'},document);const queries=[];
 const event={id:'guest-event',event_date:'2099-01-01',status:'scheduled',name:'Guest golf day',venue:'Test course',price:40,guest_price:55};
 const client={auth:{getSession:async()=>({data:{session:null}})},from(table){queries.push(table);const q={select(){return q;},in(){return q;},order:async()=>({data:[event]})};return q;}};
 const context={window:{BarfordSupabase:client},document,location:{href:'https://example.com/golf/events.html'},URL,URLSearchParams,Date,Promise,setTimeout,clearTimeout};
 vm.createContext(context);vm.runInContext(source('member-workflow.js'),context);vm.runInContext(source('events-live.js'),context);await settle();
 assert.deepEqual(queries,['events']);assert.match(document.getElementById('filteredEvents').innerHTML,/Guest golf day/);assert.match(document.getElementById('filteredEvents').innerHTML,/£55.00/);assert.match(document.getElementById('filteredEvents').innerHTML,/event.html\?event=guest-event/);assert.doesNotMatch(document.getElementById('eventList').innerHTML,/Sign in to view/);
});
test('a connection failure during session refresh recovers only the remembered started round without server writes',async()=>{
 const h=scoringHarness({authFailure:'network'});try{await settle();assert.equal(h.document.getElementById('scoreReady').classList.contains('hidden'),false);assert.equal(h.document.getElementById('scoreKeypad').classList.contains('hidden'),false);await h.document.querySelectorAll('[data-score]').find(b=>b.dataset.score==='5').click();await h.document.getElementById('scoreSyncButton').click();await settle();assert.ok(Object.keys(h.cache().dirty).length>0);assert.equal(h.calls.some(c=>c.rpc),false);}finally{h.cleanup();}
});
test('a signed-out or explicitly rejected session cannot be restored from the offline marker',async()=>{
 for(const authFailure of ['signed-out','invalid']){const h=scoringHarness({authFailure});try{await settle();assert.equal(h.document.getElementById('scoreReady').classList.contains('hidden'),true);assert.equal(h.document.getElementById('scoreUnavailable').classList.contains('hidden'),false);}finally{h.cleanup();}}
});
test('offline identity recovery requires the remembered member and an already started card',async()=>{
 for(const options of [{rememberedMember:false},{cardStatus:'ready'}]){const h=scoringHarness({authFailure:'network',...options});try{await settle();assert.equal(h.document.getElementById('scoreReady').classList.contains('hidden'),true);assert.equal(h.calls.some(c=>c.rpc),false);}finally{h.cleanup();}}
});

test('event-day dashboard gives every group member direct scorecard access above event details',()=>{
 const document=documentStub(),host=new Element({},document);
 const context={window:{BarfordMemberFlow:F,dispatchEvent(){}},document,Date,CustomEvent:class{}};
 vm.createContext(context);vm.runInContext(source('member-event-view.js'),context);
 for(const status of ['ready','in_progress','submitted','locked'])for(const scorer_id of [null,'member-1','member-2']){
  const m=base();m.event.event_date=F.today();m.event.name='Today’s golf';m.rsvp={status:'playing',payment_status:'payment_due'};m.card={id:'group-card',status,scorer_id};
  context.window.BarfordEventView.render(host,m,{compact:true});
  assert.ok(host.innerHTML.indexOf('id="dashboardScorecard"')<host.innerHTML.indexOf('simple-next-event'));
  assert.match(host.innerHTML,/href="scoring.html\?event=event-1&card=group-card">Open my group’s scorecard/);
 }
});
test('dashboard scorecard handles preparation and connection failure without exposing another group',()=>{
 const document=documentStub(),host=new Element({},document);
 const context={window:{BarfordMemberFlow:F,dispatchEvent(){}},document,Date,CustomEvent:class{}};
 vm.createContext(context);vm.runInContext(source('member-event-view.js'),context);
 const m=base();m.event.event_date=F.today();m.rsvp={status:'playing'};
 context.window.BarfordEventView.render(host,m,{compact:true});assert.match(host.innerHTML,/committee has prepared your group/);assert.doesNotMatch(host.innerHTML,/href="scoring/);
 m.cardError=true;context.window.BarfordEventView.render(host,m,{compact:true});assert.match(host.innerHTML,/couldn’t load your scorecard/);
 for(const change of [{rsvp:{status:'reserve'}},{session:null},{event:{...m.event,event_date:'2099-01-01'}},{event:{...m.event,status:'cancelled'}}]){
  context.window.BarfordEventView.render(host,{...m,...change},{compact:true});assert.doesNotMatch(host.innerHTML,/id="dashboardScorecard"/);
 }
 m.card={id:'own-card',status:'locked',scorer_id:'member-1'};m.event.status='completed';context.window.BarfordEventView.render(host,m,{compact:true});assert.match(host.innerHTML,/Open my group’s scorecard/);
 context.window.BarfordEventView.render(host,m,{compact:false});assert.doesNotMatch(host.innerHTML,/id="dashboardScorecard"/);
});

test('payment overview excludes reserves, cancellations and settled amounts and counts unpriced bookings',()=>{
 const events=[{id:'a',price:10.10},{id:'b',price:20.20},{id:'c',price:99},{id:'d',price:99,status:'cancelled'},{id:'e',price:99},{id:'f',price:null}];
 const rsvps=events.map(e=>({event_id:e.id,status:'playing'}));rsvps[2].status='reserve';rsvps[4].payment_status='paid';
 assert.deepEqual(clone(F.paymentSummary(events,rsvps)),{pence:3030,count:2,unpriced:1});
});
test('round report excludes DNP and unscored rows and preserves tied standings',()=>{
 const report=F.roundReport({name:'Test round',date:'2027-04-01',results:[{playerId:'a',points:30},{playerId:'b',points:35},{playerId:'c',points:35},{playerId:'d',points:50,dnp:true},{playerId:'e',points:null}]},[{id:'a',name:'Alex'},{id:'b',name:'Ben'},{id:'c',name:'Chris'}]);
 assert.match(report,/3 players/);assert.match(report,/1\. Ben — 35 pts/);assert.match(report,/1\. Chris — 35 pts/);assert.match(report,/3\. Alex — 30 pts/);assert.doesNotMatch(report,/50 pts|null/);
});

test('group overview shows both players and front/back totals without submitting',async()=>{
 const h=scoringHarness();try{await settle();await h.document.getElementById('groupOverview').click();const html=h.document.getElementById('roundReview').innerHTML;assert.match(html,/<th scope="col">Front 9/);assert.match(html,/First Member/);assert.match(html,/Second Member/);assert.match(html,/18\/18 holes recorded/);assert.match(html,/<strong>54<\/strong>/);assert.equal(h.calls.some(c=>c.rpc==='submit_scorecard'),false);assert.equal(h.document.getElementById('finaliseScores').disabled,false);}finally{h.cleanup();}
});
test('a viewer can open the group overview but cannot submit or change scores',async()=>{
 const h=scoringHarness({scorerId:'member-2'});try{await settle();assert.equal(h.document.getElementById('scoreKeypad').classList.contains('hidden'),true);await h.document.getElementById('groupOverview').click();assert.doesNotMatch(h.document.getElementById('roundReview').innerHTML,/id="finaliseScores"/);await h.document.querySelectorAll('[data-score]').find(b=>b.dataset.score==='5').click();assert.equal(Object.keys(h.cache().dirty).length,0);assert.equal(h.calls.some(c=>c.rpc==='sync_scorecard'||c.rpc==='submit_scorecard'),false);}finally{h.cleanup();}
});
test('announced groups expose scorer selection on the dashboard before event day',()=>{
 const document=documentStub(),host=new Element({},document),context={window:{BarfordMemberFlow:F,dispatchEvent(){}},document,Date,CustomEvent:class{}};
 vm.createContext(context);vm.runInContext(source('member-event-view.js'),context);
 const m=base();m.rsvp={status:'playing'};m.event.tee_times_status='published';m.card={id:'card',status:'ready',scorer_id:null};
 context.window.BarfordEventView.render(host,m,{compact:true});assert.match(host.innerHTML,/Tee groups announced/);assert.match(host.innerHTML,/Choose our scorer/);assert.match(host.innerHTML,/id="dashboardScorecard"/);
 m.event.tee_times_status='draft';context.window.BarfordEventView.render(host,m,{compact:true});assert.doesNotMatch(host.innerHTML,/id="dashboardScorecard"/);
});
test('choosing a scorer requires explicit confirmation; going back makes no write',async()=>{
 const document=documentStub(),calls=[],dialogs=[];document.body.append=el=>dialogs.push(el);
 document.createElement=()=>{const el=new Element({},document);el.showModal=()=>{};el.remove=()=>{};el.querySelectorAll=selector=>{const flatten=node=>node.children.flatMap(child=>[child,...flatten(child)]);return flatten(el).filter(child=>document.matches(child,selector));};return el;};
 const client={from(){return{select(){return this;},eq:async()=>({data:[{member_id:'member-2',display_name:'Sam Example'}]})};},rpc:async(name,args)=>{calls.push({name,args});return{data:{id:'card',scorer_id:args.target_scorer_id}};}};
 const context={window:{BarfordSupabase:client,dispatchEvent(){}},document,location:{href:'https://example.com/event.html'},URL,Date,setTimeout,clearTimeout,Promise,CustomEvent:class{}};
 vm.createContext(context);vm.runInContext(source('member-workflow.js'),context);const m=base();m.event.name='Summer round';m.card={id:'card',status:'ready'};
 await context.window.BarfordMemberFlow.chooseScorer(m);await dialogs.at(-1).querySelectorAll('[data-scorer-id]')[0].click();assert.equal(calls.length,0);assert.match(dialogs.at(-1).innerHTML,/Sam Example/);assert.match(dialogs.at(-1).innerHTML,/Summer round/);
 await dialogs.at(-1).querySelector('#cancelScorerSelection').click();assert.equal(calls.length,0);
 await dialogs.at(-1).querySelectorAll('[data-scorer-id]')[0].click();await dialogs.at(-1).querySelector('#confirmScorerSelection').click();assert.equal(calls.length,1);assert.equal(calls[0].args.target_scorer_id,'member-2');
});
