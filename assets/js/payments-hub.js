(() => {
  const F=window.BarfordMemberFlow,client=window.BarfordSupabase,host=document.getElementById('memberPayments'),id=new URLSearchParams(location.search).get('event');
  if(!F||!host)return;
  if(id){const back=document.getElementById('paymentBack');back.href=F.eventUrl(id);back.textContent='← Back to my event';}
  async function load(){
    try{
      const auth=await F.request(client.auth.getSession());
      if(!auth.session){host.innerHTML=`<article class="simple-card"><h2>Sign in to see your payments</h2><a class="button button-primary" href="${F.loginUrl(location.href)}">Sign in</a></article>`;return;}
      const query=client.from('rsvps').select('event_id,status,payment_status').eq('member_id',auth.session.user.id);
      const rsvps=await F.request(id?query.eq('event_id',id):query);
      const ids=id?[id]:rsvps.filter(r=>r.status==='playing'||['paid','refunded','waived'].includes(r.payment_status)).map(r=>r.event_id);
      if(!ids.length){host.innerHTML='<article class="simple-card"><h2>No event payments to show</h2><p>Your payments will appear here when you book an event.</p><a class="button button-primary" href="events.html">View events</a></article>';return;}
      const events=await F.request(client.from('events').select('*').in('id',ids).order('event_date'));
      if(!events.length){host.innerHTML='<article class="simple-card"><h2>Event not found</h2><a class="button button-outline" href="payments.html">View all my payments</a></article>';return;}
      const total=F.paymentSummary(events,rsvps);
      host.innerHTML=`<section class="simple-card"><p class="eyebrow">${id?'This event':'Your payment overview'}</p><h2>£${(total.pence/100).toFixed(2)} outstanding</h2><p>${total.count} event${total.count===1?'':'s'} to pay${total.unpriced?` · ${total.unpriced} awaiting a price`:''}. Payments are confirmed by the committee.</p>${id?'<a class="button button-outline" href="payments.html">View all my payments</a>':''}<button class="button button-outline" id="refreshPaymentStatus" type="button">Refresh payment status</button></section>`+events.map(e=>{const r=rsvps.find(x=>x.event_id===e.id),pay=F.payment(e,r);return `<article class="simple-card"><h2>${F.esc(e.name)}</h2><p>${F.esc(F.date(e.event_date))}</p><p class="simple-payment-state"><strong>${F.esc(pay.label)}</strong></p>${pay.due?'<p>Pay the committee using the society’s usual payment method. Ask for the details below. They will mark your payment as paid when it is confirmed.</p>':e.status==='cancelled'&&r?.payment_status==='paid'?'<p>If you need to discuss a refund, please ask the committee.</p>':r?.status==='reserve'?'<p>You do not need to pay while waiting for a place.</p>':''}${pay.due?`<button class="button button-primary" data-payment-help="${F.esc(e.id)}">Ask for payment details</button><details class="simple-details"><summary>Already paid?</summary><p>Your payment has not yet been marked as paid. Ask the committee to check it before making another payment.</p><button class="button button-outline" data-payment-check="${F.esc(e.id)}">Ask the committee to check</button></details>`:''}<a class="button button-outline" href="${F.eventUrl(e.id)}">Back to event</a></article>`;}).join('')||'<p>The event could not be found.</p>';
      host.querySelector('#refreshPaymentStatus').onclick=load;
      host.querySelectorAll('[data-payment-help],[data-payment-check]').forEach(b=>b.onclick=()=>F.contact(events.find(e=>e.id===(b.dataset.paymentHelp||b.dataset.paymentCheck)),b.dataset.paymentCheck?'check a payment I have already made':'get the payment details'));
    }catch{host.innerHTML='<article class="simple-card"><h2>Payments could not be checked</h2><p>Please try again to see the latest payment status.</p><button class="button button-primary" id="retryPayments">Try again</button></article>';host.querySelector('#retryPayments').onclick=load;}
  }
  load();
})();
