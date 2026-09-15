(() => {
  const F=window.BarfordMemberFlow,client=window.BarfordSupabase,host=document.getElementById('memberPayments'),id=new URLSearchParams(location.search).get('event');
  if(!F||!host)return;
  if(id){const back=document.getElementById('paymentBack');back.href=F.eventUrl(id);back.textContent='← Back to my event';}
  async function load(){
    try{
      const auth=await F.request(client.auth.getSession());
      if(!auth.session){host.innerHTML=`<article class="simple-card"><h2>Sign in to see your payments</h2><a class="button button-primary" href="${F.loginUrl(location.href)}">Sign in</a></article>`;return;}
      const query=client.from('rsvps').select('event_id,status,payment_status,is_course_member').eq('member_id',auth.session.user.id);
      const rsvps=await F.request(id?query.eq('event_id',id):query);
      const ids=id?[id]:rsvps.filter(r=>r.status==='playing'||['paid','refunded','waived'].includes(r.payment_status)).map(r=>r.event_id);
      if(!ids.length){host.innerHTML='<article class="simple-card"><h2>No event payments to show</h2><p>Your payments will appear here when you book an event.</p><a class="button button-primary" href="events.html">View events</a></article>';return;}
      const events=await F.request(client.from('events').select('*').in('id',ids).order('event_date'));
      if(!events.length){host.innerHTML='<article class="simple-card"><h2>Event not found</h2><a class="button button-outline" href="payments.html">View all my payments</a></article>';return;}
      const total=F.paymentSummary(events,rsvps);
      const due=events.filter(e=>F.payment(e,rsvps.find(r=>r.event_id===e.id)).due);
      const other=events.filter(e=>!due.includes(e));
      const receipt=e=>{const r=rsvps.find(x=>x.event_id===e.id),pay=F.payment(e,r);return `<article class="simple-card payment-receipt"><p class="eyebrow">${F.esc(F.date(e.event_date))}</p><h2>${F.esc(e.name)}</h2><p>${F.esc(F.priceLabel(r))}</p><p class="simple-payment-state"><strong>${F.esc(pay.label)}</strong></p>${pay.due?'<p>Payment details are available from the committee. Your status changes to Paid when they confirm receipt.</p>':e.status==='cancelled'&&r?.payment_status==='paid'?'<p>Contact the committee to check your refund.</p>':r?.status==='reserve'?'<p>No payment is needed while you wait for a place.</p>':''}${pay.due?`<button class="button button-primary full-button" data-payment-help="${F.esc(e.id)}">Get payment instructions</button><details class="simple-details"><summary>Already sent your payment?</summary><p>It has not been confirmed yet. Ask the committee to check before paying again.</p><button class="button button-outline" data-payment-check="${F.esc(e.id)}">Ask for confirmation</button></details>`:''}${r?.status==='playing'&&e.status==='scheduled'?`<a class="button button-outline full-button" href="${F.eventUrl(e.id)}#my-group">View my tee group →</a><p>Your tee time and group appear there when announced.</p>`:''}<a class="simple-back" href="${F.eventUrl(e.id)}">Back to this event</a></article>`;};
      host.innerHTML=`<section class="simple-card"><p class="eyebrow">${id?'This event':'My payments'}</p><h2>£${(total.pence/100).toFixed(2)} outstanding</h2><p>${total.count?`${total.count} event${total.count===1?'':'s'} to pay.`:'No confirmed event fees outstanding.'}${total.unpriced?` ${total.unpriced} booking${total.unpriced===1?' is':'s are'} awaiting a price.`:''}</p><button class="button button-outline" id="refreshPaymentStatus" type="button">Check payment status</button>${id?'<a class="simple-back" href="payments.html">All my payments</a>':''}</section>`+due.map(receipt).join('')+(other.length?(id?other.map(receipt).join(''):`<details class="simple-card simple-details"><summary>Other bookings and payment history (${other.length})</summary><div class="simple-detail-content">${other.map(receipt).join('')}</div></details>`):'');
      host.querySelector('#refreshPaymentStatus').onclick=load;
      host.querySelectorAll('[data-payment-help],[data-payment-check]').forEach(b=>b.onclick=()=>F.contact(events.find(e=>e.id===(b.dataset.paymentHelp||b.dataset.paymentCheck)),b.dataset.paymentCheck?'check a payment I have already made':'get the payment details'));
    }catch{host.innerHTML='<article class="simple-card"><h2>Payments could not be checked</h2><p>Please try again to see the latest payment status.</p><button class="button button-primary" id="retryPayments">Try again</button></article>';host.querySelector('#retryPayments').onclick=load;}
  }
  load();
})();
