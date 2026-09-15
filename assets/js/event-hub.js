(() => {
  const host=document.getElementById('memberEventHub'),F=window.BarfordMemberFlow;
  if(!host||!F)return;
  const id=new URLSearchParams(location.search).get('event');
  let loading=false;
  async function load(){
    if(loading)return;loading=true;
    try{
      if(!id)throw new Error('Choose an event to see your booking.');
      const [event,access]=await Promise.all([
        F.request(window.BarfordSupabase.from('events').select('*').eq('id',id).single()),
        (async()=>{const auth=await F.request(window.BarfordSupabase.auth.getSession());return {auth,info:auth.session?null:await window.BarfordGuestEvents.state(id)};})()
      ]);
      const {auth,info}=access;
      if(!auth.session){window.BarfordGuestEvents.render(host,event,info);document.title=`${event.name} | Barford Golf Society`;return;}
      const model=await F.loadEvent(id,{session:auth.session,event});
      window.BarfordEventView.render(host,model);document.title=`${model.event.name} | Barford Golf Society`;
    }
    catch(error){host.innerHTML=`<article class="simple-card"><h1>Event details unavailable</h1><p role="status">${F.esc(error.message)}</p><button class="button button-primary" id="retryEvent">Try again</button><a class="button button-outline" href="events.html">View all events</a></article>`;host.querySelector('#retryEvent').onclick=load;}
    finally{loading=false;}
  }
  window.addEventListener('barford-booking-changed',event=>{
    const fresh=event.detail?.model;
    if(fresh?.event.id===id && fresh.session?.user.id){window.BarfordEventView.render(host,fresh);return;}
    load();
  });load();F.promotions();
})();
