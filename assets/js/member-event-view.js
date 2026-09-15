(() => {
  "use strict";
  const F=window.BarfordMemberFlow;
  if(!F)return;
  const {esc}=F;
  const button=(action,label,primary=false)=>`<button type="button" class="button ${primary?'button-primary':'button-outline'}" data-member-action="${action}">${esc(label)}</button>`;
  function render(host,model,{compact=false}={}) {
    const {event,rsvp,session,group,card}=model,pay=F.payment(event,rsvp);
    const booked=['playing','reserve'].includes(rsvp?.status),upcoming=event.event_date>=F.today()&&event.status==='scheduled';
    const matchDay=compact&&session&&event.event_date===F.today()&&event.status!=='cancelled'&&(card||rsvp?.status==='playing');
    const own=group.find(p=>p.is_you||p.member_id===session?.user.id),tee=own?.tee_time;
    const dashboardCard=Boolean(compact&&session&&rsvp?.status==='playing'&&event.status!=='cancelled'&&event.event_date>=F.today()&&event.tee_times_status==='published'&&own&&tee);
    const action=F.nextAction(compact&&!dashboardCard?{...model,card:null,group:[]}:model);
    const scoreAction=dashboardCard&&card&&(action.kind==='scorer'||action.href===F.scoreUrl(model));
    const showPrimary=!scoreAction&&(compact||action.kind!=='link'||action.href!==F.eventUrl(event.id));
    const displayedTee=tee||(!compact?group[0]?.tee_time:null);
    const notes=String(event.notes||'').split('[BARFORD_CANCEL_REASON]')[0].trim();
    const date=new Date(`${event.event_date}T12:00:00`);
    const dateTicket=Number.isNaN(date.getTime())?'':`<div class="clubhouse-date-ticket" aria-hidden="true"><small>${date.toLocaleDateString('en-GB',{month:'short'})}</small><strong>${date.getDate()}</strong><small>${date.getFullYear()}</small></div>`;
    const reason=event.cancel_reason||String(event.notes||'').split('[BARFORD_CANCEL_REASON]')[1]?.trim();
    host.innerHTML=`${event.test_mode_active?'<p class="simple-notice"><strong>Practice event</strong> — this is a test round.</p>':''}
      ${dashboardCard?`<section class="simple-card" id="dashboardScorecard" aria-labelledby="dashboardScorecardTitle">
        <p class="eyebrow">${matchDay?'Playing today':'Tee groups announced'}</p><h2 id="dashboardScorecardTitle">${matchDay?'Today’s group':'Your tee group'}</h2>
        <p><strong>${esc(event.name)}</strong>${tee?` · Tee off ${esc(F.time(tee))}`:''}</p>
        <ul class="simple-player-list dashboard-group-players">${group.map(p=>`<li>${esc(p.full_name||p.guest_name||'Guest')}${p.is_you||p.member_id===session.user.id?' (You)':''}</li>`).join('')}</ul>
        ${card?.status==='ready'&&!card.scorer_id?button('scorer','Choose our scorer',true):''}
        ${card?`<a class="button ${card.status==='ready'&&!card.scorer_id?'button-outline':'button-primary'} full-button" href="${F.scoreUrl(model)}">Open my group’s scorecard</a>
        <p>${['submitted','locked'].includes(card.status)?'Your group’s scores are available to view.':card.scorer_id===session.user.id?'You are keeping score. Open your card to start or continue your round.':card.scorer_id?'You can follow the scorecard here. Your chosen scorer enters the scores.':'Everyone in your group can open this card. Choose one person to enter the scores.'}</p>
        ${card.status==='ready'&&card.scorer_id?button('scorer','Change our scorer'):''}${card.scorer_id?`<p><strong>Scorer:</strong> ${esc(group.find(p=>p.member_id===card.scorer_id)?.full_name||(card.scorer_id===session.user.id?'You':'A member of your group'))}</p>`:''}`:
        `<p role="status">${model.cardError?'We couldn’t load your scorecard. Try again to check it.':'Your group is published. Scorer selection will be available here when the committee prepares your scorecard.'}</p>${button('refresh-card','Check for my scorecard')}`}
      </section>`:''}
      <article class="simple-card simple-next-event">
        <header class="clubhouse-event-heading"><div><p class="eyebrow">${matchDay?'Today’s event':compact?'Your next event':'Your event'}</p>
        <h${compact?'2':'1'}>${esc(event.name)}</h${compact?'2':'1'}>
        <p>${esc(event.venue||'Venue to be confirmed')}</p></div>${dateTicket}</header>
        <div class="clubhouse-event-body"><p class="simple-event-date">${esc(F.date(event.event_date))}</p>
        <div class="simple-next-action"><strong>${esc(F.bookingLabel(model))}</strong><p>${esc(action.message||'')}</p>${showPrimary?button('primary',action.label,true):''}</div>
        ${compact&&matchDay&&!dashboardCard?`<p role="status">${event.tee_times_status==='published'?'Your published tee group is not available here yet. Refresh to check again.':'Your tee time, group and scorer selection will appear above this event once the committee publishes the tee groups.'}</p>${event.tee_times_status==='published'?button('refresh-card','Check my tee group'):''}`:''}
        ${reason&&event.status==='cancelled'?`<p>${esc(reason)}</p>`:''}
        <dl class="simple-facts" id="dashboardEventFacts"><div><dt>Your tee time</dt><dd>${displayedTee?esc(F.time(displayedTee)):rsvp?.status==='playing'?'Not announced yet':'Book to join a group'}</dd></div><div><dt>${esc(F.priceLabel(rsvp))}</dt><dd>${esc(F.money(F.eventPrice(event,rsvp)))}</dd></div>${booked?`<div><dt>Payment</dt><dd>${esc(pay.label)}</dd></div><div><dt>Your request</dt><dd>${rsvp.buggy_requested?'Buggy requested':'Walking'} · ${esc(F.preference(rsvp.preferred_tee_time))} tee time</dd></div>`:''}</dl>
        ${model.availability?`<p class="clubhouse-availability">${esc(model.availability.playing_count||0)}${model.availability.capacity!=null?' of '+esc(model.availability.capacity):''} places booked${model.availability.available!=null?' · '+esc(model.availability.available)+' available':''}${model.availability.reserve_count?' · '+esc(model.availability.reserve_count)+' on reserve':''}</p>`:''}
        ${compact&&!(showPrimary&&action.kind==='link'&&action.href?.startsWith(F.eventUrl(event.id)))?`<a class="simple-back" href="${F.eventUrl(event.id)}">Event details &amp; booking options →</a>`:''}
        </div>
      </article>
      ${!compact?`<section class="simple-card round-hub" aria-label="Round hub"><h2>Your round</h2><div class="round-hub-grid">
        <a href="${card?F.scoreUrl(model):'#my-group'}"><strong>${card?['submitted','locked'].includes(card.status)?'Group scores':'Group scorecard':'My group'}</strong><small>${card?['submitted','locked'].includes(card.status)?card.status==='locked'?'Approved by the committee':'Awaiting committee approval':card.scorer_id===session?.user.id?'You are the scorer':card.scorer_id?'Follow your group’s scores':'Choose one scorer for your group':tee?'Tee off '+esc(F.time(tee)):'Tee time and playing partners'}</small></a>
        <a href="payments.html?event=${encodeURIComponent(event.id)}"><strong>My payment</strong><small>${esc(pay.label)}</small></a>
        <button type="button" data-member-action="roster"><strong>Who’s playing</strong><small>${model.availability?esc(model.availability.playing_count||0)+' booked':'Playing list and reserves'}</small></button>
        <a href="scores.html?view=rounds&event=${encodeURIComponent(event.id)}"><strong>Round results</strong><small>${event.status==='completed'?'View published results':'Available after committee approval'}</small></a>
      </div><div class="round-hub-extras">${event.venue||event.address?button('directions','Directions'):''}<a class="button button-outline" href="gallery.html?event=${encodeURIComponent(event.id)}">Photos</a></div></section>${notes?`<section class="simple-card"><p class="eyebrow">From the committee</p><h2>Round information</h2><p class="simple-notes">${esc(notes)}</p></section>`:''}<details class="simple-card simple-details" id="my-group"><summary>My group${tee?` · ${esc(F.time(tee))}`:""}</summary><div class="simple-detail-content">${group.length?`<p><strong>Tee off at ${esc(F.time(tee))}${own?.tee_number?` · Tee ${esc(own.tee_number)}`:""}</strong></p><ul class="simple-player-list">${group.map(p=>`<li>${p.photo_url?`<button class="group-photo" data-group-photo="${esc(p.member_id)}" aria-label="View ${esc(p.full_name||'member')} photo"><span aria-hidden="true">${esc((p.full_name||'M').slice(0,1))}</span></button>`:""}${esc(p.full_name||p.guest_name||'Guest')}${p.is_you?' (You)':''}${p.buggy_requested?' · Buggy requested':''}</li>`).join('')}</ul>`:`<p>${rsvp?.status==='playing'?'Your group will appear here when the committee publishes the tee times.':rsvp?.status==='reserve'?'Your group will be arranged if a place opens for you.':'Book a place to see your group here.'}</p>`}${card?`<a class="button button-outline" href="${F.scoreUrl(model)}">${['submitted','locked'].includes(card.status)?'View group scores':'Open group scorecard'}</a>${card.status==='ready'?button('scorer','Choose or change our scorer'):''}`:model.cardError?'<p>Your scorecard could not be checked. Please refresh to try again.</p>':''}</div></details>`:''}
      <details class="simple-card simple-details"><summary>${compact?'Booking and event options':'More event options'}</summary><div class="simple-detail-content">
        ${session&&upcoming&&!model.bookingError?(model.locked===true?`<p>Bookings are closed. Ask the committee if you need to change your place or preferences.</p>${button('contact','Request a booking change')}`:model.locked===false?`<div class="simple-actions">${booked?button('book','Change my booking'):''}${button('withdraw',rsvp?.status==='reserve'?'Leave reserve list':'I can’t play')}</div>`:'<p>Booking changes could not be checked. Please refresh.</p>'):''}
        ${compact?`<div class="simple-actions">${session?button('roster','See who’s playing'):''}${event.venue||event.address?button('directions','Get directions'):''}<a class="button button-outline" href="payments.html?event=${encodeURIComponent(event.id)}">Payment details</a><a class="button button-outline" href="scores.html?view=rounds&event=${encodeURIComponent(event.id)}">Round results</a><a class="button button-outline" href="gallery.html?event=${encodeURIComponent(event.id)}">Event photos</a></div>`:''}${event.course_video_url?button('video','Watch course video'):''}
        <p>${event.first_tee_time?`First group tees off at ${esc(F.time(event.first_tee_time))}. This may be different from your own tee time.`:''}</p>${event.address?`<p>${esc(event.address)}</p>`:''}${compact&&notes?`<p class="simple-notes">${esc(notes)}</p>`:''}
        ${session&&rsvp?.status==='playing'&&event.event_date===F.today()?'<button id="dashboardEventCamera" class="button button-outline" type="button">Take event photo</button><input id="dashboardEventCameraInput" class="sr-only" type="file" accept="image/*" capture="environment"><p id="eventPhotoStatus" role="status"></p>':''}
      </div></details>`;
    host.querySelectorAll('[data-member-action]').forEach(b=>b.onclick=()=>{
      const kind=b.dataset.memberAction;
      if(kind==='primary')F.activate(action,model);
      else if(kind==='book')F.openBooking(model);
      else if(kind==='withdraw')F.withdraw(model);
      else if(kind==='roster')F.showRoster(model);
      else if(kind==='directions')F.directions(event);
      else if(kind==='contact')F.contact(event);
      else if(kind==='scorer')F.chooseScorer(model);
      else if(kind==='refresh-card')window.dispatchEvent(new CustomEvent('barford-booking-changed',{detail:{eventId:event.id}}));
      else if(kind==='video'){
        try{const u=new URL(event.course_video_url);if(!['https:','http:'].includes(u.protocol))return;F.dialog('Course video',`<p>Open the course video for ${esc(event.name)}.</p><a class="button button-primary" href="${esc(u.href)}" target="_blank" rel="noopener">Watch video</a>`);}catch{}
      }
    });
    const groupDetails=host.querySelector('#my-group');
    host.querySelectorAll('a[href="#my-group"]').forEach(link=>link.onclick=()=>{if(groupDetails)groupDetails.open=true;});
    if(groupDetails&&window.location?.hash==='#my-group')groupDetails.open=true;
    const pictured=group.filter(p=>p.photo_url).map(p=>({...p,element:host.querySelector(`[data-group-photo="${p.member_id}"]`)})).filter(p=>p.element);
    if(pictured.length)F.request(window.BarfordSupabase.storage.from('profile-images').createSignedUrls([...new Set(pictured.map(p=>p.photo_url))],3600)).then(rows=>{
      const urls=new Map((rows||[]).filter(row=>!row.error&&row.signedUrl).map(row=>[row.path,row.signedUrl]));
      for(const p of pictured){const photo=p.element,url=urls.get(p.photo_url);if(!photo||!url||!photo.isConnected)continue;const img=document.createElement('img');img.src=url;img.alt='';img.loading='lazy';img.decoding='async';photo.replaceChildren(img);photo.dataset.profilePhoto=url;}
    }).catch(()=>{});
    window.BarfordDashboardModel=model;
    window.dispatchEvent(new CustomEvent('barford-dashboard-ready',{detail:model}));
  }
  window.BarfordEventView={render};
})();
