/* Existing CI browser environment; synthetic API and map provider responses only. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {mocks,fixture,server,base,backend,uid}=require('./baseline.cjs');
const out=path.join(__dirname,'..','test-results'),report=[];
const other='22222222-2222-4222-8222-222222222222',preview='a'.repeat(64);
const layout={name:'Test overhead course',tee_name:'Yellow',source:{attribution:'OpenStreetMap'},holes:Array.from({length:18},(_,i)=>({number:i+1,par:4,yards:365,stroke_index:i+1,reviewed:true,tee:{lat:52.0001+i*.0001,lng:-1.5},green:{lat:52.0031+i*.0001,lng:-1.5},front:{lat:52.003,lng:-1.5},back:{lat:52.0032,lng:-1.5}}))};
(async()=>{
 await new Promise(resolve=>server.listen(8765,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});
 try{
  for(const width of [320,390,1365]){
   const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block',locale:'en-GB'}),model=await mocks(context,{signedIn:true,admin:true});
   model.profile.is_admin=true;
   model.events=[{...fixture,event_type:'pairs',round_number:null,member_price:40,guest_price:50,first_time:'10:00',tee_interval:8,tee_published_at:'2027-06-01T12:00:00Z',tee_revision:1,place_id:'existing-course',course_name:'Test course',course_layout_id:'retained-layout'}];
   model.responses=[{id:1,event_id:999,user_id:uid,participant_id:uid,name:'Test Member',attending:true,reserve:false,buggy:false},{id:2,event_id:999,user_id:other,participant_id:other,name:'Other Member',attending:true,reserve:false,buggy:false}];
   model.groups=model.responses.map((r,i)=>({event_id:999,group_number:i+1,tee_time:i?'10:08':'10:00',players:[{user_id:r.user_id,participant_id:r.user_id,name:r.name,type:'walker'}]}));
   await context.addInitScript(token=>sessionStorage.setItem('barford-2027-preview-session',token),preview);
   await context.route(backend+'/rest/v1/rpc/baseline_site_gate',route=>route.fulfill({json:{live:false,preview:true}}));
   await context.route(backend+'/rest/v1/rpc/baseline_course_layout',route=>route.request().postDataJSON().action==='event'?route.fulfill({json:{layout}}):route.fulfill({status:503,json:{message:'Map preview temporarily unavailable'}}));
   let failSave=false,saves=0,lastPayload;
   await context.route(backend+'/rest/v1/baseline_events*',async route=>{
    if(route.request().method()!=='PATCH')return route.fallback();
    if(failSave)return route.fulfill({status:400,json:{message:'These tee times would run into another day. Use an earlier start or shorter gap'}});
    const body=route.request().postDataJSON(),event=model.events[0];lastPayload=body;saves++;
    if(body.first_time!==event.first_time||body.tee_interval!==event.tee_interval){const mins=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5)),start=mins(body.first_time),offset=start-mins(model.groups[0].tee_time);model.groups.forEach((g,i)=>{const n=body.tee_interval!==event.tee_interval?start+i*body.tee_interval:mins(g.tee_time)+offset;g.tee_time=String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');});event.tee_revision++;}
    Object.assign(event,body);return route.fulfill({json:event});
   });
   await installMap(context);
   const page=await context.newPage(),errors=[];page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base+'admin.html?event=999');await page.locator('#adminContent:not([hidden])').waitFor();await page.locator('[data-course-preparation]').filter({hasText:'saved map will be kept'}).waitFor();
   assert.equal(await page.locator('[name=first_time]').isEditable(),true);
   await page.locator('[name=first_time]').fill('11:00');await page.locator('[name=name]').fill('Changed after tee publication');await page.locator('[name=date]').fill('2027-06-26');await page.locator('#saveEvent').click();
   await page.locator('.form-status').filter({hasText:'Event and published tee times updated'}).waitFor();assert.equal(saves,1);assert.equal(lastPayload.course_layout_id,'retained-layout');assert.equal(model.responses.length,2);
   await page.locator('#tabTees').click();await page.locator('#teeEditor [data-time="1"]').waitFor();assert.deepEqual(await page.locator('#teeEditor [data-time]').evaluateAll(nodes=>nodes.map(n=>n.value)),['11:00','11:08']);
   assert.deepEqual(await page.locator('#teeEditor [data-player]').evaluateAll(nodes=>nodes.map(n=>n.dataset.player)),[uid,other]);
   // A pending manual draft survives saving the event and moves with the new start.
   await page.locator('#teeEditor [data-time="1"]').fill('11:12');await page.locator('#teeEditor [data-time="1"]').dispatchEvent('change');await page.locator('#editEventDetails').click();
   await page.locator('[name=first_time]').fill('12:00');await page.locator('#saveEvent').click();await page.locator('.form-status').filter({hasText:'Your unsaved group changes are still in Tee times'}).waitFor();
   await page.locator('#tabTees').click();assert.deepEqual(await page.locator('#teeEditor [data-time]').evaluateAll(nodes=>nodes.map(n=>n.value)),['12:00','12:12']);assert.match(await page.locator('#teeSaveState').innerText(),/Unsaved/);
   await page.locator('#editEventDetails').click();failSave=true;await page.locator('[name=first_time]').fill('23:58');await page.locator('#saveEvent').click();await page.locator('.form-status').filter({hasText:'another day'}).waitFor();assert.equal(model.events[0].first_time,'12:00');assert.equal(await page.locator('[name=first_time]').inputValue(),'23:58');
   failSave=false;await page.locator('[name=first_time]').fill('12:00');await page.locator('[name=description]').fill('Updated meeting information');await page.locator('#saveEvent').click();await page.locator('.form-status').filter({hasText:'Event saved.'}).waitFor();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.locator('#adminDetails').screenshot({path:path.join(out,`editable-event-${width}.png`)});
   // Map access, rotation and live GPS survive removal of the camera finder.
   page.on('dialog',dialog=>dialog.accept());await page.goto(base+'event.html?id=999');await page.locator('[data-hole-view]').click();await page.locator('[data-hole="1"]').click();await page.waitForFunction(()=>window.__maps.instances.length===1);
   assert.equal(await page.locator('[data-find-green]').count(),0);assert.equal(await page.locator('video').count(),0);assert.equal(await page.evaluate(()=>window.gpsWatches),0);assert.equal(await page.evaluate(()=>window.cameraCalls),0);
   const heading=await page.evaluate(()=>window.__maps.instances[0].getHeading());await page.locator('[data-hole-rotate-right]').click();assert.notEqual(await page.evaluate(()=>window.__maps.instances[0].getHeading()),heading);await page.locator('[data-hole-fit]').click();assert.equal(await page.evaluate(()=>window.__maps.instances[0].getHeading()),heading);
   await page.locator('[data-gps-toggle]').click();await page.locator('[data-distance-origin].is-live').waitFor();assert.equal(await page.evaluate(()=>window.gpsWatches),1);assert.match(await page.locator('[data-gps-status]').innerText(),/GPS is live/);
   await page.evaluate(()=>google.maps.event.trigger(window.__maps.instances[0],'click',{latLng:new google.maps.LatLng(52.0011,-1.5)}));assert(await page.locator('[data-target-distances]').isVisible());
   await page.locator('[data-hole-next]').click();assert.equal(await page.locator('[data-hole-title]').innerText(),'Hole 2');assert.equal(await page.evaluate(()=>window.__maps.instances.length),1);
   await page.locator('dialog.hole-dialog').screenshot({path:path.join(out,`overhead-hole-${width}.png`)});assert(await page.locator('dialog.hole-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
   await page.locator('[data-hole-close]').click();await page.locator('dialog.hole-dialog').waitFor({state:'detached'});assert.equal(await page.evaluate(()=>window.gpsClears),1);assert.equal(await page.evaluate(()=>window.cameraCalls),0);assert.deepEqual(errors,[]);
   report.push(`PASS ${width}px: published event editing, map-service failure, saved map/groups preserved, pending draft retained, failed save retained, overhead map/rotation/GPS/target/navigation without camera`);await context.close();
  }
  fs.writeFileSync(path.join(out,'editable-events.json'),JSON.stringify(report,null,2));console.log(report.join('\n'));
 }finally{
  if(report.length<3)for(const context of browser.contexts())for(const page of context.pages()){
   await page.screenshot({path:path.join(out,'editable-events-failure.png'),fullPage:true}).catch(()=>{});
   fs.writeFileSync(path.join(out,'editable-events-failure.txt'),await page.locator('body').innerText().catch(()=>''));
  }
  await browser.close();await new Promise(resolve=>server.close(resolve));
 }
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});

async function installMap(context) {
 await context.addInitScript(() => {
    window.__maps = { instances: [], lines: [] };
    class LatLng { constructor(a, b) { this.point = typeof a === "object" ? a : { lat: a, lng: b }; } lat() { return typeof this.point.lat === "function" ? this.point.lat() : this.point.lat; } lng() { return typeof this.point.lng === "function" ? this.point.lng() : this.point.lng; } toJSON() { return { lat: this.lat(), lng: this.lng() }; } }
    class MapMock {
      constructor(node, settings) { this.node = node; this.settings = { ...settings }; this.listeners = {}; this.pane = document.createElement("div"); this.pane.className = "mock-map-pane"; this.pane.style.cssText = "position:relative;overflow:hidden;width:100%;height:100%;background:#244c45"; node.append(this.pane); window.__maps.instances.push(this); }
      addListener(type, listener) { this.listeners[type] = listener; return { remove: () => delete this.listeners[type] }; }
      setOptions(settings) { Object.assign(this.settings, settings); }
      setCenter(center) { this.settings.center = center; }
      panTo(center) { this.settings.center = center; }
      setZoom(zoom) { this.settings.zoom = zoom; }
      getZoom() { return this.settings.zoom || 17; }
      setHeading(heading) { this.settings.heading = heading; }
      getHeading() { return this.settings.heading || 0; }
      setTilt(tilt) { this.settings.tilt = tilt; }
      getTilt() { return this.settings.tilt || 0; }
      getCenter() { return new LatLng(this.settings.center); }
      getDiv() { return this.node; }
      getProjection() { return { fromLatLngToPoint: point => ({ x: point.lng(), y: point.lat() }) }; }
      fitBounds(bounds) { this.bounds = bounds; }
      moveCamera(settings) { this.setOptions(settings); }
    }
    class OverlayView {
      setMap(map) { if (this.map && this.onRemove) this.onRemove(); this.map = map; if (map) { this.onAdd?.(); this.draw?.(); } }
      getMap() { return this.map; }
      getPanes() { return { overlayMouseTarget: this.map.pane, overlayLayer: this.map.pane, floatPane: this.map.pane }; }
      getProjection() { return { fromLatLngToDivPixel: p => ({ x: (p.lng() + 1.502) * 100000, y: (52.004 - p.lat()) * 100000 }), fromDivPixelToLatLng: p => new LatLng(52.004 - p.y / 100000, p.x / 100000 - 1.502) }; }
      static preventMapHitsAndGesturesFrom() {}
    }
    class Polyline { constructor(settings) { this.settings = settings; window.__maps.lines.push(this); } setMap(map) { this.settings.map = map; } setPath(points) { this.settings.path = points; } setOptions(settings) { Object.assign(this.settings, settings); } }
    class LatLngBounds { constructor() { this.points = []; } extend(point) { this.points.push(point); return this; } }
    const maps = { Map: MapMock, OverlayView, Polyline, LatLng, LatLngBounds, MapTypeId: { SATELLITE: "satellite" }, RenderingType: { VECTOR: "VECTOR", RASTER: "RASTER" }, event: { clearInstanceListeners() {}, removeListener(listener) { listener.remove?.(); }, trigger(obj, type, value) { obj.listeners?.[type]?.(value); } } };
    maps.importLibrary = async () => { return maps; };
    window.google = { maps };
  window.gpsWatches=0;window.gpsClears=0;window.cameraCalls=0;
  Object.defineProperty(navigator,'geolocation',{configurable:true,value:{watchPosition(ok){window.gpsWatches++;queueMicrotask(()=>ok({coords:{latitude:52.001,longitude:-1.5,accuracy:6},timestamp:Date.now()}));return 7;},clearWatch(){window.gpsClears++;}}});
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia(){window.cameraCalls++;throw new Error('Camera must not be requested');}}});
 });
}
