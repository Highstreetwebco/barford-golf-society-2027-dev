(() => {
  'use strict';
  const F=window.BarfordMemberFlow,client=window.BarfordSupabase,config=window.BARFORD_2027_CONFIG;
  async function pay(event,rsvp,button){
    if(!event||!F.payment(event,rsvp).due||button.disabled)return;
    if(!config.stripeCheckoutEnabled){
      if(window.BarfordPaymentDemo){window.BarfordPaymentDemo.open(event,rsvp);return;}
      const d=F.dialog('Online payments coming soon',`<p><strong>${F.esc(event.name)}</strong></p><p>${F.esc(F.priceLabel(rsvp))} · ${F.esc(F.money(F.eventPrice(event,rsvp)))}</p><p>Online payments aren’t available yet. Your booking is saved and remains unpaid. Contact the committee for payment instructions.</p><button class="button button-primary" type="button" data-payment-instructions>Get payment instructions</button>`);
      d.querySelector('[data-payment-instructions]').onclick=()=>{d.close();F.contact(event,'get the payment details');};return;
    }
    const label=button.textContent;button.disabled=true;button.textContent='Opening secure payment…';
    try{
      if(!navigator.onLine)throw Error('Reconnect to the internet to pay.');
      // The backend authenticates the member, checks their live booking and
      // determines the price. Never accept an amount or paid flag from this page.
      const {data,error}=await F.bounded(client.functions.invoke(config.stripeCheckoutFunction,{body:{event_id:event.id}}),15000);
      if(error)throw Error('Payment could not be opened. Please try again shortly.');
      const url=new URL(data?.url);
      if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com'||url.username||url.password)throw Error('A secure payment link is not available yet.');
      location.assign(url.href);
    }catch(error){F.dialog('Payment not opened',`<p>${F.esc(error.message||'Please try again.')}</p><p>Your payment status has not changed.</p>`);}
    finally{button.disabled=false;button.textContent=label;}
  }
  window.BarfordPayments={pay};
})();
