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
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2),true);
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
        await page.reload();
        const teeLink=page.locator('.simple-next-booking').getByRole('link',{name:'View tee times',exact:true});
        await teeLink.waitFor();
        const action=await teeLink.boundingBox();
        const bottom=width<=760?(await page.locator('.mobile-dock').boundingBox()).y:height;
        assert(action.y+action.height<=bottom,'Published tee times remain immediately actionable');
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
    for (const width of [390,1365]) {
      const {context,page,model,errors}=await setup(browser,{admin:true,width});
      model.board=resultBoard();
      let authChanges=0;
      page.on('request',req=>{ if(/\/auth\/v1\/(token|logout)/.test(req.url())) authChanges++; });
      await context.route(backend+'/storage/v1/object/list/baseline-gallery-images', route=>route.fulfill({json:[{id:'1',name:'photo.png'}]}));
      await context.route(backend+'/storage/v1/object/public/baseline-gallery-images/uploads/*', route=>route.fulfill({path:path.join(__dirname,'..','icon-logo.png'),contentType:'image/png'}));
      await page.goto(base+'home.html');
      await page.locator('[data-home-rsvp]').waitFor();
      assert.equal(await page.locator('a[data-admin]:visible').count(),0,'Admin account defaults to the member experience');
      assert.equal(await page.locator('.launch-preview-bar,#makeSiteLive').count(),0);
      assert.deepEqual(await page.evaluate(()=>({id:barford.state.user.id,role:barford.state.adminAccess,view:barford.state.admin})),{id:uid,role:true,view:false});
      await page.screenshot({path:path.join(out,`filming-home-${width}.png`),fullPage:true});
      for(const name of ['events.html','event.html?id=999','account.html','gallery.html','scores.html']) {
        await page.goto(base+name);
        await page.evaluate(()=>window.barfordReady);
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
      await page.goto(base+'admin.html');
      await page.locator('#adminContent').waitFor({state:'visible'});
      assert(await page.locator('#memberViewToggle').isChecked());
      assert(await page.locator('#makeSiteLive').isVisible());
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2));
      await page.screenshot({path:path.join(out,`admin-site-controls-${width}.png`),fullPage:true});
      await page.locator('#memberViewToggle').uncheck();
      await page.getByText('Admin controls are visible on member pages.',{exact:true}).waitFor();
      await page.locator('#openMemberView').click();
      await page.locator('a.simple-admin-action').waitFor({state:'visible'});
      assert.equal(await page.locator('#makeSiteLive').count(),0,'Launch remains in Admin even when member view is off');
      await page.goto(base+'gallery.html');
      await page.locator('[data-delete]').waitFor();
      await page.goto(base+'scores.html');
      await page.locator('.season-table tbody tr').first().waitFor();
      assert.equal(await page.locator('.season-table .is-locked').count(),0);
      await page.goto(base+'admin.html');
      await page.locator('#memberViewToggle').waitFor({state:'visible'});
      assert.equal(await page.locator('#memberViewToggle').isChecked(),false,'View preference survives navigation');
      await page.locator('#memberViewToggle').check();
      await page.locator('#openMemberView').click();
      await page.locator('[data-home-rsvp]').waitFor();
      await page.reload();
      await page.locator('[data-home-rsvp]').waitFor();
      assert.equal(await page.locator('a[data-admin]:visible').count(),0);
      assert.equal(await page.evaluate(()=>barford.state.user.id),uid,'Switching view keeps the same account');
      assert.equal(authChanges,0,'Switching view never signs out or logs in to another account');
      assert.deepEqual(errors,[]);
      await context.close();
      report.push(`PASS admin member-view default, hidden controls/rounds, persistent switch and unchanged sign-in at ${width}px`);
    }
    {
      const {context,page}=await setup(browser,{admin:false,memberView:false});
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
      assert.equal(await page.locator('.season-table .is-locked').count(),admin?0:6);
      if(admin) assert.deepEqual(await page.locator('.season-table tbody .total-col').allTextContents(),['176','164']);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2));
      await page.locator('#roundDetails > summary').click();
      await page.locator('#leagueRound').selectOption('6');
      if(!admin) {
        await page.locator('.round-locked').waitFor();
        assert.equal(await page.locator('.round-detail-table').count(),0);
      }
      await page.screenshot({path:path.join(out,`leaderboard-${admin?'admin':'member'}.png`),fullPage:true});
      if(admin) {
        await page.evaluate(()=>window.barford.raw.auth.signOut());
        await page.locator('#leagueVisibility').filter({hasText:'Member totals'}).waitFor();
        assert.equal(await page.locator('.season-table .is-locked').count(),6);
        assert.equal(await page.locator('.round-detail-table').count(),0);
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
