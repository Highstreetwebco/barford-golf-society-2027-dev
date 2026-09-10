(() => {
  'use strict';
  if(!('serviceWorker' in navigator)||window.BarfordOfflineRegister)return;
  window.BarfordOfflineRegister=true;
  const register=()=>navigator.serviceWorker.register('./sw.js?v=78',{updateViaCache:'none'}).catch(()=>{});
  // Let the visible page and its member data start first. Updates apply at the next
  // navigation; never reload a page while someone is entering scores or a booking.
  const schedule=()=>setTimeout(register,1500);
  if(document.readyState==='complete')schedule();else window.addEventListener('load',schedule,{once:true});
})();
