// Shared course-map rendering. Browser GPS stays in the viewer and never leaves the device.
const MAPS_KEY = "AIzaSyBvGmkoNudQv0beSmSma4NPs8gFWo5YsTA";
let loading;
const failures = new Set();

export function coordinates(value) {
  if (!value || value.lat == null || value.lng == null) return null;
  if ([value.lat,value.lng].some(part=>typeof part==="boolean"||(typeof part==="string"&&!part.trim()))) return null;
  const lat = typeof value.lat === "function" ? value.lat() : Number(value.lat);
  const lng = typeof value.lng === "function" ? value.lng() : Number(value.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? { lat, lng }
    : null;
}

export function normaliseHole(hole = {}) {
  const point = (key) => coordinates(hole[key]) || coordinates({lat:hole[key + "_lat"],lng:hole[key + "_lng"]});
  return {...hole, number:Number(hole.number ?? hole.hole_number), tee:point("tee"),green:point("green"),front:point("front"),back:point("back"),dogleg:point("dogleg")};
}

const radians = (value) => value * Math.PI / 180;
export function distanceMetres(a, b) {
  a = coordinates(a); b = coordinates(b);
  if (!a || !b) return null;
  const p = radians(b.lat-a.lat), q = radians(b.lng-a.lng);
  const h = Math.sin(p/2)**2 + Math.cos(radians(a.lat))*Math.cos(radians(b.lat))*Math.sin(q/2)**2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0,1-h)));
}
export const yardsBetween = (a,b) => {
  const distance = distanceMetres(a,b);
  return distance == null ? null : Math.round(distance / .9144);
};
function heading(a,b) {
  const p=radians(a.lat),q=radians(b.lat),delta=radians(b.lng-a.lng);
  return (Math.atan2(Math.sin(delta)*Math.cos(q),Math.cos(p)*Math.sin(q)-Math.sin(p)*Math.cos(q)*Math.cos(delta))*180/Math.PI+360)%360;
}

export async function loadGoogleMaps() {
  if (window.google?.maps?.importLibrary) {
    await window.google.maps.importLibrary("maps");
    return window.google.maps;
  }
  if (loading) return loading;
  loading = new Promise((resolve,reject) => {
    const script=document.createElement("script");
    const callback="barfordHoleMapsLoaded";
    let finished=false;
    const finish=(error) => {
      if (finished) return;
      finished=true; clearTimeout(timeout);
      delete window[callback];
      failures.delete(fail);
      if(error){script.remove();loading=null;reject(error);}
      else resolve(window.google.maps);
    };
    const fail=(error)=>finish(error);
    const previousAuthFailure=window.gm_authFailure;
    window.gm_authFailure=()=>{
      const error=new Error("Google Maps could not authorise this website. Please tell an organiser.");
      for(const listener of failures) listener(error);
      if(typeof previousAuthFailure==="function") previousAuthFailure();
    };
    failures.add(fail);
    window[callback]=()=>finish();
    const timeout=setTimeout(()=>finish(new Error("The satellite map is taking too long to load. Check your connection and reopen the hole.")),15000);
    script.src=`https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}&v=weekly&loading=async&callback=${callback}`;
    script.async=true;
    script.onerror=()=>finish(new Error("The satellite map could not load. Check your connection and reopen the hole."));
    document.head.append(script);
  });
  return loading;
}

