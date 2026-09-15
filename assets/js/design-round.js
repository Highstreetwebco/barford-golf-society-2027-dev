(() => {
 'use strict';
 const F=window.BarfordMemberFlow;
 function statuses(model){
  const {event,rsvp,session,bookingError,group=[]}=model;
  if(!session)return [{label:'Booking',value:'Sign in to check',tone:'neutral'},{label:'Payment',value:'Sign in to check',tone:'neutral'},{label:'Tee group',value:'Sign in to check',tone:'neutral'}];
  if(bookingError)return [{label:'Booking',value:'Couldn’t check',tone:'attention'},{label:'Payment',value:'Couldn’t check',tone:'attention'},{label:'Tee group',value:'Check your booking first',tone:'neutral'}];
  const booked=rsvp?.status==='playing',reserve=rsvp?.status==='reserve',cancelled=event.status==='cancelled';
  const payment=F.payment(event,rsvp),tee=group.find(p=>p.is_you)?.tee_time||group[0]?.tee_time;
  const paymentValue=payment.due?payment.label:payment.label==='Book before paying'?'Nothing due yet':payment.label==='No payment requested while on reserve'?'Nothing due on reserve':payment.label;
  return [
   {label:'Booking',value:cancelled?'Event cancelled':booked?'You’re booked':reserve?'On reserve':rsvp?'Not playing':'Not booked',tone:cancelled?'neutral':booked?'confirmed':reserve?'attention':'neutral'},
   {label:'Payment',value:paymentValue,tone:payment.due?'attention':['Paid','No payment needed','Payment refunded'].includes(payment.label)?'confirmed':'neutral'},
   {label:'Tee group',value:cancelled?'Event cancelled':!booked?reserve?'Waiting for a place':'Book to join a group':tee?'Tee off '+F.time(tee):event.tee_times_status==='published'?'Awaiting confirmation':'Not announced yet',tone:!cancelled&&booked&&tee?'confirmed':'neutral'}
  ];
 }
 window.BarfordRoundDesign={statuses};
 if(document.documentElement.dataset.design!=='round')return;
 const gateway=document.querySelector('#visitorGateway');
 if(gateway)gateway.innerHTML=`<section class="round-entrance"><div class="round-entrance-title"><p class="eyebrow">BARFORD GOLF SOCIETY / 2027</p><h1>Your golf day.<br><span>All in one place.</span></h1><p>Book your place. Check your group.<br>Keep score together.</p></div><nav class="round-entry-options" aria-label="Choose how to join"><a class="round-entry-member" href="account.html"><span class="round-route-label">BARFORD MEMBERS</span><strong>Sign in to my dashboard <b aria-hidden="true">→</b></strong><small>Your booking, payment and group scorecard.</small></a><a class="round-entry-guest" href="events.html?guest=1"><span class="round-route-label">PLAYING AS A GUEST?</span><strong>Find an event &amp; RSVP <b aria-hidden="true">→</b></strong><small>No account needed. Just choose a golf day.</small></a></nav><p class="round-create">New Barford member? <a href="signup.html">Create an account</a></p><div class="round-entrance-bottom"><span>7 rounds · Best 5 count</span><a href="scores.html">See the leaderboard <span aria-hidden="true">↗</span></a></div></section>`;
 const welcome=document.querySelector('.simple-welcome');
 if(welcome){const eyebrow=welcome.querySelector('.eyebrow');if(eyebrow)eyebrow.textContent='YOUR DASHBOARD';}
 function enhance(model){
  if(!F||!model?.event||!model.session)return;
  const host=document.querySelector('#memberDashboardEvent')||document.querySelector('#memberEventHub');
  // The shared event renderer dispatches after each successful load or booking update.
  const article=host?.querySelector('.simple-next-event');
  if(!article||article.dataset.roundReady)return;
  article.dataset.roundReady='true';
  const body=article.querySelector('.clubhouse-event-body'),heading=article.querySelector('.clubhouse-event-heading');
  if(!body||!heading)return;
  const overview=document.createElement('dl');overview.className='round-booking-status';overview.setAttribute('aria-label','Your booking at a glance');
  overview.innerHTML=statuses(model).map(s=>`<div data-status="${s.tone}"><dt>${F.esc(s.label)}</dt><dd>${F.esc(s.value)}</dd></div>`).join('');
  heading.after(overview);
  const action=body.querySelector('.simple-next-action');
  if(action){
   const label=document.createElement('p');label.className='round-next-label';label.textContent=action.querySelector('button,a')?'YOUR NEXT STEP':'YOUR BOOKING';action.prepend(label);
   // Booking is already represented above. Keep the action and useful explanation together.
   action.querySelector(':scope > strong')?.remove();
   if(!model.bookingError&&model.rsvp?.status==='playing'&&F.eventPrice(model.event,model.rsvp)==null&&model.event.status==='scheduled'&&model.event.event_date>F.today()){
    const explanation=action.querySelector('p:not(.round-next-label)');if(explanation)explanation.textContent='Your place is booked. The price has not been confirmed yet. Check your event for updates.';
   }
  }
  const facts=body.querySelector('.simple-facts');
  if(facts){const details=document.createElement('details');details.className='round-full-details';const summary=document.createElement('summary');summary.textContent='Full booking details';details.append(summary);facts.before(details);details.append(facts);}
 }
 window.addEventListener('barford-dashboard-ready',event=>enhance(event.detail));
 enhance(window.BarfordDashboardModel);
})();
