(() => {
 'use strict';
 let resolve,reject,settled=false;
 window.BarfordMapsReady=new Promise((yes,no)=>{resolve=yes;reject=no;});
 // The course controller awaits this promise; handle early failures too.
 window.BarfordMapsReady.catch(()=>{});
 const fail=reason=>{
  window.__barfordMapFailed=true;window.__barfordCourseMap=null;
  const surface=window.document?.getElementById('courseMap');if(surface)surface.hidden=true;
  if(!settled){settled=true;reject(new Error(reason));}
  window.dispatchEvent(new CustomEvent('barford-map-failed',{detail:{reason}}));
 };
 window.gm_authFailure=()=>fail('Google Maps could not authorise this website.');
 window.barfordMapsLoaded=()=>{if(!settled){settled=true;resolve();}};
 window.BarfordMapLoadFailed=()=>fail('The map connection could not be opened.');
})();
