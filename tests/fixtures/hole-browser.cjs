async function installMap(context,{automatic=true}={}) {
 await context.addInitScript(automatic => {
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
  window.__gps={active:new Map(),history:[],options:[]};
  window.emitGps=(coords,timestamp=Date.now())=>{for(const item of window.__gps.active.values())item.ok({coords,timestamp});};
  window.emitGpsError=code=>{for(const item of [...window.__gps.active.values()])item.error({code});};
  Object.defineProperty(navigator,'geolocation',{configurable:true,value:{watchPosition(ok,error,options){const id=++window.gpsWatches;const item={ok,error};window.__gps.active.set(id,item);window.__gps.history.push(item);window.__gps.options.push(options);if(automatic)queueMicrotask(()=>{if(window.__gps.active.has(id))ok({coords:{latitude:52.001,longitude:-1.5,accuracy:6},timestamp:Date.now()});});return id;},clearWatch(id){window.gpsClears++;window.__gps.active.delete(id);}}});
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia(){window.cameraCalls++;throw new Error('Camera must not be requested');}}});
 },automatic);
}

module.exports={installMap};
