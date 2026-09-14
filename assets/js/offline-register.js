(() => {
  'use strict';
  if(!('serviceWorker' in navigator)||window.BarfordOfflineRegister)return;
  window.BarfordOfflineRegister=true;
  let registration=null,checking=false,lastCheck=0;
  // Check for updates silently; never interrupt a scorecard or RSVP form.
  async function check(force=false){
    if(checking||!navigator.onLine||(!force&&Date.now()-lastCheck<60000))return;
    checking=true;lastCheck=Date.now();
    try{
      registration=registration||await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});
      await registration.update();
    }catch{}finally{checking=false;}
  }
  const start=()=>{check(true);setInterval(()=>{if(document.visibilityState==='visible')check();},60000);};
  window.addEventListener('online',()=>check(true));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')check();});
  if(document.readyState==='complete')start();else window.addEventListener('load',start,{once:true});
})();
