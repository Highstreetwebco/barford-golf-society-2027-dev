import {createHoleMap,normaliseHole,coordinates,distanceMetres,yardsBetween} from "./hole-map.js?v=2027-holes-1";

const MAX_FIX_AGE=15000,MAX_ACCURACY=35;
let activeDialog;
export function openHolePicker(event,b) {
  if(activeDialog?.open){activeDialog.focus();return activeDialog;}
  const dialog=document.createElement("dialog");
  dialog.className="hole-dialog";
  dialog.setAttribute("aria-label","View hole");
  dialog.innerHTML=`<div class="hole-dialog-top"><div><span class="eyebrow">ON THE COURSE</span><h2>Choose your hole</h2><p>${b.escape(event.name||"Today's round")}</p></div><button type="button" class="secondary" data-hole-close>Close</button></div><div data-hole-loading role="status" class="hole-load">Loading the course…</div><section data-hole-picker hidden><p class="hole-picker-note">Choose a hole to open its satellite map and GPS distances.</p><div class="hole-number-grid" data-hole-grid></div><p class="hole-picker-note" data-hole-readiness></p></section><section data-hole-screen hidden><div class="hole-screen-heading"><div><h2 data-hole-title></h2><p data-hole-course></p></div><button type="button" class="secondary" data-hole-grid-back>All holes</button></div><div class="hole-stats" data-hole-stats></div><div class="hole-map-wrap"><div class="hole-map-canvas" data-hole-map aria-label="Satellite map of the selected hole"></div><p class="hole-map-message" role="status" data-map-status>Loading satellite map…</p><button type="button" class="hole-recentre" data-hole-fit>Fit hole</button></div><div class="hole-distance-panel"><p data-distance-origin>From mapped tee</p><div class="hole-distances" data-distances></div><div class="hole-target-distances" data-target-distances hidden></div></div><div class="hole-gps-controls"><button type="button" data-gps-toggle>Use my GPS</button><p data-gps-status role="status">GPS is off. Distances are from the mapped tee.</p></div><p class="hole-help">Tap the map to measure a target. Phone GPS distances are a guide. Your location stays on this device.</p><div class="hole-navigation"><button type="button" class="secondary" data-hole-prev>← Previous</button><span data-hole-count></span><button type="button" class="secondary" data-hole-next>Next →</button></div></section>`;
  document.body.append(dialog);
  activeDialog=dialog;
  dialog.showModal();
  const $=(selector)=>dialog.querySelector(selector);
  let layout,holes=[],selected,controller,mapPromise,closed=false;
  let watch=null,watchGeneration=0,wanted=false,fix=null,target=null;
  function gpsStatus(message){$("[data-gps-status]").textContent=message;}
  function clearPosition(){fix=null;controller?.setPosition(null);updateDistances();}
  function stopWatching(){watchGeneration++;if(watch!==null){navigator.geolocation?.clearWatch(watch);watch=null;}clearPosition();}
  function validFix(){return !!fix&&Date.now()-fix.timestamp<=MAX_FIX_AGE&&fix.accuracy<=MAX_ACCURACY;}
  function updateDistances(){
    if(!selected||closed)return;
    const live=validFix(),origin=live?fix.point:selected.tee;
    $("[data-distance-origin]").textContent=live?`From your GPS location · accuracy ±${Math.round(fix.accuracy)} m`:"From mapped tee · GPS not active";
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
    $("[data-gps-toggle]").textContent="Stop GPS";
    gpsStatus("Finding your location… Move into the open for the best signal.");
    try { const nextWatch=navigator.geolocation.watchPosition(result=>{
      if(closed||!wanted||document.hidden||generation!==watchGeneration)return;
      const point=coordinates({lat:result.coords.latitude,lng:result.coords.longitude}),accuracy=Number(result.coords.accuracy),timestamp=Number(result.timestamp);
      if(!point||!Number.isFinite(accuracy)||accuracy<0||!Number.isFinite(timestamp)||timestamp>Date.now()+5000||Date.now()-timestamp>MAX_FIX_AGE){clearPosition();gpsStatus("GPS signal is out of date. Waiting for a fresh location…");return;}
      if(accuracy>MAX_ACCURACY){clearPosition();gpsStatus(`GPS accuracy is ±${Math.round(accuracy)} m. Waiting for a stronger signal…`);return;}
      const nearby=holes.some(h=>h.reviewed&&[h.tee,h.green].filter(Boolean).some(p=>distanceMetres(point,p)<=2000));
      if(!nearby){clearPosition();gpsStatus("You appear to be away from this course. Showing distances from the mapped tee.");return;}
      fix={point,accuracy,timestamp};controller?.setPosition(point);updateDistances();gpsStatus(`GPS is live · accuracy ±${Math.round(accuracy)} m. Distances update as you move.`);
    },error=>{
      if(closed||!wanted||generation!==watchGeneration)return;
      clearPosition();
      if(error.code===1){wanted=false;stopWatching();$("[data-gps-toggle]").textContent="Try GPS again";gpsStatus("Location access was denied. Allow location for this website in your browser settings, then try again.");}
      else {gpsStatus(error.code===3?"GPS timed out. Waiting for a fresh signal…":"Your location is unavailable. Waiting for a fresh signal…");}
    },{enableHighAccuracy:true,maximumAge:0,timeout:12000});
      if(generation===watchGeneration&&wanted&&!document.hidden)watch=nextWatch;
      else navigator.geolocation.clearWatch(nextWatch);
    }
    catch {wanted=false;stopWatching();$("[data-gps-toggle]").textContent="Try GPS again";gpsStatus("This browser blocked location access. Check this website’s location permission, then try again.");}
  }
  $("[data-gps-toggle]").onclick=()=>{
    if(wanted){wanted=false;stopWatching();$("[data-gps-toggle]").textContent="Use my GPS";gpsStatus("GPS is off. Distances are from the mapped tee.");}
    else beginGPS();
  };
  function grid(){
    $("[data-hole-picker]").hidden=false;$("[data-hole-screen]").hidden=true;
    dialog.querySelector(".hole-dialog-top h2").textContent="Choose your hole";
    $("[data-hole-grid]").querySelector(`[data-hole="${selected?.number||1}"]`)?.focus();
  }
  async function showHole(number){
    const hole=holes.find(h=>h.number===number);
    if(!hole?.reviewed||!hole.tee||!hole.green)return;
    selected=hole;target=null;
    $("[data-hole-picker]").hidden=true;$("[data-hole-screen]").hidden=false;
    dialog.querySelector(".hole-dialog-top h2").textContent="Your hole view";
    $("[data-hole-title]").textContent=`Hole ${number}`;
    $("[data-hole-course]").textContent=`${layout.name}${layout.tee_name?" · "+layout.tee_name+" tees":""}`;
    $("[data-hole-stats]").innerHTML=`<div><span>Par</span><strong>${b.escape(hole.par??"—")}</strong></div><div><span>Card yardage</span><strong>${b.escape(hole.yards??"—")}</strong></div><div><span>Stroke index</span><strong>${b.escape(hole.stroke_index??"—")}</strong></div>`;
    $("[data-hole-count]").textContent=`${number} / 18`;
    $("[data-hole-prev]").disabled=!holes.some(h=>h.number<number&&h.reviewed&&h.tee&&h.green);
    $("[data-hole-next]").disabled=!holes.some(h=>h.number>number&&h.reviewed&&h.tee&&h.green);
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
  $("[data-hole-close]").onclick=()=>dialog.close();
  function visibility(){if(document.hidden){stopWatching();if(wanted)gpsStatus("GPS paused while the screen is hidden.");}else if(wanted)beginGPS();}
  const freshness=setInterval(()=>{if(fix&&!validFix()){clearPosition();gpsStatus("GPS signal is out of date. Waiting for a fresh location…");}},3000);
  function cleanup(){if(closed)return;closed=true;wanted=false;stopWatching();clearInterval(freshness);document.removeEventListener("visibilitychange",visibility);window.removeEventListener("pagehide",cleanup);controller?.destroy();dialog.remove();activeDialog=null;}
  dialog.addEventListener("close",cleanup);
  document.addEventListener("visibilitychange",visibility);
  window.addEventListener("pagehide",cleanup);
  (async()=>{
    try{
      const {data,error}=await b.client.rpc("course_layout",{action:"event",payload:{event_id:event.id}});
      if(error)throw error;if(closed)return;
      layout=data?.layout;
      holes=Array.from({length:18},(_,i)=>normaliseHole(layout?.holes?.find(h=>Number(h.number)===i+1)||{number:i+1}));
      $("[data-hole-loading]").hidden=true;
      $("[data-hole-picker]").hidden=false;
      const ready=holes.filter(h=>h.reviewed&&h.tee&&h.green).length;
      $("[data-hole-grid]").innerHTML=holes.map(h=>{const available=h.reviewed&&h.tee&&h.green;return `<button type="button" data-hole="${h.number}" ${available?"":"disabled"} aria-label="Hole ${h.number}${available?"":" — not ready"}"><strong>${h.number}</strong><small>${available?`Par ${b.escape(h.par??"—")}`:"Not ready"}</small></button>`;}).join("");
      $("[data-hole-readiness]").textContent=ready===18?`${layout.name} · All 18 holes ready`:ready?`${ready} of 18 holes ready. The remaining holes are being checked by an organiser.`:"The course hole maps have not been set up yet. Please ask an organiser.";
      $("[data-hole-grid]").onclick=click=>{const button=click.target.closest("[data-hole]");if(button&&!button.disabled)showHole(Number(button.dataset.hole));};
    }catch(error){if(!closed)$("[data-hole-loading]").textContent="The course could not load. Close this window and try again.";}
  })();
  return dialog;
}
