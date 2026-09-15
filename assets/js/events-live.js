(() => {
  const F=window.BarfordMemberFlow,client=window.BarfordSupabase,list=document.getElementById('eventList'),summary=document.getElementById('eventCalendarSummary');
  if(!list||!F)return;
  const dateTicket=value=>{
    const date=new Date(`${value}T12:00:00`);
    if(Number.isNaN(date.getTime()))return '';
    return `<div class="clubhouse-date-ticket" aria-hidden="true"><small>${date.toLocaleDateString('en-GB',{month:'short'})}</small><strong>${date.getDate()}</strong><small>${date.getFullYear()}</small></div>`;
  };
  async function load(){
    try{
      const auth=await F.request(client.auth.getSession());

      const events=await F.request(client.from('events').select('*').in('status',['scheduled','cancelled','completed']).order('event_date'));
      let rsvps=[],bookingError=false;
      if(auth.session){try{rsvps=await F.request(client.from('rsvps').select('event_id,status,payment_status,is_course_member').eq('member_id',auth.session.user.id));}catch{bookingError=true;}}
      const upcoming=events.filter(e=>e.event_date>=F.today()&&e.status==='scheduled'),past=events.filter(e=>e.status!=='cancelled'&&!upcoming.includes(e)).reverse();
      const card=e=>{const rsvp=rsvps.find(r=>r.event_id===e.id),model={event:e,rsvp,bookingError};return `<article class="simple-card simple-calendar-card">${dateTicket(e.event_date)}<div><p class="eyebrow">${F.esc(F.date(e.event_date))}</p><h3>${F.esc(e.name)}</h3><p>${F.esc(e.venue||'Venue to be confirmed')} · ${F.esc(F.money(auth.session?F.eventPrice(e,rsvp):(e.guest_price??e.price)))}</p>${auth.session?`<p class="simple-booking-label">${F.esc(F.bookingLabel(model))}</p>`:e.status==='cancelled'?'<p>Event cancelled</p>':''}</div><a class="button button-primary" href="${F.eventUrl(e.id)}">${e.status==='cancelled'?'View cancellation':e.event_date<F.today()?'View event':rsvp?.status==='playing'?'View my booking':rsvp?.status==='reserve'?'View reserve booking':'View event and book'}</a></article>`;};
      const filters=[['upcoming','Upcoming',upcoming],...(auth.session?[['mine','My bookings',events.filter(e=>e.status!=='cancelled'&&rsvps.some(r=>r.event_id===e.id&&['playing','reserve'].includes(r.status)))]]:[]),['past','Past',past],['all','All events',events]];
      let selected=new URLSearchParams(location.search).get('filter')||'upcoming';
      if(!filters.some(([key])=>key===selected))selected='upcoming';
      list.innerHTML=`<div class="simple-actions" role="group" aria-label="Filter events">${filters.map(([key,label,rows])=>`<button type="button" class="button button-outline" data-event-filter="${key}" aria-pressed="${key===selected}">${label} (${rows.length})</button>`).join('')}</div><div id="filteredEvents" aria-live="polite"></div>`;
      const renderFilter=()=>{
        const rows=filters.find(([key])=>key===selected)[2];
        list.querySelector('#filteredEvents').innerHTML=rows.map(card).join('')||`<article class="simple-card"><h3>${selected==='mine'?'No bookings yet':selected==='past'?'No past events yet':'No events to show'}</h3><p>${selected==='mine'?'Choose Upcoming to find your next round.':'Choose All events to see the full calendar.'}</p></article>`;
        list.querySelectorAll('[data-event-filter]').forEach(button=>{const active=button.dataset.eventFilter===selected;button.setAttribute('aria-pressed',String(active));button.classList.toggle('button-primary',active);button.classList.toggle('button-outline',!active);});
      };
      list.querySelectorAll('[data-event-filter]').forEach(button=>button.onclick=()=>{selected=button.dataset.eventFilter;const url=new URL(location.href);url.searchParams.set('filter',selected);history.replaceState(null,'',url);renderFilter();});
      renderFilter();
      summary.textContent=bookingError?'Your bookings could not be checked. Open an event to try again.':auth.session?'Your booking status is shown on each event.':'Choose an event, then RSVP with your name as a guest.';
    }catch{summary.textContent='The calendar could not be loaded.';list.innerHTML='<article class="simple-card"><p>Please try again.</p><button class="button button-primary" id="retryCalendar">Reload events</button></article>';list.querySelector('#retryCalendar').onclick=load;}
  }
  load();F.promotions();
})();
