/* Run in the existing GitHub Actions browser environment. All writes are mocked. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mocks, fixture, server, base, backend, uid } = require('./baseline.cjs');
const out = path.join(__dirname, '..', 'test-results');
const report = [];
const people = [uid, '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555'];
const names = ['Test Member', 'Derek Lewis', 'Richard Jones', 'Gary Example', 'Tim Example'];

const previewToken = 'a'.repeat(64), previewPassword = 'fixture-launch-password';
async function launchMocks(context, launch = {live:false, publishes:0}) {
  await context.route(backend+'/rest/v1/rpc/baseline_site_gate', async route => {
    if (launch.unavailable) return route.abort();
    const input=route.request().postDataJSON(), preview=input.p_token===previewToken;
    let result={live:launch.live,preview};
    if(input.p_action==='unlock') result=input.p_password===previewPassword
      ? {...result,preview:true,token:previewToken} : {...result,error:'Incorrect password. Please try again.'};
    if(input.p_action==='publish') {
      launch.publishes++;
      if(!preview || input.p_password!==previewPassword) result={...result,error:'Incorrect password. Please try again.'};
      else { launch.live=true; result={live:true,preview:true}; }
    }
    return route.fulfill({json:result});
  });
  return launch;
}

async function setup(browser, {admin = false, signedIn = true, width = 1365, height = 900, memberView, launch} = {}) {
  const context = await browser.newContext({viewport:{width,height},serviceWorkers:'block',timezoneId:'Europe/London'});
  const model = await mocks(context, {signedIn,admin});
  await context.addInitScript(token => sessionStorage.setItem('barford-2027-preview-session',token),previewToken);
  await launchMocks(context,launch);
  if (typeof memberView === 'boolean') await context.addInitScript(({id,enabled})=>localStorage.setItem('barford-2027-view:'+id,enabled?'member':'admin'),{id:uid,enabled:memberView});
  model.profile.is_admin = admin;
  model.events = [{...fixture, event_type:'league',round_number:1,member_price:45,course_name:'The Warwickshire',date:'2027-06-25',tee_published_at:null,course_layout_id:null}];
  await context.addInitScript(() => {
    const Original = Date;
    const current = new Original('2027-06-01T12:00:00Z').valueOf();
    window.Date = class extends Original { constructor(...args){super(...(args.length?args:[current]));} static now(){return current;} };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  return {context,page,model,errors};
}

function resultBoard() {
  const scores = [[46,39,33,32,26,25,22],[38,36,33,30,27,22,15]];
  return {visible_rounds:7, players:people.slice(0,2).map((id,i)=>({id,name:names[i],starting_handicap:20})),
    rounds:Array.from({length:7},(_,i)=>({round:i+1,average:30,results:people.slice(0,2).map((id,p)=>({user_id:id,points:scores[p][i],handicap:20,next_handicap:20,adjustment:0,winner:false}))}))};
}

(async () => {
  fs.mkdirSync(out,{recursive:true});
  await new Promise(resolve=>server.listen(8765,'127.0.0.1',resolve));
  const browser = await chromium.launch();
  try {
    for (const width of [390,1365]) {
      const {context,page,model,errors}=await setup(browser,{admin:true,width});
      const members=[{id:uid,member_id:uid,username:'Test Admin',mobile:'07000000000',is_admin:true,registered:true},
        ...people.slice(1,3).map((id,i)=>({id,member_id:id,username:['Simon Example','Gary Example'][i],is_admin:false,registered:false}))];
      model.accounts=members;
      const photos=new Map(),objects=new Set(),deleted=[];
      let uploads=0,saves=0,uploadFail=false,saveFail=false,lostResponse=false;
      await context.route(backend+'/rest/v1/rpc/baseline_admin_member_photo',route=>{
        const {target}=route.request().postDataJSON();
        return route.fulfill({json:{avatar_path:photos.get(target)||null,upload_folder:target}});
      });
      await context.route(backend+'/rest/v1/rpc/baseline_admin_save_member_photo',async route=>{
        saves++;const input=route.request().postDataJSON();
        if(input.expected_path!==(photos.get(input.target)||null)) return route.fulfill({status:409,json:{message:'This photo changed. Reopen the photo editor before saving'}});
        if(saveFail){saveFail=false;return route.fulfill({status:503,json:{message:'Temporary photo save failure'}});}
        photos.set(input.target,input.photo_path);
        if(input.target===uid) model.profile.baseline_avatar_path=input.photo_path;
        await new Promise(resolve=>setTimeout(resolve,80));
        if(lostResponse){lostResponse=false;return route.abort();}
        return route.fulfill({json:null});
      });
      await context.route(backend+'/storage/v1/object/baseline-profile-images**',route=>{
        if(route.request().method()==='POST') {
          uploads++;
          if(uploadFail){uploadFail=false;return route.fulfill({status:503,json:{message:'Temporary upload failure'}});}
          const key=new URL(route.request().url()).pathname.split('/baseline-profile-images/')[1];
          assert.match(key,/^[a-f0-9-]+\/[a-f0-9-]+\.jpg$/);objects.add(key);
          return route.fulfill({json:{Id:'fixture',Key:'baseline-profile-images/'+key}});
        }
        if(route.request().method()==='DELETE') {
          for(const key of route.request().postDataJSON().prefixes){deleted.push(key);objects.delete(key);}
          return route.fulfill({json:[]});
        }
        return route.fallback();
      });
      const open=async id=>{await page.locator('[data-edit-photo="'+id+'"]').click();await page.locator('#managedPhoto').waitFor();};
      const choose=async()=>{
        await page.locator('#managedPhoto').setInputFiles(path.join(__dirname,'..','icon-logo.png'));
        await page.getByText('New photo preview',{exact:true}).waitFor();
        await page.locator('#managedPhotoPreview').evaluate(img=>img.decode());
        assert.deepEqual(await page.locator('#managedPhotoPreview').evaluate(img=>[img.naturalWidth,img.naturalHeight]),[640,640]);
      };
      const save=async()=>{await page.locator('#memberPhotoDialog form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});};
      const closed=()=>page.locator('#memberPhotoDialog').waitFor({state:'detached'});
      await page.goto(base+'admin.html?tab=accounts');
      await page.locator('[data-edit-photo="'+uid+'"]').waitFor();
      assert.equal(await page.locator('[data-edit-photo]').count(),3,'Registered and unregistered members offer photo editing');
      await open(uid);
      await page.locator('#managedPhoto').setInputFiles({name:'wrong.txt',mimeType:'text/plain',buffer:Buffer.from('not an image')});
      await page.getByText('Choose a JPEG, PNG or WebP photo. Export HEIC photos as JPEG first.',{exact:true}).waitFor();
      assert(await page.locator('#memberPhotoDialog [type=submit]').isDisabled());
      assert.equal(uploads,0);
      await choose();
      await page.screenshot({path:path.join(out,`admin-photo-editor-${width}.png`),fullPage:true});
      await page.locator('#memberPhotoDialog [data-close]').click();await closed();
      assert.equal(uploads,0,'Cancel never uploads a selected photo');
      await open(uid);await choose();uploadFail=true;await save();
      await page.getByText('Temporary upload failure',{exact:true}).waitFor();
      assert.equal(saves,0,'Failed upload never changes the profile');
      await save();await closed();
      assert.equal(saves,1,'Double submit sends one photo save');
      const ownPhoto=photos.get(uid);assert(objects.has(ownPhoto));
      await open(uid);await page.locator('#memberPhotoDialog [data-remove]').click();await closed();
      assert.equal(photos.get(uid),null);assert(deleted.includes(ownPhoto));
      await open(people[1]);await choose();saveFail=true;await save();
      await page.getByText('Temporary photo save failure',{exact:true}).waitFor();
      assert.equal(photos.get(people[1]),undefined);
      assert.equal(objects.size,0,'Rejected save cleans up its unused upload');
      await save();await closed();
      const first=photos.get(people[1]);assert(objects.has(first));
      await open(people[1]);await choose();await save();await closed();
      const replacement=photos.get(people[1]);assert.notEqual(first,replacement);assert(deleted.includes(first));
      await open(people[1]);await choose();
      const concurrent=people[1]+'/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg';
      photos.set(people[1],concurrent);objects.add(concurrent);objects.delete(replacement);
      await save();await page.getByText('This photo changed. Reopen the photo editor before saving',{exact:true}).waitFor();
      assert.equal(photos.get(people[1]),concurrent);assert(objects.has(concurrent));assert(!deleted.includes(concurrent));
      await page.locator('#memberPhotoDialog [data-close]').click();await closed();
      await open(people[1]);await choose();lostResponse=true;await save();await closed();
      const recovered=photos.get(people[1]);assert(objects.has(recovered),'A committed photo survives a lost save response');
      assert(deleted.includes(concurrent));
      await open(people[2]);await choose();await save();await closed();
      await page.reload();await open(people[2]);
      assert(await page.locator('#managedPhotoPreview').isVisible(),'Saved photo loads again after refresh');
      await page.locator('#memberPhotoDialog [data-close]').click();await closed();
      model.events[0].tee_published_at='2027-06-01T10:00:00Z';
      model.teeView={status:'published',round_number:1,groups:[{group_number:1,tee_time:'09:00',players:members.slice(1).map(p=>({participant_id:p.id,user_id:null,name:p.username,avatar_path:photos.get(p.id),handicap:20,type:'walker'}))}]};
      await page.goto(base+'event.html?id=999');
      await page.locator('[data-portrait="'+people[2]+'"]').click();
      await page.getByRole('dialog',{name:'Gary Example profile photo',exact:true}).waitFor();
      assert((await page.locator('.portrait-dialog img').getAttribute('src')).includes(photos.get(people[2])),'Each offline portrait opens the correct member');
      await page.locator('.portrait-dialog button').click();
      assert.deepEqual(errors,[]);
      report.push(`PASS admin photos ${width}: all member types, preview/cancel, invalid files, upload/save retry, replacement/removal, stale editor, lost response and correct offline tee portraits`);
      await context.close();
    }
    for (const width of [390,1365]) {
      const {context,page,model,errors}=await setup(browser,{admin:true,width});
      model.accounts=[{id:uid,member_id:uid,username:'Test Admin',mobile:'07000000000',handicap:20,is_admin:true,disabled:false,registered:true},
        ...people.slice(1,4).map((id,i)=>({id,member_id:id,username:['Simon Example','Gary Example','Tim Example'][i],mobile:null,handicap:null,is_admin:false,disabled:false,registered:false}))];
      let attempts=0,fail=true,authChanges=0;
      page.on('request',req=>{if(/\/auth\/v1\/(signup|admin|token|logout)/.test(req.url())) authChanges++;});
      await context.route(backend+'/rest/v1/rpc/baseline_admin_save_roster_member',async route=>{
        attempts++; const input=route.request().postDataJSON();
        assert.equal('admin_access' in input,false,'A roster edit cannot grant an account role');
        if(fail){fail=false;return route.fulfill({status:503,json:{message:'Temporary member save failure'}});}
        const person=model.accounts.find(p=>p.id===input.target);
        Object.assign(person,{username:input.username,mobile:input.mobile||null,handicap:input.society_handicap});
        await new Promise(resolve=>setTimeout(resolve,80));
        return route.fulfill({json:null});
      });
      await page.goto(base+'admin.html?tab=accounts');
      await page.locator('[data-edit-account="'+people[1]+'"]').waitFor();
      assert.equal(await page.locator('#accountList .account-row').count(),4,'All three unregistered members are listed');
      assert.equal(await page.getByText('No login yet',{exact:true}).count(),3);
      assert.equal(await page.locator('[data-reset-account]').count(),1,'Only existing logins offer password reset');
      await page.screenshot({path:path.join(out,`member-roster-${width}.png`),fullPage:true});
      for(const [i,id] of people.slice(1,4).entries()) {
        await page.locator('[data-edit-account="'+id+'"]').click();
        assert.equal(await page.locator('dialog [name=admin_access]').count(),0);
        assert.equal(await page.locator('dialog [name=mobile]').getAttribute('required'),null);
        await page.locator('dialog [name=username]').fill(['Simon Edited','Gary Edited','Tim Edited'][i]);
        await page.locator('dialog [name=handicap]').fill('37');
        const before=attempts;
        await page.locator('dialog [type=submit]').click();
        assert.equal(attempts,before,'Invalid handicap never reaches the API');
        await page.locator('dialog [name=handicap]').fill(String(20+i));
        if(i) await page.locator('dialog [name=mobile]').fill('0700000000'+i);
        if(i===0) {
          await page.screenshot({path:path.join(out,`member-editor-${width}.png`),fullPage:true});
          await page.locator('dialog [type=submit]').click();
          await page.getByText('Temporary member save failure',{exact:true}).waitFor();
          assert.equal(await page.locator('dialog [name=username]').inputValue(),'Simon Edited');
        }
        await page.locator('dialog form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});
        await page.locator('dialog.account-editor').waitFor({state:'detached'});
        await page.locator('[data-edit-account="'+id+'"]').waitFor();
        assert.equal(attempts,i+2,'Double submit cannot duplicate an edit');
      }
      await page.locator('#accountSearch').fill('Simon Edited');
      assert.equal(await page.locator('#accountList .account-row').count(),1);
      assert.match(await page.locator('#accountList').innerText(),/Starting handicap: 20/);
      await page.reload();
      await page.locator('[data-edit-account="'+people[1]+'"]').waitFor();
      assert.match(await page.locator('#accountList').innerText(),/Simon Edited/,'Reload keeps saved edits');
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2));
      await page.locator('[data-edit-account="'+uid+'"]').click();
      assert.equal(await page.locator('dialog [name=admin_access]').count(),1,'Registered account controls stay available');
      assert(await page.locator('dialog [name=admin_access]').isDisabled(),'Admin cannot remove their own access');
      await page.locator('dialog [name=mobile]').fill('07000000009');
      await page.locator('dialog [type=submit]').click();
      await page.locator('dialog.account-editor').waitFor({state:'detached'});
      assert.equal(model.accountEdits.target,uid);
      assert.equal(model.accountEdits.admin_access,true);
      assert.equal(authChanges,0,'Editing member records creates no logins and changes no sign-in');
      assert.deepEqual(errors,[]);
      report.push(`PASS member editor ${width}: three unregistered members, optional phone, persisted edits, validation, failure retry, duplicate submit guard and registered-account controls`);
      await context.close();
    }
    for (const width of [390,1365]) {
      const {context,page,model,errors}=await setup(browser,{admin:true,width});
      const offline=people[1], registeredRoster=people[2];
      const members=[{id:offline,name:'Offline Member',user_id:null},{id:registeredRoster,name:'Test Member',user_id:uid}];
      let attempts=0,fail=false;
      model.league={revision:0,players:[{id:offline,name:'Offline Member',starting_handicap:20,offline:true,adjustments:[]},{id:uid,name:'Test Member',starting_handicap:20,adjustments:[]}],rounds:[]};
      await context.route(backend+'/rest/v1/rpc/baseline_admin_booking_members',route=>route.fulfill({json:members.map(m=>({...m,booking_id:model.responses.find(r=>r.member_id===m.id)?.id||null}))}));
      await context.route(backend+'/rest/v1/rpc/baseline_submit_rsvp',async route=>{
        attempts++; const p=route.request().postDataJSON().payload;
        if(fail){fail=false;return route.fulfill({status:503,json:{message:'Temporary booking failure'}});}
        assert.equal(p.event_id,999); assert(p.member_id);
        const member=members.find(m=>m.id===p.member_id);
        let r=model.responses.find(r=>r.member_id===p.member_id);
        if(!r){r={id:model.responses.length+1,user_id:member.user_id,member_id:member.id,participant_id:member.user_id||member.id,name:member.name};model.responses.push(r);}
        Object.assign(r,p,{attending:p.attending&&!p.reserve,reserve:p.attending&&p.reserve});
        await new Promise(resolve=>setTimeout(resolve,80));
        return route.fulfill({json:r});
      });
      await page.goto(base+'admin.html?tab=responses&event=999');
      await page.locator('#addEventMember').click();
      await page.locator('dialog [name=member_id]').selectOption(offline);
      await page.locator('dialog [name=buggy]').selectOption('yes');
      await page.locator('dialog [name=preferred_time]').selectOption('End');
      await page.screenshot({path:path.join(out,`admin-add-member-${width}.png`),fullPage:true});
      fail=true;
      await page.locator('dialog button[type=submit]').click();
      await page.getByText('Temporary booking failure',{exact:true}).waitFor();
      assert.equal(await page.locator('dialog [name=member_id]').inputValue(),offline);
      await page.locator('dialog form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});
      await page.locator('dialog').waitFor({state:'detached'});
      assert.equal(attempts,2,'Double click must not duplicate the booking request');
      assert.equal(model.responses.length,1);
      assert.equal(model.responses[0].user_id,null,'No fabricated login account');
      await page.locator('#addEventMember').click();
      await page.locator('dialog [name=member_id]').selectOption(offline);
      assert.match(await page.locator('[data-member-info]').textContent(),/already has a response/);
      await page.locator('dialog button[type=submit]').click();
      await page.locator('dialog').waitFor({state:'detached'});
      assert.equal(model.responses.length,1);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2),true,'Booking screen fits mobile');
      await page.locator('#addEventMember').click();
      await page.locator('dialog [name=member_id]').selectOption(registeredRoster);
      await page.locator('dialog button[type=submit]').click();
      await page.locator('dialog').waitFor({state:'detached'});
      await page.locator('[data-edit-response="'+offline+'"]').click();
      await page.locator('dialog [name=status]').selectOption('waiting');
      await page.locator('dialog button[type=submit]').click();
      await page.locator('dialog').waitFor({state:'detached'});
      assert.equal(model.responses[0].reserve,true);
      await page.locator('[data-edit-response="'+offline+'"]').click();
      await page.locator('dialog [name=status]').selectOption('playing');
      await page.locator('dialog button[type=submit]').click();
      await page.locator('dialog').waitFor({state:'detached'});
      await page.locator('#tabTees').click(); await page.locator('#generateTees').click();
      await page.locator('[data-player="'+offline+'"]').waitFor();
      assert.equal(await page.locator('.tee-player').count(),2,'Unregistered participants must remain distinct');
      await page.locator('#tabScoring').click();
      await page.locator('[data-score="'+offline+'"]').waitFor();
      assert.equal(await page.locator('[data-score]').count(),2);
      await page.screenshot({path:path.join(out,`admin-booking-scores-${width}.png`),fullPage:true});
      assert.deepEqual(errors,[]);
      report.push(`PASS admin member bookings ${width}: registered/unregistered, failed save retry, double submit, existing booking edit, waiting status, tees and scores`);
      await context.close();
    }
    {
      const launch={live:false,publishes:0};
      const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}}),page=await context.newPage();
      await mocks(context,{signedIn:false}); await launchMocks(context,launch);
      await page.goto(base+'index.html');
      await page.locator('#previewPassword').waitFor({state:'visible'});
      assert.equal(await page.locator('header img.preview-logo').count(),1);
      await page.locator('header img.preview-logo').evaluate(img=>img.decode());
      assert.match(await page.title(),/Coming soon/);
      await page.goto(base+'gallery.html');
      await page.waitForURL('**/index.html?next=gallery.html');
      await page.goto(base+'events.html');
      await page.waitForURL('**/index.html?next=events.html');
      await page.locator('#previewPassword').fill('wrong-password');
      await page.locator('#previewSubmit').click();
      await page.getByText('Incorrect password. Please try again.',{exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>sessionStorage.getItem('barford-2027-preview-session')),null);
      await page.locator('#previewPassword').fill(previewPassword);
      await page.locator('#previewSubmit').click();
      await page.waitForURL('**/events.html'); await page.locator('#eventList').waitFor({state:'visible'});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2));
      assert.equal(await page.locator('a[data-admin]:visible').count(),0,'Preview password does not grant a member admin role');
      assert.equal(await page.locator('#makeSiteLive').count(),0,'Launch control is absent from member pages');
      assert.equal(await page.locator('.launch-preview-bar').count(),0,'Filming pages have no preview banner');
      await page.goto(base+'admin.html');
      await page.getByRole('heading',{name:'Admin sign in',exact:true}).waitFor();
      assert.equal(await page.locator('#makeSiteLive').count(),0,'Preview access does not expose Admin launch controls');
      const adminSession=await setup(browser,{admin:true,width:390,launch}),adminPage=adminSession.page;
      await adminPage.goto(base+'admin.html');
      await adminPage.locator('#makeSiteLive').waitFor({state:'visible'});
      await adminPage.locator('#makeSiteLive').click(); await adminPage.getByRole('button',{name:'Cancel',exact:true}).click();
      assert.equal(launch.live,false,'Cancel must leave the site closed');
      await adminPage.locator('#makeSiteLive').click(); await adminPage.locator('#launchPassword').fill('wrong-password');
      await adminPage.locator('#launchDialog button[type=submit]').click();
      await adminPage.locator('#launchDialog').getByText('Incorrect password. Please try again.',{exact:true}).waitFor();
      assert.equal(launch.live,false,'Preview access alone cannot publish');
      await adminPage.locator('#launchPassword').fill(previewPassword);
      await adminPage.locator('#launchDialog form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});
      await adminPage.getByText('The site is live for everyone.',{exact:true}).waitFor();
      assert.equal(launch.publishes,2,'Double submit sends only one additional publish request');
      assert.equal(launch.live,true);
      const publicContext=await browser.newContext({serviceWorkers:'block'}),publicPage=await publicContext.newPage();
      await mocks(publicContext,{signedIn:false}); await launchMocks(publicContext,launch);
      await publicPage.goto(base+'index.html'); await publicPage.waitForURL('**/home.html');
      await publicPage.locator('#homeTitle').waitFor({state:'visible'});
      assert.equal(await publicPage.locator('#makeSiteLive').count(),0,'Public visitors do not get the launch control');
      await publicPage.goto(base+'admin.html');
      await publicPage.getByRole('heading',{name:'Admin sign in',exact:true}).waitFor();
      assert.equal(await publicPage.locator('#adminContent').isVisible(),false,'Publishing does not grant admin access');
      await publicContext.close(); await adminSession.context.close(); await context.close();
      const failureContext=await browser.newContext({serviceWorkers:'block'}),failurePage=await failureContext.newPage();
      await mocks(failureContext,{signedIn:false}); await launchMocks(failureContext,{live:false,unavailable:true});
      let protectedReads=0;
      failurePage.on('request',req=>{if(req.url().includes('/rest/v1/baseline_events'))protectedReads++;});
      await failurePage.goto(base+'events.html');
      await failurePage.getByRole('heading',{name:'The website is being prepared.',exact:true}).waitFor();
      assert.equal(protectedReads,0,'App data must not be requested when launch verification fails');
      await failureContext.close();
      report.push('PASS closed direct links, wrong passwords, preview access, publish confirmation, cancel, double-submit, global launch, admin protection and fail-closed access');
    }
    for (const [width,height,signedIn] of [[320,568,true],[390,844,false],[1365,900,true]]) {
      const {context,page,model,errors}=await setup(browser,{width,height,signedIn});
      const upcoming={...model.events[0],cover_url:base+'icon-logo.png'};
      model.events=[{...upcoming,id:996,date:'2027-05-01',name:'Past event'}, {...upcoming,id:997,date:'2027-06-01',cancelled:true,name:'Cancelled event'}, upcoming, {...upcoming,id:998,date:'2027-07-02',name:'July Golf Day'}];
      await page.goto(base+'home.html');
      await page.locator('[data-home-rsvp]').waitFor();
      assert.equal(await page.locator('#nextEvent h2').innerText(),upcoming.name,'Lead with the next available event');
      const aboveFold=await page.evaluate(()=>{
        const heading=document.querySelector('#nextEvent h2').getBoundingClientRect();
        const facts=document.querySelector('#nextEvent .simple-event-facts').getBoundingClientRect();
        const action=document.querySelector('[data-home-rsvp]').getBoundingClientRect();
        const welcome=document.querySelector('.simple-home-heading').getBoundingClientRect();
        const dock=document.querySelector('.mobile-dock');
        const bottom=getComputedStyle(dock).display==='none'?innerHeight:dock.getBoundingClientRect().top;
        return scrollY===0 && heading.top>=0 && heading.top<welcome.top && facts.bottom<bottom && action.bottom<=bottom;
      });
      assert(aboveFold,'Event, date, tee time and RSVP must be visible without scrolling');
      assert.equal(await page.getByRole('link',{name:'View the evening and manage your RSVP →',exact:true}).count(),0);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
      await page.screenshot({path:path.join(out,`event-first-${width}.png`)});
      if(signedIn) {
        upcoming.tee_published_at='2027-06-01T10:00:00Z';
        model.groups=[{group_number:1,tee_time:'09:30',players:[{user_id:uid,name:'Test Member',type:'walker'}]}];
        await page.reload();
        const teeLink=page.getByText('View other tee times',{exact:true});
        await teeLink.waitFor();
        const action=await teeLink.boundingBox();
        const bottom=width<=760?(await page.locator('.mobile-dock').boundingBox()).y:height;
        assert(action.y+action.height<=bottom,'Your published group and other tee times remain immediately actionable');
        await teeLink.click();
        await page.getByText('There are no other published tee groups for this event.',{exact:true}).waitFor();
      }
      upcoming.date='2027-05-31';
      await page.reload();
      await page.locator('#nextEvent h2').filter({hasText:'July Golf Day'}).waitFor();
      model.events=[];
      await page.reload();
      await page.getByRole('heading',{name:'The 2027 dates are on their way',exact:true}).waitFor();
      assert.equal(await page.locator('[data-home-rsvp]').count(),0);
      assert.deepEqual(errors,[]);
      await context.close();
      report.push(`PASS event-first homepage at ${width}x${height}: visible action, next-event selection, rollover, tee times and empty state`);
    }
    for (const [width,height] of [[390,844],[1365,900]]) {
      const {context,page,model,errors}=await setup(browser,{admin:true,width,height});
      const upcoming=model.events[0], published={...upcoming,id:998,name:'Round 2 – Kenilworth Golf Club',date:'2027-07-02',tee_published_at:'2027-06-01T10:00:00Z'};
      model.events=[{...published,id:996,date:'2027-05-01'}, {...published,id:997,date:'2027-06-01',cancelled:true}, {...published,id:995,name:'June society social',date:'2027-06-10',event_type:'social'}, upcoming, published, {...published,id:994,date:'2027-08-02'}];
      const own={group_number:2,tee_time:'10:16',players:people.slice(0,4).map((id,i)=>({user_id:i===3?null:id,participant_id:id,name:names[i],handicap:18+i,type:i===0?'buggy':'walker',avatar_path:i===3?id+'/photo.jpg':null}))};
      const other={group_number:1,tee_time:'10:08',players:[{user_id:people[4],name:names[4],handicap:15,type:'walker'}]};
      const publishedView={status:'published',round_number:2,revision:1,published_at:'2027-06-01T10:00:00Z',groups:[other,own]};
      model.teeView=publishedView;
      const reads=[];
      page.on('request',request=>{if(request.url().endsWith('/rpc/baseline_event_tee_groups'))reads.push(request.postDataJSON().event);});
      const group=page.locator('#homeTeeGroup'), toggle=group.locator('.all-tee-groups > summary');
      await page.goto(base+'home.html');
      await toggle.waitFor();
      assert.deepEqual(reads,[998],'Choose the nearest future published golf day, skipping cancelled, past, social and unpublished events');
      assert.match(await group.innerText(),/Kenilworth Golf Club/);
      assert.match(await group.innerText(),/2 July 2027/);
      assert.equal(await page.locator('#nextEvent h2').innerText(),'June society social','Keep the next event independently visible below the published schedule');
      assert.equal(await group.locator('.member-tee-card:visible').count(),1,'Only your group is expanded by default');
      assert.equal(await group.locator('.member-tee-card:visible .tee-clock').innerText(),'10:16','Own group is selected by signed-in member ID, not group order or admin role');
      assert.equal(await group.locator('.member-tee-card:visible li').count(),4);
      assert.match(await group.locator('.member-tee-card:visible').innerText(),/Test Member\s+\(you\)/);
      const layout=await page.evaluate(()=>{
        const panel=document.querySelector('#homeTeeGroup'), card=panel.querySelector('.member-tee-card'), button=panel.querySelector('summary');
        const dock=document.querySelector('.mobile-dock'), bottom=getComputedStyle(dock).display==='none'?innerHeight:dock.getBoundingClientRect().top;
        return {first:panel===document.querySelector('main').firstElementChild,below:button.getBoundingClientRect().top>=card.getBoundingClientRect().bottom,visible:scrollY===0&&button.getBoundingClientRect().bottom<=bottom,overflow:document.documentElement.scrollWidth>innerWidth+2};
      });
      assert.deepEqual(layout,{first:true,below:true,visible:true,overflow:false},'Four-player group and button fit above the fold');
      assert.equal(await page.locator('a[data-admin]:visible').count(),0);
      await page.screenshot({path:path.join(out,`home-published-group-${width}.png`)});
      await group.getByRole('button',{name:'Enlarge photo of Gary Example',exact:true}).click();
      await page.getByRole('dialog',{name:'Gary Example profile photo',exact:true}).waitFor();
      await page.getByRole('button',{name:'Close photo',exact:true}).click();
      await toggle.focus();await page.keyboard.press('Enter');
      await group.getByText('Tim Example',{exact:true}).waitFor();
      assert.equal(await group.locator('.all-tee-groups .member-tee-card').count(),1,'Other tee times excludes your already-visible group');
      assert.equal(await group.getByText('Test Member (you)',{exact:true}).count(),1);
      await page.screenshot({path:path.join(out,`home-other-tee-times-${width}.png`),fullPage:true});
      model.teeView={status:'reviewing',groups:[]};
      await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
      await group.getByText('The player list has changed. Organisers are reviewing the tee times.',{exact:true}).waitFor();
      assert.equal(await group.locator('.member-tee-card').count(),0,'Unconfirmed changes never leave stale groups on screen');
      model.teeView={...publishedView,revision:2,groups:[other,{...own,tee_time:'10:32'}]};
      await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
      await group.locator('.tee-clock').filter({hasText:'10:32'}).waitFor();
      await context.route(backend+'/rest/v1/rpc/baseline_event_tee_groups',route=>route.fulfill({status:503,json:{message:'Temporary tee group failure'}}));
      await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
      await group.getByText('Tee groups could not load. Refresh to try again.',{exact:true}).waitFor();
      await context.unroute(backend+'/rest/v1/rpc/baseline_event_tee_groups');
      await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
      await group.locator('.tee-clock').filter({hasText:'10:32'}).waitFor();
      model.teeView={...publishedView,groups:[other]};
      await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
      await group.getByText('You are not assigned to a published tee group for this event.',{exact:true}).waitFor();
      assert.equal(await group.locator('.member-tee-card:visible').count(),0,'Never label another member’s group as yours');
      await toggle.click();await group.getByText('Tim Example',{exact:true}).waitFor();
      await page.goto(base+'home.html?event=999');
      await page.locator('[data-home-rsvp]').waitFor();
      assert.equal(await group.isVisible(),false,'Explicit unpublished event links do not borrow a different event’s tee group');
      await page.goto(base+'home.html?event=998');await toggle.waitFor();
      assert.match(await group.innerText(),/Kenilworth Golf Club/);
      published.tee_published_at=null;model.events=model.events.filter(ev=>ev.id!==994);
      await page.goto(base+'home.html');await page.locator('[data-home-rsvp]').waitFor();
      assert.equal(await group.isVisible(),false,'Unpublishing removes the personal schedule');
      assert.deepEqual(errors,[]);
      await context.close();
      report.push(`PASS published homepage group ${width}: own four-player group above fold, later published event, inline other groups, portraits, member admin view, review/republish refresh, error recovery, unassigned member and unpublished state`);
    }
    {
      const {context,page,model,errors}=await setup(browser,{signedIn:false,width:390});
      model.events[0].tee_published_at='2027-06-01T10:00:00Z';
      let reads=0;page.on('request',request=>{if(request.url().includes('/rpc/baseline_event_tee_groups'))reads++;});
      await page.goto(base+'home.html');await page.locator('.simple-next-booking').getByRole('link',{name:'View tee times',exact:true}).waitFor();
      assert.equal(await page.locator('#homeTeeGroup').isVisible(),false);
      assert.equal(reads,0,'Signed-out visitors never request personal tee groups');
      assert.deepEqual(errors,[]);await context.close();
      report.push('PASS signed-out homepage keeps tee groups private');
    }
    for (const width of [390,900,901,1365]) {
      // A saved preference from the old toggle must never re-enable editing while filming.
      const {context,page,model,errors}=await setup(browser,{admin:true,width,memberView:false});
      model.board=resultBoard();
      const menu=page.locator(width<=900?'#menuToggle':'.admin-menu summary');
      const dashboard=page.getByRole('link',{name:'Admin dashboard',exact:true});
      let authChanges=0;
      page.on('request',req=>{ if(/\/auth\/v1\/(token|logout)/.test(req.url())) authChanges++; });
      await context.route(backend+'/storage/v1/object/list/baseline-gallery-images', route=>route.fulfill({json:[{id:'1',name:'photo.png'}]}));
      await context.route(backend+'/storage/v1/object/public/baseline-gallery-images/uploads/*', route=>route.fulfill({path:path.join(__dirname,'..','icon-logo.png'),contentType:'image/png'}));
      await page.goto(base+'home.html');
      await page.locator('[data-home-rsvp]').waitFor();
      assert.equal(await page.locator('a[data-admin]:visible').count(),0,'Admin account defaults to the member experience');
      assert.equal(await page.locator('.launch-preview-bar,#makeSiteLive').count(),0);
      assert.deepEqual(await page.evaluate(()=>({id:barford.state.user.id,role:barford.state.adminAccess,view:barford.state.admin})),{id:uid,role:true,view:false});
      assert.equal(await dashboard.count(),0,'Admin dashboard is hidden until Menu opens');
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2),'Closed navigation fits the screen');
      await page.screenshot({path:path.join(out,`filming-home-${width}.png`),fullPage:true});
      await menu.click();
      await dashboard.waitFor();
      assert.equal(await dashboard.count(),1,'Exactly one accessible Admin link');
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2),'Open menu fits the screen');
      await page.screenshot({path:path.join(out,`filming-menu-${width}.png`),fullPage:true});
      await page.keyboard.press('Escape');
      assert.equal(await dashboard.count(),0,'Escape closes the menu');
      assert(await menu.evaluate(el=>el===document.activeElement),'Escape returns focus to Menu');
      for(const name of ['events.html','event.html?id=999','account.html','gallery.html','scores.html']) {
        await page.goto(base+name);
        await page.evaluate(()=>window.barfordReady);
        assert.equal(await dashboard.count(),0,`Dashboard link stays inside Menu on ${name}`);
        assert.equal(await page.locator('a[data-admin]:visible').count(),0,`No admin links on ${name}`);
        assert.equal(await page.locator('.launch-preview-bar,#makeSiteLive').count(),0,`No launch controls on ${name}`);
        if(name==='account.html') {
          await page.locator('#profileForm').waitFor();
          assert.equal(await page.getByRole('link',{name:'Organiser tools',exact:true}).count(),0);
        }
        if(name==='gallery.html') {
          await page.locator('[data-photo]').waitFor();
          assert.equal(await page.locator('[data-delete]').count(),0,'Member view hides photo deletion');
        }
        if(name==='scores.html') {
          await page.locator('.season-table tbody tr').first().waitFor();
          assert.equal(await page.locator('.season-table .is-locked').count(),6,'Admin filming view redacts rounds 6 and 7');
          await page.locator('#roundDetails > summary').click();
          await page.locator('#leagueRound').selectOption('6');
          await page.locator('.round-locked').waitFor();
          assert.equal(await page.locator('.round-detail-table').count(),0);
        }
      }
      model.events[0].tee_published_at='2027-06-01T10:00:00Z';
      model.teeView={status:'published',round_number:7,provisional:true,groups:[{group_number:1,tee_time:'09:30',players:[{user_id:uid,name:'Test Member',handicap:17.4,handicap_secret:false,type:'walker'}]}]};
      await page.goto(base+'event.html?id=999');
      await page.locator('.member-tee-card').waitFor();
      assert.match(await page.locator('[data-member-tees]').innerText(),/Handicap held by organisers/);
      assert.doesNotMatch(await page.locator('[data-member-tees]').innerText(),/17\.4|Handicaps are provisional/,'Admin-only tee handicaps are masked in member view');
      model.teeView.round_number=6;
      await page.reload();
      await page.locator('.member-tee-card').waitFor();
      assert.match(await page.locator('[data-member-tees]').innerText(),/Round 6 HCP: 17\.4/,'Earlier starting handicaps remain visible to members');
      await menu.click();
      await dashboard.click();
      await page.waitForURL('**/admin.html');
      await page.locator('#adminContent').waitFor({state:'visible'});
      assert.equal(await page.evaluate(()=>barford.state.admin),true,'Menu opens the full admin dashboard');
      assert.equal(await page.locator('#memberViewToggle').count(),0,'No toggle can accidentally expose admin controls');
      assert.match(await page.locator('#memberViewStatus').innerText(),/always show the normal member view/);
      assert(await page.locator('#makeSiteLive').isVisible());
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2));
      await page.screenshot({path:path.join(out,`admin-site-controls-${width}.png`),fullPage:true});
      await page.locator('#openMemberView').click();
      await page.locator('#nextEvent .simple-next-copy h2').waitFor();
      await page.reload();
      await page.locator('#nextEvent .simple-next-copy h2').waitFor();
      assert.equal(await page.locator('a[data-admin]:visible').count(),0);
      assert.equal(await dashboard.count(),0);
      assert.equal(await page.locator('#makeSiteLive').count(),0);
      assert.equal(await page.evaluate(()=>barford.state.admin),false,'Leaving Admin restores the member view automatically');
      assert.equal(await page.evaluate(()=>barford.state.user.id),uid,'Switching view keeps the same account');
      assert.equal(authChanges,0,'Switching view never signs out or logs in to another account');
      assert.deepEqual(errors,[]);
      await context.close();
      report.push(`PASS filming at ${width}px: member pages, hidden scores/tee handicaps, Menu to Admin, keyboard close, stale preference ignored and unchanged sign-in`);
    }
    for (const signedIn of [true,false]) {
      const {context,page}=await setup(browser,{admin:false,memberView:false,signedIn,width:390});
      await page.goto(base+'home.html');
      await page.evaluate(()=>window.barfordReady);
      await page.locator('#menuToggle').click();
      assert.equal(await page.locator('[data-admin-menu]').count(),0,'Members and visitors never receive admin navigation');
      await page.goto(base+'admin.html');
      await page.getByRole('heading',{name:'Admin sign in',exact:true}).waitFor();
      assert.equal(await page.locator('#adminContent').isVisible(),false);
      assert.equal(await page.locator('#makeSiteLive,#memberViewToggle').count(),0,'A local display preference cannot grant admin access');
      await context.close();
    }
    for (const width of [320,390,1365]) {
      const {context,page,errors}=await setup(browser,{width,signedIn:false});
      let photos = [1,2,3].map(n=>({id:String(n),name:`photo-${n}.png`}));
      await context.route(backend+'/storage/v1/object/list/baseline-gallery-images', route=>route.fulfill({json:photos}));
      await context.route(backend+'/storage/v1/object/public/baseline-gallery-images/uploads/*', route=>route.fulfill({path:path.join(__dirname,'..','icon-logo.png'),contentType:'image/png'}));
      await page.goto(base+'home.html');
      await page.locator('#homeTitle').waitFor();
      const navigation = page.locator(width<761?'.mobile-dock':'.site-nav');
      await navigation.locator('a[href="gallery.html"]').click();
      await page.locator('#galleryGrid [data-photo]').first().waitFor();
      assert.equal(await page.locator('#galleryGrid [data-photo]').count(),3);
      assert.equal(await navigation.locator('a[aria-current="page"]').getAttribute('href'),'gallery.html');
      assert.equal(await page.locator('#uploadForm').isVisible(),false,'Browsing photos does not require member sign-in');
      assert.equal(await page.locator('#uploadGate a').getAttribute('href'),'account.html?next=gallery.html');
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2));
      if(width<761) {
        assert.equal(await page.locator('.mobile-dock a').count(),5);
        const fits=await page.locator('.mobile-dock a').evaluateAll(links=>links.every(a=>{
          const r=a.getBoundingClientRect(),label=a.querySelector('span').getBoundingClientRect();
          return r.width>=44 && r.height>=44 && label.left>=r.left && label.right<=r.right && r.right<=innerWidth;
        }));
        assert(fits,'All five bottom tabs have usable touch targets and unclipped labels');
      }
      await page.screenshot({path:path.join(out,`gallery-${width}.png`),fullPage:true});
      await page.locator('[data-photo="0"]').click();
      await page.locator('#lightboxImage').evaluate(img=>img.decode());
      assert.equal(await page.locator('#photoNumber').innerText(),'1 / 3');
      await page.getByRole('button',{name:'Next photo',exact:true}).click();
      assert.equal(await page.locator('#photoNumber').innerText(),'2 / 3');
      await page.locator('#lightbox').press('ArrowRight');
      assert.equal(await page.locator('#photoNumber').innerText(),'3 / 3');
      await page.locator('#lightboxImage').evaluate(image=>{
        const touch=(x,y)=>new Touch({identifier:1,target:image,clientX:x,clientY:y});
        image.dispatchEvent(new TouchEvent('touchstart',{touches:[touch(220,100)],bubbles:true}));
        image.dispatchEvent(new TouchEvent('touchend',{touches:[],changedTouches:[touch(80,104)],bubbles:true}));
      });
      assert.equal(await page.locator('#photoNumber').innerText(),'1 / 3','Swipe wraps through the gallery');
      await page.getByRole('button',{name:'Previous photo',exact:true}).click();
      assert.equal(await page.locator('#photoNumber').innerText(),'3 / 3');
      await page.locator('#lightbox').press('Escape');
      assert.equal(await page.locator('#lightbox').isVisible(),false);
      photos=[];
      await page.reload();
      await page.getByText('Our next memories go here.',{exact:true}).waitFor();
      assert.deepEqual(errors,[]);
      await context.close();
      report.push(`PASS gallery navigation, photo viewer, swipe, keyboard, empty state and layout at ${width}px`);
    }
    for (const width of [390,1365]) {
      const {context,page,model,errors}=await setup(browser,{width});
      await page.goto(base+'home.html');
      await page.locator('[data-home-rsvp]').waitFor();
      assert.equal(await page.locator('header img.brand-lockup').count(),1,'Member header uses the same new Barford emblem');
      await page.locator('header img.brand-lockup').evaluate(img => img.decode());
      assert.equal(await page.locator('.more-nav').count(),0);
      assert.equal(await page.locator('a[data-admin]:visible').count(),0);
      assert.equal(await page.locator('#homeHoles').count(),1);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2));
      await page.screenshot({path:path.join(out,`home-${width}.png`),fullPage:true});
      // Open the real lazy-loaded picker before the event day; no map provider is needed until a hole is selected.
      const courseLayout = {
        id: '99999999-9999-4999-8999-999999999999', name: 'The Warwickshire', tee_name: 'Yellow', ready_count: 18,
        holes: Array.from({length:18}, (_, i) => ({number:i+1, par:4, stroke_index:i+1, yards:365, reviewed:true,
          tee:{lat:52.0001+i*.0001,lng:-1.5},green:{lat:52.0031+i*.0001,lng:-1.5}})),
      };
      const holeCalls = [];
      await context.route(backend+'/rest/v1/rpc/baseline_course_layout', route => {
        const body = route.request().postDataJSON();
        if(body.action !== 'event') return route.fallback();
        holeCalls.push(body);
        return route.fulfill({json:{layout:courseLayout}});
      });
      await page.locator('#homeHoles').evaluate(button => { button.click(); button.click(); });
      await page.locator('[data-hole-grid] button').first().waitFor();
      assert.equal(await page.locator('dialog.hole-dialog').count(),1);
      assert.equal(await page.locator('[data-hole-grid] button').count(),18);
      assert.equal(await page.locator('[data-hole-grid] button:disabled').count(),0);
      assert.equal(holeCalls.length,1);
      assert.equal(holeCalls[0].payload.event_id,999);
      assert.match(await page.locator('[data-hole-readiness]').innerText(),/All 18 holes ready/);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2));
      await page.screenshot({path:path.join(out,`hole-picker-${width}.png`),fullPage:true});
      await page.locator('[data-hole-close]').click();
      await page.locator('dialog.hole-dialog').waitFor({state:'detached'});
      // A fast double tap must produce one dialog, then one network submission.
      await page.locator('#homeRsvp').evaluate(button => { button.click(); button.click(); });
      await page.locator('dialog [name=attending][value=yes]').check();
      assert.equal(await page.locator('dialog.rsvp-dialog').count(),1);
      await page.locator('dialog form').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
      await page.locator('dialog').waitFor({state:'detached'});
      assert.equal(model.responses.length,1);
      assert.equal(model.rsvpAttempts,1,'Double submit must send one request');
      assert.equal(model.responses[0].user_id,uid);
      await page.locator('#homeRsvp').click();
      await page.locator('dialog [name=buggy]').check();
      await page.locator('dialog button[type=submit]').click();
      await page.locator('dialog').waitFor({state:'detached'});
      assert.equal(model.responses.length,1,'Editing RSVP must retain one booking');
      assert.equal(model.responses[0].buggy,true);
      model.rsvpFailure=true;
      await page.locator('#homeRsvp').click();
      await page.locator('dialog [name=buggy]').uncheck();
      await page.locator('dialog button[type=submit]').click();
      await page.locator('dialog .form-status').filter({hasText:'Unable to save'}).waitFor();
      assert.equal(model.responses[0].buggy,true,'Failed save must not report a changed booking');
      assert.equal(await page.locator('dialog [name=buggy]').isChecked(),false,'Keep unsaved form values for retry');
      await page.locator('dialog button[type=submit]').click();
      await page.locator('dialog').waitFor({state:'detached'});
      assert.equal(model.responses.length,1);
      assert.equal(model.responses[0].buggy,false);
      // Event details use the same saved RSVP, without sending the member back to Home.
      await page.goto(base+'event.html?id=999');
      await page.locator('[data-rsvp]').waitFor();
      await page.locator('[data-rsvp]').click();
      await page.locator('dialog [name=attending][value=no]').check();
      await page.locator('dialog button[type=submit]').click();
      await page.locator('dialog').waitFor({state:'detached'});
      assert.equal(model.responses.length,1);
      assert.equal(model.responses[0].attending,false);
      await page.locator('[data-rsvp]').click();
      await page.locator('dialog [name=attending][value=yes]').check();
      await page.locator('dialog button[type=submit]').click();
      await page.locator('dialog').waitFor({state:'detached'});
      assert.equal(model.responses.length,1);
      assert.equal(model.responses[0].attending,true);
      await page.locator('[data-hole-view]').click();
      await page.locator('[data-hole-grid] button').first().waitFor();
      assert.equal(await page.locator('[data-hole-grid] button').count(),18);
      await page.locator('[data-hole-close]').click();
      await page.locator('dialog.hole-dialog').waitFor({state:'detached'});
      model.events[0].tee_published_at='2027-06-01T12:00:00Z';
      model.groups=[{event_id:999,group_number:1,tee_time:'10:00',players:[{user_id:uid,name:'Test Member',type:'walker'}]}];
      await page.goto(base+'home.html');
      await page.locator('#homeRsvp strong').filter({hasText:'Tee times'}).waitFor();
      assert.equal(await page.locator('[data-home-rsvp]').count(),0);
      assert.match(await page.locator('#nextEvent').innerText(),/contact the committee/i);
      await page.goto(base+'events.html');
      await page.locator('a[href*="event.html?id=999"]').first().waitFor();
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2));
      await page.screenshot({path:path.join(out,`events-${width}.png`),fullPage:true});
      await page.goto(base+'event.html?id=999');
      await page.locator('#main').getByText('The Warwickshire Golf Day',{exact:true}).first().waitFor();
      await page.screenshot({path:path.join(out,`event-${width}.png`),fullPage:true});
      assert.deepEqual(errors,[]);
      report.push(`PASS ${width}px: home/events, 18-hole picker before event day, double tap/submit guards, one RSVP, direct event edit/retry, tee publication lock and no page overflow`);
      await context.close();
    }

    {
      const {context,page,model,errors}=await setup(browser,{signedIn:true});
      for(const requested of ['', 'abc', '0', '-1', '1.5', '9007199254740993', '998']) {
        await page.goto(base+'home.html?event='+encodeURIComponent(requested)+'#rsvp');
        await page.locator('#nextEvent').getByText('Event unavailable',{exact:true}).waitFor();
        assert.equal(await page.locator('dialog.rsvp-dialog').count(),0);
        assert.equal(await page.locator('[data-home-rsvp]').count(),0);
        assert.equal(model.rsvpAttempts || 0,0,'An invalid event link must never RSVP to the next event');
      }
      assert.deepEqual(errors,[]);
      report.push('PASS missing, malformed, unsafe and absent event IDs fail closed without RSVP fallback');
      await context.close();
    }

    for (const admin of [false,true]) {
      const {context,page,model,errors}=await setup(browser,{admin,width:390,memberView:false});
      model.board=resultBoard(); // Deliberately contains all seven: member UI must still fail closed.
      await page.goto(base+'scores.html');
      await page.locator('.season-table tbody tr').first().waitFor();
      assert.equal(await page.locator('.season-table tbody tr').count(),2);
      const totalBox = await page.locator('.season-table tbody .total-col').first().boundingBox();
      assert(totalBox.x + totalBox.width <= page.viewportSize().width, 'Season total must be visible on a phone without scrolling');
      assert.equal(await page.locator('.season-table .is-locked').count(),6,'The ordinary leaderboard always uses member visibility');
      assert.deepEqual(await page.locator('.season-table tbody .total-col').allTextContents(),['176','164']);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2));
      await page.locator('#roundDetails > summary').click();
      await page.locator('#leagueRound').selectOption('6');
      await page.locator('.round-locked').waitFor();
      assert.equal(await page.locator('.round-detail-table').count(),0);
      await page.screenshot({path:path.join(out,`leaderboard-${admin?'admin':'member'}.png`),fullPage:true});
      if(admin) {
        await page.evaluate(()=>window.barford.raw.auth.signOut());
        await page.locator('#leagueVisibility').filter({hasText:'Member totals'}).waitFor();
        assert.equal(await page.locator('.season-table .is-locked').count(),6);
        assert.equal(await page.locator('.round-detail-table').count(),0);
        assert.equal(await page.locator('[data-admin-menu]').count(),0,'Signing out removes dashboard navigation');
      }
      assert.deepEqual(errors,[]);
      report.push(`PASS ${admin?'admin':'member'} leaderboard, best-five totals, hidden rounds, sign-out redaction`);
      await context.close();
    }

    {
      const {context,page,errors}=await setup(browser,{admin:true,signedIn:false});
      await page.goto(base+'admin.html?tab=scoring');
      await page.locator('#adminGate a.button').click();
      await page.locator('#loginForm [name=email]').fill('Test Member');
      await page.locator('#loginForm [name=password]').fill('fixture-password-only');
      await page.locator('#loginForm button').first().click();
      await page.waitForURL('**/admin.html?tab=scoring');
      await page.locator('#adminScoring').waitFor({state:'visible'});
      assert.deepEqual(errors,[]);
      report.push('PASS sign in resumes the requested Scores admin tab');
      await context.close();
    }

    const {context,page,model,errors}=await setup(browser,{admin:true});
    model.league={revision:0,players:people.map((id,i)=>({id,name:names[i],starting_handicap:20,adjustments:[]})),rounds:[]};
    model.responses=people.map((id,i)=>({id:i+1,event_id:999,user_id:id,name:names[i],attending:true,reserve:false,buggy:false}));
    await page.goto(base+'admin.html?tab=scoring');
    await page.locator('[data-score]').first().waitFor();
    assert.equal(await page.locator('.admin-tabs [data-tab]').count(),5);
    assert.equal(await page.locator('#completeRound').isDisabled(),true);
    for(let i=0;i<4;i++) await page.locator(`[data-score="${people[i]}"]`).fill(String([40,35,30,25][i]));
    await page.locator(`[data-dnp="${people[4]}"]`).check();
    assert.equal(await page.locator('#completeRound').isDisabled(),false);
    await page.screenshot({path:path.join(out,'admin-score-entry.png'),fullPage:true});
    model.roundFail=true;
    await page.locator('#saveRoundDraft').click();
    await page.locator('#roundScoreForm .form-status').filter({hasText:'Connection interrupted'}).waitFor();
    assert.equal(await page.locator(`[data-score="${people[0]}"]`).inputValue(),'40');
    await page.locator('#saveRoundDraft').click();
    await page.locator('#scoreSaveState').filter({hasText:/saved/i}).waitFor();
    assert.equal(model.roundSave.publish,false);
    assert.equal(model.roundSave.entries.length,5);
    await page.locator('#completeRound').click();
    await page.locator('#scoreSaveState').filter({hasText:/complete/i}).waitFor();
    assert.equal(model.roundSave.publish,true);
    assert.equal(model.roundSave.expected_revision,1);
    await page.locator(`[data-score="${people[1]}"]`).fill('40');
    assert.equal(await page.locator('#completeRound').isDisabled(),true,'Tied winner must be chosen explicitly');
    await page.locator('#roundWinner').selectOption(people[0]);
    assert.equal(await page.locator('#completeRound').isDisabled(),false);
    await page.locator(`[data-score="${people[2]}"]`).fill('30.5');
    assert.equal(await page.locator('#saveRoundDraft').isDisabled(),true);
    assert.equal(await page.locator('#completeRound').isDisabled(),true);
    assert.deepEqual(errors,[]);
    report.push('PASS admin: five tabs, direct score grid, incomplete/tie/invalid guards, failed-save retry, draft and complete revision flow');
    await context.close();
  } finally {
    fs.writeFileSync(path.join(out,'simple-checks.json'),JSON.stringify(report,null,2));
    console.log(report.join('\n'));
    await browser.close();
    server.close();
  }
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
