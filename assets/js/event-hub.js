(() => {
  const host=document.getElementById('memberEventHub'),F=window.BarfordMemberFlow;
  if(!host||!F)return;
  const id=new URLSearchParams(location.search).get('event');
  let loading=false;
  async function load(){
    if(loading)return;loading=true;
    try{if(!id)throw new Error('Choose an event to see your booking.');const model=await F.loadEvent(id);window.BarfordEventView.render(host,model);document.title=`${model.event.name} | Barford Golf Society`;}
    catch(error){host.innerHTML=`<article class="simple-card"><h1>Event details unavailable</h1><p role="status">${F.esc(error.message)}</p><button class="button button-primary" id="retryEvent">Try again</button><a class="button button-outline" href="events.html">View all events</a></article>`;host.querySelector('#retryEvent').onclick=load;}
    finally{loading=false;}
  }
  window.addEventListener('barford-booking-changed',load);load();F.promotions();
})();
