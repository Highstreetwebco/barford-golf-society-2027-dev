(() => {
 'use strict';
 const F=window.BarfordMemberFlow,G=window.BarfordGuestEvents,client=window.BarfordSupabase;
 const board=document.querySelector('#round'),fixtures=document.querySelector('#fixtures'),dock=document.querySelector('#actionDock');
 let events=[],session=null,selected=null,filter='upcoming',generation=0,authReady=false;
 const E=value=>F.esc(value);
 const position=(n,title,value,detail='')=>`<div class="position"><span class="position-num">${n}</span><div><small>${title}</small><strong>${E(value)}</strong>${detail}</div></div>`;
 function list(){
  const available=events.filter(e=>filter==='upcoming'?e.event_date>=F.today()&&e.status!=='completed':e.event_date<F.today()||e.status==='completed');
  if(filter==='past')available.reverse();
  fixtures.innerHTML=available.length?available.map(e=>`<button class="fixture" data-event="${E(e.id)}" aria-pressed="${e.id===selected}"><span class="fixture-date">${E(e.event_date?.slice(8,10))}<small>${E(new Date(e.event_date+'T12:00:00').toLocaleDateString('en-GB',{month:'short'}).toUpperCase())}</small></span><span><strong>${E(e.name)}</strong><em>${e.status==='cancelled'?'Cancelled':E(new Date(e.event_date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long'}))}</em></span><span aria-hidden="true">↗</span></button>`).join(''):`<p class="loading">No ${filter==='past'?'past':'upcoming'} rounds yet.</p>`;
  fixtures.querySelectorAll('[data-event]').forEach(b=>b.onclick=()=>select(b.dataset.event));
  return available;
 }
 function action(label,detail,handler){dock.hidden=false;dock.innerHTML=`<div><small>Your next step</small><strong>${E(detail)}</strong></div><button type="button">${E(label)} <span aria-hidden="true">↗</span></button>`;dock.querySelector('button').onclick=handler;}
 async function select(id){
  selected=id;const turn=++generation;list();dock.hidden=true;
  const event=events.find(e=>e.id===id);if(!event){board.innerHTML='<p class="loading">Choose another diary view to find a round.</p>';return;}
  board.innerHTML='<p class="loading">Checking your place, payment and group…</p>';
  const url=new URL(location.href);url.searchParams.set('event',id);history.replaceState(null,'',url);
  try{
   if(!authReady)throw new Error('We couldn’t check your sign-in. Retry to check your booking safely.');
   const model=session?await F.loadEvent(id):null,guest=session?null:await G.state(id);
   if(turn!==generation)return;
   const e=model?.event||event,past=e.event_date<F.today()||e.status==='completed',cancelled=e.status==='cancelled';
   let booking,pay,detail='',label,handler,next;
   if(model){
    booking=F.bookingLabel(model);pay=model.bookingError?'Payment could not be checked':F.payment(e,model.rsvp).label;next=F.nextAction(model);
    label=next.label;detail=next.message||booking;handler=()=>next.kind==='retry'?select(id):F.activate(next,model);
   }else{
    const own=guest.booking,closed=cancelled||past||guest.locked||e.guests_allowed===false;
    booking=cancelled?'Event cancelled':own?.status==='playing'?`${own.guest_name} (guest) · Playing`:own?.status==='reserve'?'You’re on the reserve list':own?'Your booking is cancelled':past?'Round complete':closed?'Guest RSVPs are closed':'You haven’t booked yet';
    pay=cancelled?'Event cancelled':own?.status!=='playing'?'No payment requested':own.payment_status==='paid'?'Paid':own.payment_status==='refunded'?'Payment refunded':own.payment_status==='waived'||own.amount_due!=null&&Number(own.amount_due)===0?'No payment needed':own.amount_due==null?'Price to be confirmed':`${F.money(own.amount_due)} outstanding`;
    const full=guest.available===0||guest.guest_available===0;
    label=past?'View results':own||closed?'Ask the committee':full?'Join reserve list':'RSVP as a guest';
    detail=past?'See how the round finished':own?'Your booking is saved':closed?'Need help with this round?':'Just your name. No account needed.';
    handler=past?()=>{location.href=`scores.html?view=rounds&event=${encodeURIComponent(id)}`;}:own||closed?()=>F.contact(e):()=>G.openBooking(e,full);
   }
   const group=model?.group||[],tee=group.find(p=>p.is_you)?.tee_time||group[0]?.tee_time;
   board.innerHTML=`<div class="round-top"><p class="eyebrow">${E(F.date(e.event_date))}</p><span class="stamp">${cancelled?'Cancelled':past?'Round complete':e.event_date===F.today()?'Today’s golf':'Next on the tee'}</span></div><h2>${E(e.name)}</h2><p class="venue">${E(e.venue||'Barford Golf Society round')}</p>${position('01','YOUR PLACE',booking,`<p>${E(detail)}</p>`)}${position('02','PAYMENT',pay,model?.rsvp?.status==='playing'?`<a href="payments.html?event=${encodeURIComponent(id)}">Payment details ↗</a>`:'')}${position('03','YOUR GROUP',tee?`Tee off ${F.time(tee)}`:past?'Round overview':model?.rsvp?.status==='playing'?'Tee time not available yet':'Book to join the tee sheet',group.length?`<p>${group.map(p=>E(p.full_name||p.guest_name||'Guest')+(p.is_you?' (you)':'')).join(' · ')}</p>`:`<p>${session?'Published tee groups and your scorecard appear here.':'Members can sign in to see their group and scorecard.'}</p>`)}<div id="scoreActions"></div><dl class="prices"><div><dt>Barford member</dt><dd>${E(F.money(e.price))}</dd></div><div><dt>Guest</dt><dd>${E(F.money(e.guest_price??e.price))}</dd></div><div><dt>Course member</dt><dd>${E(F.money(e.course_member_price))}</dd></div></dl><details><summary>Round details &amp; useful links</summary><p class="notes">${E(e.notes||e.description||'More round information will appear here when announced.')}</p><p>Course member pricing is for Barford members who also belong to the host course.</p><p><a href="${F.eventUrl(id)}">Full event details ↗</a> · <a href="scores.html?view=rounds&event=${encodeURIComponent(id)}">Round scores ↗</a></p><button class="text-button" id="directions">Get directions</button></details>${!session?`<p class="venue">Already a member? <a href="${E(F.loginUrl(url.href))}">Sign in for your booking and group ↗</a></p>`:''}`;
   board.querySelector('#directions').onclick=()=>F.directions(e);
   const score=board.querySelector('#scoreActions');
   if(model?.card){
    score.innerHTML=`<p><a href="${F.scoreUrl(model)}">${['submitted','locked'].includes(model.card.status)?'View submitted group scores':'Open group scorecard'} ↗</a></p>${model.card.status==='ready'?'<button class="text-button" id="scorer">Choose or change our scorer</button>':''}`;
    score.querySelector('#scorer')?.addEventListener('click',()=>F.chooseScorer(model));
   }else if(model?.cardError)score.innerHTML='<p>We couldn’t check your scorecard. <button class="text-button" id="retryCard">Try again</button></p>';
   score.querySelector('#retryCard')?.addEventListener('click',()=>select(id));
   if(label)action(label,detail,handler);
  }catch(error){if(turn!==generation)return;board.innerHTML=`<p class="eyebrow">CONNECTION CHECK</p><h2>Let’s try that again.</h2><p>${E(error.message||'This round could not be loaded.')}</p>`;action('Try again','Your booking has not been changed',()=>authReady?select(id):boot());}
 }
 async function boot(){
  try{
   if(!client||!F||!G)throw new Error('The connection could not start. Please refresh this page.');
   const [auth,data]=await Promise.all([F.request(client.auth.getSession()),F.request(client.from('events').select('*').in('status',['scheduled','cancelled','completed']).order('event_date'))]);
   session=auth.session;authReady=true;events=data||[];
   const account=document.querySelector('#accountLink');account.textContent=session?'My account':'Member sign in';account.href=session?'account.html':F.loginUrl(location.href);
   document.querySelector('#adminLink').hidden=true;
   if(session)F.request(client.from('profiles').select('is_admin').eq('id',session.user.id).maybeSingle()).then(p=>{document.querySelector('#adminLink').hidden=p?.is_admin!==true;}).catch(()=>{});
   const requested=new URLSearchParams(location.search).get('event');const found=events.find(e=>e.id===(selected||requested));
   if(found&&(found.event_date<F.today()||found.status==='completed'))filter='past';
   document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===filter)));
   const available=list();select(found?.id||available[0]?.id);
  }catch(error){fixtures.innerHTML='<p class="loading">The diary could not be loaded.</p>';board.innerHTML=`<h2>Connection paused.</h2><p>${F?E(error.message):'Please refresh to reconnect.'}</p>`;if(F)action('Try again','Reconnect to the diary',boot);}
 }
 document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));const available=list();select(available[0]?.id);});
 window.addEventListener('barford-booking-changed',()=>selected&&select(selected));
 boot();
})();
