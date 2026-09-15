(() => {
  'use strict';
  const F=window.BarfordMemberFlow,client=window.BarfordSupabase,member=document.getElementById('memberHomeDashboard'),publicHome=document.getElementById('publicHome'),host=document.getElementById('memberDashboardEvent');
  if(!F||!member)return;
  let loading=false;
  async function load(){
    if(loading)return;loading=true;
    try{
      const auth=await F.request(client.auth.getSession());
      member.classList.toggle('hidden',!auth.session);publicHome.classList.toggle('hidden',Boolean(auth.session));
      if(!auth.session)return;
      document.getElementById('dashboardFirstName').textContent=(auth.session.user.user_metadata?.full_name||'member').trim().split(/\s+/)[0];
      const day=F.today();
      const fetchedEvents=await F.request(client.from('events').select('*').in('status',['scheduled','completed']).gte('event_date',day).order('event_date').order('first_tee_time'));
      const events=fetchedEvents.filter(event=>event.status==='scheduled'||event.event_date===day);
      if(!events.length){host.innerHTML='<article class="simple-card"><h2>No upcoming events yet</h2><p>The committee will add the next event here.</p><a class="button button-primary" href="events.html">View event calendar</a></article>';return;}
      const rsvps=await F.request(client.from('rsvps').select('id,event_id,status,payment_status,is_course_member,buggy_requested,preferred_tee_time').eq('member_id',auth.session.user.id).in('event_id',events.map(e=>e.id)));
      const next=F.dashboardEvent(events,rsvps);
      const model=await F.loadEvent(next.id,{session:auth.session,event:next,rsvp:rsvps.find(r=>r.event_id===next.id)||null});window.BarfordEventView.render(host,model,{compact:true});
      const unanswered=events.filter(e=>e.id!==next.id&&e.status==='scheduled'&&!rsvps.some(r=>r.event_id===e.id));
      if(unanswered.length){const reminder=document.createElement('section');reminder.className='simple-card dashboard-rsvp-reminder';reminder.innerHTML=`<h2>${unanswered.length===1?'Another golf day is waiting':`${unanswered.length} golf days are waiting`}</h2><p>Your booked round stays above. Choose whether you’re playing the other dates.</p><a class="button button-outline" href="events.html">Review upcoming events</a>`;host.append(reminder);}

    }catch(error){
      member.classList.remove('hidden');publicHome.classList.add('hidden');
      host.innerHTML=`<article class="simple-card"><h2>Your dashboard could not be loaded</h2><p role="status">${F.esc(error.message||'Please try again.')}</p><button id="retryDashboard" type="button" class="button button-primary">Try again</button><a class="button button-outline" href="account.html">Open my account</a></article>`;host.querySelector('#retryDashboard').onclick=load;
    }finally{loading=false;}
  }
  window.addEventListener('barford-booking-changed',load);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')load();});
  load();F.promotions();
})();