export async function createHoleMap(element,{center,onClick,onError}={}) {
  const maps=await loadGoogleMaps();
  let current=null,position=null,target=null,destroyed=false;
  const overlays=[];
  const map=new maps.Map(element,{
    center:coordinates(center)||{lat:52.27,lng:-1.61},zoom:16,mapTypeId:"satellite",
    renderingType:maps.RenderingType.VECTOR,tilt:0,heading:0,
    gestureHandling:"greedy",headingInteractionEnabled:true,tiltInteractionEnabled:false,
    streetViewControl:false,fullscreenControl:false,mapTypeControl:false,
    zoomControl:true,rotateControl:false,keyboardShortcuts:true,
  });
  const report=(error)=>{if(!destroyed)onError?.(error);};
  failures.add(report);
  // OverlayView uses the existing browser key without requiring another map ID.
  class Label extends maps.OverlayView {
    constructor(point,text,type){super();this.point=point;this.text=text;this.type=type;this.setMap(map);}
    onAdd(){this.node=document.createElement("div");this.node.className=`hole-map-pin hole-map-pin-${this.type}`;this.node.textContent=this.text;this.node.setAttribute("aria-hidden","true");this.getPanes().overlayLayer.append(this.node);}
    draw(){const p=this.getProjection().fromLatLngToDivPixel(new maps.LatLng(this.point));if(p&&this.node){this.node.style.left=p.x+"px";this.node.style.top=p.y+"px";}}
    onRemove(){this.node?.remove();}
  }
  function clear(){for(const item of overlays)item.setMap(null);overlays.length=0;}
  function line(path,colour="#ffffff",weight=3){overlays.push(new maps.Polyline({map,path,strokeColor:colour,strokeOpacity:.9,strokeWeight:weight,clickable:false,zIndex:2}));}
  function pin(point,text,type){if(point)overlays.push(new Label(point,text,type));}
  function redraw(){
    if(destroyed)return;clear();
    if(!current)return;
    const {tee,green,front,back,dogleg}=current;
    if(tee&&green)line([tee,...(dogleg?[dogleg]:[]),green]);
    pin(tee,"Mapped start","tee");pin(green,"Centre","green");pin(front,"Front","edge");pin(back,"Back","edge");pin(dogleg,"Turn","edge");
    if(position)pin(position,"You","player");
    const origin=position||tee;
    if(target){if(origin)line([origin,target],"#ffd66d",4);if(green)line([target,green],"#ffd66d",3);pin(target,"Target","target");}
    else if(position&&green)line([position,green],"#79dbf2",3);
  }
  function fitHole(){
    if(!current||destroyed)return;
    const points=[current.tee,current.green,current.front,current.back,current.dogleg].filter(Boolean);
    if(!points.length)return;
    const centre={lat:points.reduce((s,p)=>s+p.lat,0)/points.length,lng:points.reduce((s,p)=>s+p.lng,0)/points.length};
    const angle=current.tee&&current.green?heading(current.tee,current.green):0;
    const rotated=points.map(p=>{const east=radians(p.lng-centre.lng)*6371008.8*Math.cos(radians(centre.lat)),north=radians(p.lat-centre.lat)*6371008.8,a=radians(angle);return {x:east*Math.cos(a)-north*Math.sin(a),y:east*Math.sin(a)+north*Math.cos(a)};});
    const width=Math.max(75,2*Math.max(...rotated.map(p=>Math.abs(p.x)))),height=Math.max(100,2*Math.max(...rotated.map(p=>Math.abs(p.y))));
    const mpp=Math.max(width/Math.max(150,element.clientWidth-105),height/Math.max(180,element.clientHeight-120));
    const zoom=Math.min(19,Math.max(13,Math.log2(156543.03392*Math.cos(radians(centre.lat))/mpp)));
    map.moveCamera({center:centre,zoom,heading:angle,tilt:0});
  }
  const click=map.addListener("click",event=>{const point=coordinates(event.latLng);if(point)onClick?.(point);});
  return {
    map,
    setHole(hole,{fit=true}={}){current=normaliseHole(hole);target=null;redraw();if(fit)fitHole();},
    setPosition(point){position=coordinates(point);redraw();},
    setTarget(point){target=coordinates(point);redraw();},
    fitHole,
    rotate(degrees){map.setHeading(((map.getHeading()||0)+degrees+360)%360);},
    destroy(){destroyed=true;clear();click.remove();failures.delete(report);maps.event.clearInstanceListeners(map);element.replaceChildren();},
  };
}
