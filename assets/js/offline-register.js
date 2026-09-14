(() => {
  'use strict';
  if(!('serviceWorker' in navigator)||window.BarfordOfflineRegister)return;
  window.BarfordOfflineRegister=true;
  let registration=null,checking=false,lastCheck=0;
  const wasControlled=Boolean(navigator.serviceWorker.controller);
  function notify(){
    if(!wasControlled||document.getElementById('barfordUpdateNotice'))return;
    const notice=document.createElement('aside');notice.id='barfordUpdateNotice';
    notice.setAttribute('role','status');
    Object.assign(notice.style,{position:'fixed',bottom:'88px',left:'12px',right:'12px',zIndex:'10000',padding:'14px',borderRadius:'12px',background:'#073c2f',color:'#fff',boxShadow:'0 4px 20px #0004',font:'15px/1.5 system-ui'});
    const text=document.createElement('span');text.textContent='A website update is ready. Finish any changes, then refresh. ';
    const button=document.createElement('button');button.type='button';button.textContent='Refresh website';
    Object.assign(button.style,{padding:'10px 14px',border:'1px solid #fff',borderRadius:'8px',background:'#fff',color:'#073c2f',font:'inherit',cursor:'pointer'});
    button.onclick=()=>location.reload();notice.append(text,button);document.body.append(notice);
  }
  // An update must never force a golfer out of an active scorecard or RSVP form.
  navigator.serviceWorker.addEventListener('controllerchange',notify);
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
