import {createHoleMap,normaliseHole,coordinates,distanceMetres} from "./hole-map.js?v=2027-fullscreen-1";
import {holeGpsState,holeMeasurements} from "./hole-gps.js?v=2027-aim-point-1";

const cross='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
const locate='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 1v4m0 14v4M1 12h4m14 0h4"/></svg>';
let activeDialog;
export function openHolePicker(event,b,preparedLayout=null) {
  const preview=!!preparedLayout&&b.state?.admin===true;
  if(activeDialog?.open){activeDialog.focus();return activeDialog;}
  const dialog=document.createElement("dialog");
  dialog.className="hole-dialog";
  dialog.setAttribute("aria-label",preview?"Course map preview":"View hole");
  dialog.innerHTML=`<header class="hole-dialog-top"><button type="button" class="hole-close" data-hole-close aria-label="Close hole map">${cross}</button><div class="hole-heading"><span class="eyebrow">${preview?"ADMIN PREVIEW":"ON THE COURSE"}</span><h2 data-hole-title>${preview?"Course map preview":"Choose your hole"}</h2><p data-hole-course>${b.escape(event.name||"Today's round")}</p></div><button type="button" class="secondary" data-hole-grid-back hidden>All holes</button></header>
    <div data-hole-loading role="status" class="hole-load">Loading the course…</div>
    <section data-hole-picker hidden><p class="hole-picker-note">${preview?"Preview the hole maps before saving the event.":"Choose a hole to open its map."}</p><div class="hole-number-grid" data-hole-grid></div><p class="hole-picker-note" data-hole-readiness></p></section>
    <section data-hole-screen hidden>
      <div class="hole-map-wrap"><div class="hole-map-canvas" data-hole-map aria-label="Satellite map of the selected hole"></div><p class="hole-map-message" role="status" data-map-status>Loading satellite map…</p>
        <aside class="hole-readout" aria-label="Hole distance"><span class="hole-distance-start" data-yardage-origin>From tee</span><div class="hole-live-yardage" data-distances hidden><div><strong data-distance="green"></strong><span>yd</span></div><span class="hole-distance-label">To green centre</span></div><button type="button" class="hole-gps-button" data-gps-toggle aria-pressed="false"><span class="hole-gps-dot" aria-hidden="true"></span><span data-distance-origin><span data-gps-status role="status">Use GPS</span></span></button></aside>
        <div class="hole-target-distances" data-target-distances role="group" aria-label="Aim point distances" hidden><span class="hole-target-origin" data-target-origin>From tee</span><span>To aim <strong data-distance="aim"></strong></span><span>Then green <strong data-distance="remaining"></strong></span><button type="button" data-clear-target aria-label="Clear aim point">${cross}</button></div>
      </div>
      <nav class="hole-navigation" aria-label="Hole navigation"><button type="button" data-hole-prev><span aria-hidden="true">‹</span> Previous</button><button type="button" class="hole-fit" data-hole-fit aria-label="Fit hole on screen" title="Fit hole">${locate}</button><button type="button" data-hole-next>Next <span aria-hidden="true">›</span></button></nav>
    </section><footer class="hole-map-attribution" data-hole-source hidden></footer>`;
  document.body.append(dialog);activeDialog=dialog;dialog.showModal();
  document.documentElement.classList.add("has-hole-dialog");
  const $=selector=>dialog.querySelector(selector);
  let layout,holes=[],selected,controller,mapPromise,closed=false,screenOpen=false,resize;
  let watch=null,watchGeneration=0,wanted=false,requestedGPS=false,fix=null,target=null,wasLive=false,statusMessage="Use GPS";
  const setText=(element,text)=>{if(element.textContent!==text)element.textContent=text;};
  const state=()=>holeGpsState(fix,selected);
  function updateDistances({fit=false}={}){
    if(!selected||closed)return;
    const measurements=holeMeasurements(fix,selected,target),{mode,live}=measurements,changed=live!==wasLive;
    dialog.dataset.gpsState=mode;
    controller?.setPosition(live?fix.point:null);
    if(fit||changed)controller?.fitHole();
    wasLive=live;
    $("[data-distances]").hidden=measurements.green===null;
    setText($("[data-distance=green]"),String(measurements.green??"—"));
    setText($("[data-yardage-origin]"),live?"From your GPS":"From tee");
    $("[data-distance-origin]").classList.toggle("is-live",live);
    const messages={live:live?`GPS ±${Math.ceil(fix.accuracy/.9144)} yd`:"",away:"Outside 1,000 yd",inaccurate:"Weak GPS · waiting",stale:"Refreshing GPS…",invalid:"Waiting for GPS…"};
    setText($("[data-gps-status]"),messages[mode]||statusMessage);
    const gps=$("[data-gps-toggle]");gps.setAttribute("aria-pressed",String(wanted));
    gps.setAttribute("aria-label",wanted?"GPS active. Pause live distances":"Use GPS for live distances");
    gps.title=mode==="away"?"Live yardage appears within 1,000 yards of this hole.":mode==="inaccurate"?"Waiting for GPS accuracy of 20 metres or better.":wanted?"Pause live distances":"Allow location to see your distance to the green centre.";
    $("[data-target-distances]").hidden=!target;
    setText($("[data-target-origin]"),live?"From your GPS":"From tee");
    setText($("[data-distance=aim]"),`${measurements.aim??"—"} yd`);
    setText($("[data-distance=remaining]"),`${measurements.remaining??"—"} yd`);
  }
  $("[data-clear-target]").onclick=()=>{target=null;controller?.setTarget(null);updateDistances();};
  function stopWatching(){watchGeneration++;if(watch!==null){navigator.geolocation?.clearWatch(watch);watch=null;}fix=null;updateDistances();}
  function beginGPS(){
    requestedGPS=true;wanted=true;stopWatching();
    if(!navigator.geolocation||!window.isSecureContext){wanted=false;statusMessage="GPS unavailable";updateDistances();return;}
    statusMessage="Finding GPS…";updateDistances();
    const generation=watchGeneration;
    try{
      const next=navigator.geolocation.watchPosition(result=>{
        if(closed||!wanted||!screenOpen||document.hidden||generation!==watchGeneration)return;
        fix={point:coordinates({lat:result.coords.latitude,lng:result.coords.longitude}),accuracy:result.coords.accuracy,timestamp:result.timestamp};
        updateDistances();
      },error=>{
        if(closed||!wanted||generation!==watchGeneration)return;
        fix=null;
        if(error.code===1){wanted=false;stopWatching();statusMessage="GPS blocked · retry";}
        else statusMessage="Waiting for GPS…";
        updateDistances();
      },{enableHighAccuracy:true,maximumAge:0,timeout:12000});
      if(generation===watchGeneration&&wanted&&screenOpen&&!document.hidden)watch=next;
      else navigator.geolocation.clearWatch(next);
    }catch{wanted=false;stopWatching();statusMessage="GPS blocked · retry";updateDistances();}
  }
  $("[data-gps-toggle]").onclick=()=>{
    if(wanted){wanted=false;statusMessage="Use GPS";stopWatching();}
    else beginGPS();
  };
  function grid(){
    screenOpen=false;stopWatching();dialog.classList.remove("is-hole-view");
    $("[data-hole-picker]").hidden=false;$("[data-hole-screen]").hidden=true;$("[data-hole-grid-back]").hidden=true;dialog.scrollTop=0;
    $("[data-hole-title]").textContent=preview?"Course map preview":"Choose your hole";
    $("[data-hole-course]").textContent=event.name||"Today's round";
    $("[data-hole-grid]").querySelector(`[data-hole="${selected?.number||1}"]`)?.focus();
  }
  async function showHole(number){
    const hole=holes.find(h=>h.number===number);
    if(!hole?.reviewed||!hole.tee||!hole.green)return;
    selected=hole;target=null;screenOpen=true;dialog.classList.add("is-hole-view");
    $("[data-hole-picker]").hidden=true;$("[data-hole-screen]").hidden=false;$("[data-hole-grid-back]").hidden=false;dialog.scrollTop=0;
    $("[data-hole-title]").textContent=`Hole ${number}`;
    $("[data-hole-course]").textContent=hole.par?`Par ${hole.par}`:"";
    $("[data-hole-prev]").disabled=!holes.some(h=>h.number<number&&h.reviewed&&h.tee&&h.green);
    $("[data-hole-next]").disabled=!holes.some(h=>h.number>number&&h.reviewed&&h.tee&&h.green);
    controller?.setHole(hole);updateDistances({fit:true});
    // The user has opened a hole: ask the browser once, then watch locally.
    if((!preview&&!requestedGPS)||(wanted&&watch===null))beginGPS();
    if(controller||mapPromise)return;
    mapPromise=createHoleMap($("[data-hole-map]"),{
      center:hole.tee,
      onClick(point){target=point;controller?.setTarget(point);updateDistances();},
      onError(error){if(!closed){$("[data-map-status]").hidden=false;$("[data-map-status]").textContent=error.message;}},
    }).then(map=>{
      if(closed){map.destroy();return;}
      controller=map;$("[data-map-status]").hidden=true;controller.setHole(selected);updateDistances({fit:true});
      if(typeof ResizeObserver!=="undefined"){resize=new ResizeObserver(()=>{if(screenOpen)controller?.fitHole();});resize.observe($("[data-hole-map]"));}
    }).catch(error=>{if(!closed){$("[data-map-status]").textContent=error.message;$("[data-map-status]").hidden=false;}}).finally(()=>{mapPromise=null;});
  }
  $("[data-hole-prev]").onclick=()=>{const previous=holes.filter(h=>h.number<selected.number&&h.reviewed&&h.tee&&h.green).at(-1);if(previous)showHole(previous.number);};
  $("[data-hole-next]").onclick=()=>{const next=holes.find(h=>h.number>selected.number&&h.reviewed&&h.tee&&h.green);if(next)showHole(next.number);};
  $("[data-hole-grid-back]").onclick=grid;
  $("[data-hole-fit]").onclick=()=>controller?.fitHole();
  $("[data-hole-close]").onclick=()=>dialog.close();
  function visibility(){if(document.hidden){statusMessage="GPS paused";stopWatching();}else if(wanted&&screenOpen)beginGPS();}
  const freshness=setInterval(()=>{if(fix&&state()==="stale")updateDistances();},1000);
  function cleanup(){if(closed)return;closed=true;wanted=false;stopWatching();clearInterval(freshness);resize?.disconnect();document.removeEventListener("visibilitychange",visibility);window.removeEventListener("pagehide",cleanup);controller?.destroy();dialog.remove();document.documentElement.classList.remove("has-hole-dialog");activeDialog=null;}
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
        if(validation?.status!=="verified"||validation.mapped!==18||!(validation.tee_anchors===18||(validation.method==="numbered_routes_with_verified_greens"&&validation.route_starts===18))||validation.green_anchors!==18||candidate.length!==18||numbers.size!==18||tees.size!==18||greens.size!==18||candidate.some(h=>h.number<1||h.number>18||!Number.isInteger(h.number)||!h.tee||!h.green||distanceMetres(h.tee,h.green)<30))throw new Error("The course map is not fully verified.");
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
