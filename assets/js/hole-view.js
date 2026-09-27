import {createHoleMap,normaliseHole,coordinates,distanceMetres,yardsBetween} from "./hole-map.js?v=2027-green-finder-test-4";

const MAX_FIX_AGE=30000,MAX_ACCURACY=150; // Temporary off-course test threshold.
let activeDialog;
export function openHolePicker(event,b,preparedLayout=null) {
  // A prepared map is only an organiser preview. Members always use the event
  // RPC, which withholds coordinates until an organiser confirms the course.
  const preview=!!preparedLayout&&b.state?.admin===true;
  if(activeDialog?.open){activeDialog.focus();return activeDialog;}
  const dialog=document.createElement("dialog");
  dialog.className="hole-dialog";
  dialog.setAttribute("aria-label","View hole");
  dialog.innerHTML=`<div class="hole-dialog-top"><div><span class="eyebrow">ON THE COURSE</span><h2>Choose your hole</h2><p>${b.escape(event.name||"Today's round")}</p></div><button type="button" class="secondary" data-hole-close>Close</button></div><div data-hole-loading role="status" class="hole-load">Loading the course…</div><section data-hole-picker hidden><p class="hole-picker-note">Tap a hole, then choose the satellite map or camera direction guide.</p><div class="hole-number-grid" data-hole-grid></div><p class="hole-picker-note" data-hole-readiness></p></section><p class="hole-map-attribution" data-hole-source hidden></p><section data-hole-screen hidden><div class="hole-screen-heading"><div><h2 data-hole-title></h2><p data-hole-course></p></div><button type="button" class="secondary" data-hole-grid-back>All holes</button></div><div class="hole-stats" data-hole-stats></div><div class="hole-mode-choices"><div class="hole-mode-intro"><strong>Find the green</strong><span>Choose the view that helps your shot.</span></div><button type="button" class="hole-mode-camera" data-find-green><span aria-hidden="true">◎</span><span><strong>Camera direction</strong><small>Point your phone towards the green centre</small></span><span aria-hidden="true">→</span></button><div class="hole-mode-map"><strong>Satellite map & distances</strong><span>See the hole, then use your location for live yardages.</span></div><div class="hole-gps-controls"><button type="button" data-gps-toggle>Use my location for distances</button><p data-gps-status role="status">Showing distances from the mapped tee. Tap the button for your live position.</p></div></div><div class="hole-map-wrap"><div class="hole-map-canvas" data-hole-map aria-label="Satellite map of the selected hole"></div><p class="hole-map-message" role="status" data-map-status>Loading satellite map…</p><div class="hole-map-actions"><button type="button" data-hole-rotate-left aria-label="Rotate map left">↶</button><button type="button" data-hole-rotate-right aria-label="Rotate map right">↷</button><button type="button" class="hole-recentre" data-hole-fit>Fit hole</button></div></div><div class="hole-distance-panel"><p data-distance-origin>From mapped tee</p><div class="hole-distances" data-distances></div><div class="hole-target-distances" data-target-distances hidden></div></div><p class="hole-help">Tap anywhere on the map to measure a shot. ↶ ↷ rotate the map; Fit hole recentres it. Yardages and camera direction are guides.</p><div class="hole-navigation"><button type="button" class="secondary" data-hole-prev>← Previous</button><span data-hole-count></span><button type="button" class="secondary" data-hole-next>Next →</button></div></section>`;
  document.body.append(dialog);
  if(preview){
    dialog.setAttribute("aria-label","Course map preview");
    dialog.querySelector(".eyebrow").textContent="ADMIN PREVIEW";
    dialog.querySelector(".hole-dialog-top h2").textContent="Course map preview";
    dialog.querySelector(".hole-picker-note").textContent="Preview the discovered tee and green positions. Confirm the hole maps in event setup before members can use them.";
  }
  activeDialog=dialog;
  dialog.showModal();
  const $=(selector)=>dialog.querySelector(selector);
  let layout,holes=[],selected,controller,mapPromise,closed=false,greenFinder=null;
  let watch=null,watchGeneration=0,wanted=false,fix=null,target=null;
  function gpsStatus(message){$("[data-gps-status]").textContent=message;}
  function clearPosition(){fix=null;controller?.setPosition(null);updateDistances();}
  function stopWatching(){watchGeneration++;if(watch!==null){navigator.geolocation?.clearWatch(watch);watch=null;}clearPosition();}
  function validFix(){return !!fix&&Date.now()-fix.timestamp<=MAX_FIX_AGE&&fix.accuracy<=MAX_ACCURACY;}
  function updateDistances(){
    if(!selected||closed)return;
    const live=validFix(),origin=live?fix.point:selected.tee;
    $("[data-distance-origin]").textContent=live?`TEST MODE · From your GPS location · accuracy ±${Math.round(fix.accuracy)} m`:"From mapped tee · turn on your location for live distances";
    $("[data-distance-origin]").classList.toggle("is-live",live);
    $("[data-distances]").innerHTML=[["front","Front"],["green","Centre"],["back","Back"]].filter(([key])=>selected[key]).map(([key,label])=>`<div><span>${label}</span><strong data-distance="${key}">${yardsBetween(origin,selected[key])??"—"}</strong><small>yards</small></div>`).join("");
    const targetPanel=$("[data-target-distances]");targetPanel.hidden=!target;
    if(target)targetPanel.innerHTML=`<span>To target <strong>${yardsBetween(origin,target)??"—"} yd</strong></span><span>Target to centre <strong>${yardsBetween(target,selected.green)??"—"} yd</strong></span><button type="button" class="secondary" data-clear-target>Clear</button>`;
    targetPanel.querySelector("button")?.addEventListener("click",()=>{target=null;controller?.setTarget(null);updateDistances();});
  }
  function beginGPS(){
    wanted=true;
    if(!navigator.geolocation){wanted=false;gpsStatus("This browser does not support GPS. You can still view distances from the mapped tee.");return;}
    if(!window.isSecureContext){wanted=false;gpsStatus("GPS needs a secure connection. Open the website using HTTPS.");return;}
    stopWatching();
    const generation=watchGeneration;
    $("[data-gps-toggle]").textContent="Stop live distances";
    gpsStatus("Finding your location… Move into the open for the best signal.");
    try { const nextWatch=navigator.geolocation.watchPosition(result=>{
      if(closed||!wanted||document.hidden||generation!==watchGeneration)return;
      const point=coordinates({lat:result.coords.latitude,lng:result.coords.longitude}),accuracy=Number(result.coords.accuracy),timestamp=Number(result.timestamp);
      if(!point||!Number.isFinite(accuracy)||accuracy<0||!Number.isFinite(timestamp)||timestamp>Date.now()+5000||Date.now()-timestamp>MAX_FIX_AGE){clearPosition();gpsStatus("GPS signal is out of date. Waiting for a fresh location…");return;}
      if(accuracy>MAX_ACCURACY){clearPosition();gpsStatus(`TEST MODE · GPS accuracy is ±${Math.round(accuracy)} m. Move near a window or outside for a stronger signal.`);return;}
      fix={point,accuracy,timestamp};controller?.setPosition(point);updateDistances();gpsStatus(`TEST MODE · GPS is live even away from the course · accuracy ±${Math.round(accuracy)} m. Distances update as you move.`);
    },error=>{
      if(closed||!wanted||generation!==watchGeneration)return;
      clearPosition();
      if(error.code===1){wanted=false;stopWatching();$("[data-gps-toggle]").textContent="Try location again";gpsStatus("Location access was denied. Allow location for this website in your browser settings, then try again.");}
      else {gpsStatus(error.code===3?"GPS timed out. Waiting for a fresh signal…":"Your location is unavailable. Waiting for a fresh signal…");}
    },{enableHighAccuracy:true,maximumAge:0,timeout:12000});
      if(generation===watchGeneration&&wanted&&!document.hidden)watch=nextWatch;
      else navigator.geolocation.clearWatch(nextWatch);
    }
    catch {wanted=false;stopWatching();$("[data-gps-toggle]").textContent="Try location again";gpsStatus("This browser blocked location access. Check this website’s location permission, then try again.");}
  }
  $("[data-gps-toggle]").onclick=()=>{
    if(wanted){wanted=false;stopWatching();$("[data-gps-toggle]").textContent="Use my location for distances";gpsStatus("Showing distances from the mapped tee. Tap the button for your live position.");}
    else beginGPS();
  };
  $("[data-find-green]").onclick=async()=>{
    if(!selected?.reviewed||!selected.green)return;
    const hole=selected;
    try {
      const {openGreenFinder}=await import("./green-finder.js?v=2027-hole-ux-1");
      if(!closed&&selected===hole)greenFinder=openGreenFinder(hole,layout.name);
    } catch { gpsStatus("The camera direction view could not load. Use the satellite map instead."); }
  };
  function grid(){
    $("[data-hole-picker]").hidden=false;$("[data-hole-screen]").hidden=true;dialog.scrollTop=0;
    dialog.querySelector(".hole-dialog-top h2").textContent=preview?"Course map preview":"Choose your hole";
    $("[data-hole-grid]").querySelector(`[data-hole="${selected?.number||1}"]`)?.focus();
  }
  async function showHole(number){
    const hole=holes.find(h=>h.number===number);
    if(!hole?.reviewed||!hole.tee||!hole.green)return;
    selected=hole;target=null;
    if(greenFinder?.open)greenFinder.close();
    $("[data-hole-picker]").hidden=true;$("[data-hole-screen]").hidden=false;dialog.scrollTop=0;
    dialog.querySelector(".hole-dialog-top h2").textContent=preview?"Course map preview":"Your hole view";
    $("[data-hole-title]").textContent=`Hole ${number}`;
    $("[data-hole-course]").textContent=`${layout.name}${layout.tee_name?" · "+layout.tee_name+" tees":""}`;
    $("[data-hole-stats]").innerHTML=`<div><span>Par</span><strong>${b.escape(hole.par??"—")}</strong></div><div><span>Card yardage</span><strong>${b.escape(hole.yards??"—")}</strong></div><div><span>Stroke index</span><strong>${b.escape(hole.stroke_index??"—")}</strong></div>`;
    $("[data-hole-count]").textContent=`${number} / 18`;
    $("[data-hole-prev]").disabled=!holes.some(h=>h.number<number&&h.reviewed&&h.tee&&h.green);
    $("[data-hole-next]").disabled=!holes.some(h=>h.number>number&&h.reviewed&&h.tee&&h.green);
    $("[data-find-green]").hidden=preview;
    updateDistances();
    if(controller){controller.setHole(hole);controller.setPosition(validFix()?fix.point:null);return;}
    if(mapPromise)return;
    mapPromise=createHoleMap($("[data-hole-map]"),{
      center:hole.tee,
      onClick(point){target=point;controller?.setTarget(point);updateDistances();},
      onError(error){if(!closed){$("[data-map-status]").hidden=false;$("[data-map-status]").textContent=error.message;}},
    }).then(map=>{
      if(closed){map.destroy();return;}
      controller=map;$("[data-map-status]").hidden=true;
      controller.setHole(selected);controller.setPosition(validFix()?fix.point:null);
    }).catch(error=>{if(!closed){$("[data-map-status]").textContent=error.message;$("[data-map-status]").hidden=false;}}).finally(()=>{mapPromise=null;});
  }
  $("[data-hole-prev]").onclick=()=>{const previous=holes.filter(h=>h.number<selected.number&&h.reviewed&&h.tee&&h.green).at(-1);if(previous)showHole(previous.number);};
  $("[data-hole-next]").onclick=()=>{const next=holes.find(h=>h.number>selected.number&&h.reviewed&&h.tee&&h.green);if(next)showHole(next.number);};
  $("[data-hole-grid-back]").onclick=grid;
  $("[data-hole-fit]").onclick=()=>controller?.fitHole();
  $("[data-hole-rotate-left]").onclick=()=>controller?.rotate(-30);
  $("[data-hole-rotate-right]").onclick=()=>controller?.rotate(30);
  $("[data-hole-close]").onclick=()=>dialog.close();
  function visibility(){if(document.hidden){stopWatching();if(wanted)gpsStatus("GPS paused while the screen is hidden.");}else if(wanted)beginGPS();}
  const freshness=setInterval(()=>{if(fix&&!validFix()){clearPosition();gpsStatus("GPS signal is out of date. Waiting for a fresh location…");}},3000);
  function cleanup(){if(closed)return;closed=true;if(greenFinder?.open)greenFinder.close();wanted=false;stopWatching();clearInterval(freshness);document.removeEventListener("visibilitychange",visibility);window.removeEventListener("pagehide",cleanup);controller?.destroy();dialog.remove();activeDialog=null;}
  dialog.addEventListener("close",cleanup);
  document.addEventListener("visibilitychange",visibility);
  window.addEventListener("pagehide",cleanup);
  (async()=>{
    try{
      if(preview){
        const candidate=preparedLayout.holes?.map(normaliseHole)||[];
        const numbers=new Set(candidate.map(h=>h.number));
        const tees=new Set(candidate.map(h=>h.tee&&`${h.tee.lat},${h.tee.lng}`));
        const greens=new Set(candidate.map(h=>h.green&&`${h.green.lat},${h.green.lng}`));
        const validation=preparedLayout.source?.validation;
        if(validation?.status!=="verified"||validation.mapped!==18||validation.tee_anchors!==18||validation.green_anchors!==18||candidate.length!==18||numbers.size!==18||tees.size!==18||greens.size!==18||candidate.some(h=>h.number<1||h.number>18||!Number.isInteger(h.number)||!h.tee||!h.green||distanceMetres(h.tee,h.green)<30))throw new Error("The course map is not fully verified.");
        layout={...preparedLayout,holes:candidate.map(h=>({...h,reviewed:true}))};
      }else{
        const {data,error}=await b.client.rpc("course_layout",{action:"event",payload:{event_id:event.id}});
        if(error)throw error;
        layout=data?.layout;
      }
      if(closed)return;
      const source = $("[data-hole-source]");
      if (layout?.source?.attribution) {
        source.hidden = false;
        source.textContent = layout.source.attribution;
        const link = b.safeUrl(layout.source.url);
        if (link) source.innerHTML = `${b.escape(layout.source.attribution)} · <a href="${link}" target="_blank" rel="noopener noreferrer">Map data source</a>`;
      }
      holes=Array.from({length:18},(_,i)=>normaliseHole(layout?.holes?.find(h=>Number(h.number)===i+1)||{number:i+1}));
      $("[data-hole-loading]").hidden=true;
      $("[data-hole-picker]").hidden=false;
      const ready=holes.filter(h=>h.reviewed&&h.tee&&h.green).length;
      $("[data-hole-grid]").innerHTML=holes.map(h=>{const available=h.reviewed&&h.tee&&h.green;return `<button type="button" data-hole="${h.number}" ${available?"":"disabled"} aria-label="Hole ${h.number}${available?"":" — not ready"}"><strong>${h.number}</strong><small>${available?`Par ${b.escape(h.par??"—")}`:"Not ready"}</small></button>`;}).join("");
      $("[data-hole-readiness]").textContent=preview?`${layout.name} · 18 discovered hole maps · Preview only`:ready===18?`${layout.name} · All 18 holes ready`:ready?`${ready} of 18 holes ready. The remaining holes are being checked by an organiser.`:"The course hole maps have not been set up yet. Please ask an organiser.";
      $("[data-hole-grid]").onclick=click=>{const button=click.target.closest("[data-hole]");if(button&&!button.disabled)showHole(Number(button.dataset.hole));};
    }catch(error){if(!closed)$("[data-hole-loading]").textContent="The course could not load. Close this window and try again.";}
  })();
  return dialog;
}
