const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const root=path.resolve(__dirname,'..');
const out=path.join(root,'test-results');fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{
 const target=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
 if(!target.startsWith(root+path.sep)||!fs.existsSync(target)||!fs.statSync(target).isFile()){res.writeHead(404);return res.end();}
 const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'}[path.extname(target)]||'application/octet-stream';
 res.setHeader('Content-Type',type);fs.createReadStream(target).pipe(res);
});
(async()=>{
 await new Promise(r=>server.listen(8765,'127.0.0.1',r));
 const browser=await chromium.launch();
 const report=[];
 try{
  for(const width of [390,1365]){
   const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
   const page=await context.newPage();
   let errors=[];page.on('pageerror',e=>errors.push(e.message));
   const connections=[];
   page.on('request',r=>{if(r.url().includes('.supabase.co'))connections.push(r.url());});
   for(const name of ['index','events','worldevents','scores','shop','gallery','about','signup']){
    errors=[];
    await page.goto(`http://127.0.0.1:8765/${name}.html`);
    await page.waitForFunction(()=>Boolean(window.barford));
    if(name==='events'||name==='worldevents')await page.getByText('No events yet.',{exact:true}).waitFor();
    if(name==='scores')await page.getByText('No players added for 2027 yet.',{exact:true}).waitFor();
    if(name==='gallery')await page.getByText('No photos yet',{exact:true}).waitFor();
    if(name==='shop')await page.getByText('No products available yet.',{exact:true}).waitFor();
    if(name==='signup')await page.getByText('Sign in to view enquiries.',{exact:true}).waitFor();
    assert.equal(await page.locator('.site-nav a').count(),8,`${name} navigation`);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);
    assert.equal(overflow,false,`${name} overflows at ${width}px`);
    assert.deepEqual(errors,[],`${name}: ${errors.join('; ')}`);
    await page.screenshot({path:path.join(out,`${name}-${width}.png`),fullPage:true});
    report.push({page:name,width,status:'passed'});
   }
   assert(connections.every(u=>new URL(u).hostname==='xspzmthygrajzktydvvj.supabase.co'),'Unexpected backend connection');
   await page.goto('http://127.0.0.1:8765/events.html');
   await page.getByText('No events yet.',{exact:true}).waitFor();
   await page.getByRole('button',{name:'🔐 Admin Access',exact:true}).click();
   await page.getByRole('dialog').waitFor();
   assert(await page.getByLabel('Email',{exact:true}).isVisible());
   assert(await page.getByLabel('Password',{exact:true}).isVisible());
   await page.getByRole('button',{name:'Cancel',exact:true}).click();
   // Exercise the copied RSVP form without creating any backend records.
   const event={id:999,name:'Replica QA event',date:'2027-06-01',location:'QA course',price:'£45',description:'A test event',max_players:24,first_time:'10:00',cancelled:false};
   await page.route('**/rest/v1/baseline_events?**',r=>r.fulfill({json:r.request().url().includes('id=eq.')?event:[event]}));
   await page.route('**/rest/v1/baseline_rsvps?**',r=>r.fulfill({json:[]}));
   await page.route('**/rest/v1/baseline_tee_times?**',r=>r.fulfill({json:[]}));
   let payload;
   await page.route('**/rest/v1/rpc/baseline_submit_rsvp',r=>{payload=r.request().postDataJSON();return r.fulfill({json:{id:999,reserve:false}})});
   await page.reload();
   await page.getByRole('button',{name:'📝 RSVP to this event'}).click();
   await page.locator('#name_999').fill('QA player');
   await page.locator('#playing_999').selectOption('yes');
   await page.locator('#buggy_999').selectOption('no');
   await page.locator('#phone_999').fill('07000000000');
   await page.getByRole('button',{name:'Submit RSVP',exact:true}).click();
   await page.getByText('✅ RSVP saved.',{exact:true}).waitFor();
   assert.equal(payload.payload.event_id,999);assert.equal(payload.payload.name,'QA player');
   await context.close();
  }
  fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify(report,null,2));
  console.log(`${report.length} page/viewport checks passed; admin authentication gate, RSVP form and isolated backend checked.`);
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
