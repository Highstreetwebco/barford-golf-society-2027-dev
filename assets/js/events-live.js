(() => {
  const F=window.BarfordMemberFlow,client=window.BarfordSupabase,list=document.getElementById('eventList'),summary=document.getElementById('eventCalendarSummary');
  if(!list||!F)return;
  async function load(){
    try{
      const [events,auth]=await Promise.all([F.request(client.from('events').select('*').in('status',['scheduled','cancelled','completed']).order('event_date')),F.request(client.auth.getSession())]);
      let rsvps=[],bookingError=false;
      if(auth.session){try{rsvps=await F.request(client.from('rsvps').select('event_id,status,payment_status').eq('member_id',auth.session.user.id));}catch{bookingError=true;}}
      const upcoming=events.filter(e=>e.event_date>=F.today()&&e.status!=='completed'),past=events.filter(e=>!upcoming.includes(e)).reverse();
      const card=e=>{const rsvp=rsvps.find(r=>r.event_id===e.id),model={event:e,rsvp,bookingError};return `<article class="simple-card simple-calendar-card"><div><p class="eyebrow">${F.esc(F.date(e.event_date))}</p><h3>${F.esc(e.name)}</h3><p>${F.esc(e.venue||'Venue to be confirmed')} · ${F.esc(F.money(e.price))}</p>${auth.session?`<p class="simple-booking-label">${F.esc(F.bookingLabel(model))}</p>`:e.status==='cancelled'?'<p>Event cancelled</p>':''}</div><a class="button button-primary" href="${F.eventUrl(e.id)}">${e.status==='cancelled'?'View cancellation':e.event_date<F.today()?'View event':rsvp?.status==='playing'?'View my booking':rsvp?.status==='reserve'?'View reserve booking':'View event and book'}</a></article>`;};
      list.innerHTML=(upcoming.map(card).join('')||'<article class="simple-card"><h3>No upcoming events yet</h3><p>The next event will appear here when it is announced.</p></article>')+(past.length?`<details class="simple-details simple-card"><summary>Past events (${past.length})</summary><div class="simple-detail-content">${past.map(card).join('')}</div></details>`:'');
      summary.textContent=bookingError?'Your bookings could not be checked. Open an event to try again.':auth.session?'Your booking status is shown on each event.':'Sign in to book and see your own booking status.';
    }catch{summary.textContent='The calendar could not be loaded.';list.innerHTML='<article class="simple-card"><p>Please try again.</p><button class="button button-primary" id="retryCalendar">Reload events</button></article>';list.querySelector('#retryCalendar').onclick=load;}
  }
  load();F.promotions();
})();
