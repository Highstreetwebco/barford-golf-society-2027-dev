import assert from 'node:assert/strict';
import {test} from 'node:test';
import {packPlayers,participantId} from '../assets/js/tee-groups.js';
import {calendarICS,calendarLinks} from '../assets/js/event-calendar.js';
import {createHandler,jpegBytes} from '../supabase/functions/guest-rsvp/index.ts';
const player=(id,host)=>({user_id:id,name:id,guest_host_id:host});
test('guest groups remain indivisible, conflicts are explicit',()=>{
 const roster=[player('host'),{member_id:'guest1',name:'Guest 1',guest_host_id:'host'},player('guest2','host'),player('guest3','host'),player('other')];
 const groups=packPlayers(roster);assert.equal(groups.find(g=>g.some(p=>participantId(p)==='host')).length,4);assert.equal(groups.flat().length,5);
 assert.throws(()=>packPlayers([player('guest','missing')]),/inviting member is not confirmed/);
 assert.throws(()=>packPlayers([...roster,player('guest4','host')]),/has 5 players/);
 assert.throws(()=>packPlayers(roster,[{first_user:'host',second_user:'other'}]),/has 5 players/);
 for(let count=1;count<=36;count++){const people=Array.from({length:count},(_,i)=>({...player('p'+i),buggy:i%2===0}));if(count>=2)people[1].guest_host_id='p0';const packed=packPlayers(people);assert.equal(new Set(packed.flat().map(participantId)).size,count);assert(packed.every(g=>g.length<=4));if(count>=2)assert(packed.some(g=>g.some(p=>p.user_id==='p0')&&g.some(p=>p.user_id==='p1')));}
});
test('calendar uses personal tee time, UK DST, all-day fallback and safe escaping',()=>{
 const event={event_id:110,event_name:'Round, 2; Kenilworth',date:'2027-04-30',host_name:'Test Host',address:'Crewe Lane\nKenilworth',round_hours:5};
 const all=calendarICS(event);assert.match(all,/DTSTART;VALUE=DATE:20270430/);assert.match(all,/DTEND;VALUE=DATE:20270501/);assert.match(all,/Round\\, 2\\; Kenilworth/);assert.equal(calendarLinks(event).allDay,true);
 const summer=calendarICS({...event,tee_time:'10:30'});assert.match(summer,/DTSTART:20270430T093000Z/);assert.match(summer,/DTEND:20270430T143000Z/);
 const winter=calendarICS({...event,date:'2027-01-15',tee_time:'10:30'});assert.match(winter,/DTSTART:20270115T103000Z/);
 const google=new URL(calendarLinks({...event,tee_time:'10:30'}).google);assert.equal(google.searchParams.get('ctz'),'Europe/London');assert.equal(google.searchParams.get('location'),'Crewe Lane Kenilworth');
 const long=calendarICS({...event,event_name:'🏌️'.repeat(100)});assert(long.split('\r\n').every(line=>new TextEncoder().encode(line).length<=75));
});
const token='20000000-0000-4000-8000-000000000002',member='30000000-0000-4000-8000-000000000003';
function backend({budget=true,denyPhoto=false,denySave=false,commitThenFail=false}={}){
 const calls=[];let path=member+'/40000000-0000-4000-8000-000000000004.jpg';
 const handler=createHandler({url:'https://example.invalid',service:'service-fixture',anon:'anon-fixture'},async(url,init)=>{
  const body=init.body instanceof Uint8Array?init.body:JSON.parse(init.body||'{}');calls.push({url,body,method:init.method});
  const good=value=>new Response(JSON.stringify(value));
  const fail=message=>new Response(JSON.stringify({code:'P0001',message}),{status:400});
  if(url.includes('baseline_take_budget'))return good(budget);
  if(url.includes('baseline_guest_rsvp')){
   if(body.action==='save'&&denySave)return fail('Online guest changes close 10 days before the event.');
   if(body.action==='photo_check'&&denyPhoto)return fail('Photo editing has closed.');
   if(body.action==='photo_save'){path=body.payload.photo_path;if(commitThenFail)throw new Error('Connection lost');}
   return good({status:'joined',member_id:member,avatar_path:path,previous_path:'old/path',editable:true,full_name:'Guest'});
  }
  if(url.includes('/object/sign/'))return good({signedURL:'/object/sign/baseline-profile-images/'+path+'?token=fake'});
  return good({});
 });
 const send=(body,key='anon-fixture')=>handler(new Request('https://example.invalid/guest-rsvp',{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify(body)}));
 return {calls,send};
}
test('capability endpoint validates action/key/token and strips privilege fields',async()=>{
 const b=backend();assert.equal((await b.send({action:'view',token},'bad')).status,401);assert.equal((await b.send({action:'view',token:'bad'})).status,400);
 const data=await(await b.send({action:'view',token})).json();assert.equal(data.member_id,undefined);assert.equal(data.avatar_path,undefined);assert.equal(data.previous_path,undefined);assert.match(data.photo_url,/object\/sign/);
 await b.send({action:'save',token,payload:{full_name:'Guest',p_admin:true,token:'other',member_id:'other',host_id:'host',reserve:true}});
 const payload=b.calls.find(c=>c.body.action==='save').body.payload;assert.equal(payload.token,token);assert.equal(payload.p_admin,undefined);assert.equal(payload.reserve,undefined);assert.equal(payload.member_id,undefined);
 const denied=backend({budget:false});assert.equal((await denied.send({action:'view',token})).status,429);assert(!denied.calls.some(c=>c.url.includes('baseline_guest_rsvp')));
 const cutoff=backend({denySave:true});assert.match((await(await cutoff.send({action:'save',token})).json()).error,/10 days/);
});
// Minimal structurally valid JPEG header used only to exercise authorization and cleanup.
const jpeg=Buffer.from([255,216,255,192,0,17,8,2,128,2,128,3,1,17,0,2,17,0,3,17,0,255,217]).toString('base64');
test('photo input checks format and dimensions; cutoff checked before Storage writes',async()=>{
 assert.equal(jpegBytes(jpeg).length,23);assert.throws(()=>jpegBytes(Buffer.from('<svg>bad</svg>').toString('base64')),/JPEG/);
 const b=backend({denyPhoto:true});assert.equal((await b.send({action:'photo',token,photo:jpeg})).status,400);assert(!b.calls.some(c=>c.url.includes('/storage/')));
 const saved=backend();assert.equal((await saved.send({action:'photo',token,photo:jpeg})).status,200);const photo=saved.calls.find(c=>c.body.action==='photo_save');assert.match(photo.body.payload.photo_path,new RegExp('^'+member+'/'));assert(saved.calls.some(c=>c.method==='DELETE'));
 const lost=backend({commitThenFail:true});assert.equal((await lost.send({action:'photo',token,photo:jpeg})).status,400);assert(!lost.calls.some(c=>c.method==='DELETE'),'Never delete a photo whose save committed before the response was lost');
});
