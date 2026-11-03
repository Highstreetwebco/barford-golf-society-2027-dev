const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {mocks,fixture,server,base,backend,uid}=require('./baseline.cjs');
const out=path.join(__dirname,'..','test-results'),report=[];
const token='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',preview='a'.repeat(64);
const invite=()=>({status:'open',event_id:999,event_name:'Round 2 · Kenilworth',date:'2027-06-25',first_time:'10:00',event_type:'league',host_id:uid,host_name:'Test Member',guest_price:45,payment_due:'2027-06-15',cancellation_terms:'Cancel according to society terms.',address:'Crewe Lane, Kenilworth CV8 2EA',editable:true,booking_open:true,cutoff_date:'2027-06-15',revision:0,waiting:false,attending:false,reserve:false,round_hours:5});
(async()=>{
 await new Promise(r=>server.listen(8765,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
 try{
  // Member invitation appears below RSVP on both entry points and uses the phone share sheet.
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),model=await mocks(context,{signedIn:true});
  model.events=[{...fixture,guest_price:45,member_price:40,event_type:'league'}];
  await context.addInitScript(preview=>{sessionStorage.setItem('barford-2027-preview-session',preview);Object.defineProperty(navigator,'share',{value:async data=>window.sharedInvite=data,configurable:true});},preview);
  await context.route(backend+'/rest/v1/rpc/baseline_site_gate',route=>route.fulfill({json:{live:false,preview:true}}));
  const page=await context.newPage();page.setDefaultTimeout(10000);
  for(const url of ['home.html','event.html?id=999']){
   if(url.startsWith('event'))model.events[0].guest_price=null;
   await page.goto(base+url);const rsvp=page.getByRole('button',{name:'RSVP',exact:true}),button=page.getByRole('button',{name:'Invite a guest',exact:true});await button.waitFor();
   assert((await button.boundingBox()).y>(await rsvp.boundingBox()).y,'Invite belongs beneath RSVP');
   await button.click();await page.getByRole('dialog',{name:'Share guest invitation'}).waitFor();await page.getByRole('button',{name:'Choose app & recipient'}).click();
   const text=await page.evaluate(()=>window.sharedInvite.text);assert.match(text,/no account or password needed/i);assert.match(text,/guest.html#aaaaaaaa/);assert.match(text,/10 days/);if(url.startsWith('event'))assert.match(text,/To be confirmed/);
   await page.screenshot({path:path.join(out,'guest-share-390.png'),fullPage:true});await page.getByRole('button',{name:'Close',exact:true}).click();
  }
  await context.close();report.push('PASS member: Invite a guest below RSVP on Home and event; generated message, native sharing and unique fragment link');
  // A guest opens just the invitation, without preview access, auth calls or a full-site session.
  let data=invite(),photoFail=false,failSave=false,saves=0,authCalls=0;const calls=[];
  const guest=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  await guest.route(backend+'/**',async route=>{
   const req=route.request();if(req.url().includes('/auth/'))authCalls++;
   if(!req.url().endsWith('/functions/v1/guest-rsvp'))return route.fulfill({status:403,json:{error:'Site protected'}});
   const body=req.postDataJSON();calls.push(body);assert.equal(body.token,token);
   if(body.action==='view')return route.fulfill({json:data});
   if(body.action==='save'){
    if(failSave)return route.fulfill({status:400,json:{error:'This RSVP changed. Reload the invitation before saving'}});
    saves++;data={...data,...body.payload,status:'joined',revision:data.revision+1,attending:body.payload.attending&&!data.waiting,reserve:body.payload.attending&&data.waiting};
    return route.fulfill({json:data});
   }
   if(body.action==='photo'){assert(body.photo.startsWith('/9j/'));if(photoFail)return route.fulfill({status:400,json:{error:'Photo unavailable'}});data.photo_url=base+'icon-logo.png';return route.fulfill({json:data});}
   if(body.action==='remove_photo'){delete data.photo_url;return route.fulfill({json:data});}
  });
  const p=await guest.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(10000);
  await p.goto(base+'guest.html#'+token);await p.getByRole('heading',{name:'Join the event',exact:true}).waitFor();assert.equal(await p.locator('[type=password]').count(),0);assert.equal(await p.locator('[data-admin]').count(),0);
  await p.locator('[name=full_name]').fill('Jamie Guest');await p.locator('[name=phone]').fill('07012345678');await p.locator('[name=email]').fill('jamie@example.invalid');await p.locator('[name=host_id]').selectOption(uid);await p.locator('[name=guest_handicap]').fill('24.5');await p.locator('[name=accept_terms]').check();
  await p.locator('#profilePhoto').setInputFiles(path.join(__dirname,'..','icon-logo.png'));
  await p.locator('#profilePhotoPreview:not([hidden])').waitFor();await p.screenshot({path:path.join(out,'guest-form-390.png'),fullPage:true});
  await p.getByRole('button',{name:'RSVP to event',exact:true}).click();await p.getByRole('heading',{name:'You’ve successfully RSVP’d'}).waitFor();assert.equal(saves,1);assert.equal(authCalls,0);
  const downloadPromise=p.waitForEvent('download');await p.getByRole('button',{name:'Apple / download calendar'}).click();const download=await downloadPromise;await download.saveAs(path.join(out,'guest-calendar.ics'));assert.match(fs.readFileSync(path.join(out,'guest-calendar.ics'),'utf8'),/DTSTART;VALUE=DATE:20270625/);
  assert.match(await p.getByRole('link',{name:'Google Calendar'}).getAttribute('href'),/calendar.google.com/);await p.screenshot({path:path.join(out,'guest-confirmation-390.png'),fullPage:true});
  await p.reload();await p.getByRole('heading',{name:'Your RSVP is confirmed'}).waitFor();await p.getByRole('button',{name:'Edit RSVP',exact:true}).click();assert.equal(await p.locator('[name=full_name]').inputValue(),'Jamie Guest');assert.equal(await p.locator('[name=guest_handicap]').inputValue(),'24.5');
  failSave=true;await p.locator('[name=full_name]').fill('Jamie Updated');await p.locator('[name=accept_terms]').check();await p.getByRole('button',{name:'Save RSVP',exact:true}).click();await p.locator('.form-status').filter({hasText:'This RSVP changed'}).waitFor();assert.equal(await p.locator('[name=full_name]').inputValue(),'Jamie Updated');
  failSave=false;await p.locator('[name=response]').selectOption('no');await p.getByRole('button',{name:'Save RSVP',exact:true}).click();await p.getByRole('heading',{name:'Your RSVP has been withdrawn'}).waitFor();assert.equal(await p.getByRole('link',{name:'Google Calendar'}).count(),0);
  // Waiting list never masquerades as confirmed; photo failure never loses the RSVP.
  data=invite();data.waiting=true;photoFail=true;await p.reload();await p.locator('[name=full_name]').fill('Taylor Guest');await p.locator('[name=phone]').fill('07012345679');await p.locator('[name=host_id]').selectOption(uid);await p.locator('[name=guest_handicap]').fill('18');await p.locator('[name=accept_terms]').check();await p.locator('#profilePhoto').setInputFiles(path.join(__dirname,'..','icon-logo.png'));await p.locator('#profilePhotoPreview:not([hidden])').waitFor();await p.getByRole('button',{name:'Join waiting list',exact:true}).click();await p.getByRole('heading',{name:'You’re on the waiting list'}).waitFor();assert.match(await p.locator('#guestJoin').innerText(),/photo change failed/);assert.equal(await p.getByRole('link',{name:'Google Calendar'}).count(),0);
  data.editable=false;data.booking_open=false;await p.reload();await p.getByRole('heading',{name:'You’re on the waiting list'}).waitFor();assert.equal(await p.getByRole('button',{name:'Edit RSVP',exact:true}).count(),0);assert.match(await p.locator('#guestJoin').innerText(),/ask Test Member to contact the admins/);
  await p.screenshot({path:path.join(out,'guest-cutoff-390.png'),fullPage:true});await p.setViewportSize({width:320,height:740});await p.screenshot({path:path.join(out,'guest-cutoff-320.png'),fullPage:true});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  data=invite();data.guest_price=null;await p.reload();await p.getByRole('heading',{name:'Join the event',exact:true}).waitFor();assert.match(await p.locator('#guestJoin').innerText(),/confirm any cost before payment/);
  assert.deepEqual(errors,[]);assert.equal(authCalls,0);assert(calls.some(c=>c.action==='photo'));await guest.close();report.push('PASS guest: no account/preview; personal details, host, handicap, optional portrait; confirmed/waitlist/withdrawn states; calendar download; same-link edits; failed-save retention; photo failure recovery; cutoff on 390px and 320px');
  // Admin can find and edit guest records after cutoff without impersonating a guest.
  const admin=await browser.newContext({viewport:{width:1365,height:900},serviceWorkers:'block'}),am=await mocks(admin,{signedIn:true,admin:true});am.profile.is_admin=true;am.events=[{...fixture,event_type:'league',guest_price:45}];
  const mid='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';am.responses=[{id:10,event_id:999,member_id:mid,participant_id:mid,user_id:null,name:'Jamie Guest (guest)',attending:true,reserve:false,guest_host_id:uid,buggy:false}];
  await admin.addInitScript(preview=>sessionStorage.setItem('barford-2027-preview-session',preview),preview);await admin.route(backend+'/rest/v1/rpc/baseline_site_gate',route=>route.fulfill({json:{live:false,preview:true}}));
  let adminSaved;await admin.route(backend+'/rest/v1/rpc/baseline_admin_guest_rsvp',route=>{const b=route.request().postDataJSON();if(b.action==='save')adminSaved=b.payload;return route.fulfill({json:{...invite(),status:'joined',editable:true,member_id:mid,full_name:'Jamie Guest',phone:'07012345678',guest_handicap:24,attending:true,revision:3,...b.payload}});});
  const ap=await admin.newPage();await ap.goto(base+'admin.html?tab=responses');await ap.locator('[data-edit-response="'+mid+'"]').click();await ap.getByRole('heading',{name:'Edit guest RSVP'}).waitFor();await ap.locator('[name=phone]').fill('07099999999');await ap.locator('[name=accept_terms]').check();await ap.getByRole('button',{name:'Save guest RSVP'}).click();await ap.getByRole('heading',{name:'Edit guest RSVP'}).waitFor({state:'hidden'});assert.equal(adminSaved.phone,'07099999999');assert.equal(adminSaved.member_id,mid);await admin.close();report.push('PASS admin: guest edit entry from Responses, contact update through authenticated admin endpoint');
 }finally{fs.writeFileSync(path.join(out,'guest-checks.json'),JSON.stringify(report,null,2));console.log(report.join('\n'));await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
