(() => {
  'use strict';
  const F=window.BarfordMemberFlow;
  if(!F)return;
  function open(event,rsvp){
    const amount=F.money(F.eventPrice(event,rsvp));
    const d=F.dialog('Event checkout',`<p class="payment-demo-badge">DEMO · No money will be taken</p><div class="payment-demo-summary"><span>${F.esc(event.name)}<small>${F.esc(F.priceLabel(rsvp))}</small></span><strong>${F.esc(amount)}</strong></div><div data-demo-stage></div>`);
    d.classList.add('payment-demo');
    const stage=d.querySelector('[data-demo-stage]');let timer,closed=false,busy=false,method='Apple Pay';
    d.addEventListener('close',()=>{closed=true;clearTimeout(timer);},{once:true});
    function choose(){
      busy=false;
      stage.innerHTML=`<p class="payment-demo-label">Choose how to pay</p><div class="payment-demo-methods" role="group" aria-label="Demo payment method">${['Apple Pay','Google Pay','Card'].map(m=>`<button type="button" data-demo-method="${m}" aria-pressed="${m===method}">${m}</button>`).join('')}</div><div class="payment-demo-card"><small>EXAMPLE PAYMENT CARD</small><strong>•••• •••• •••• 4242</strong><span>Demo card · No card details needed</span></div><p data-demo-method-note>${method==='Card'?'This preview uses a sample card. The live checkout will let you enter your card details.':`A preview of paying with ${method}. Your wallet will not open.`}</p><button type="button" class="button payment-demo-pay" data-demo-confirm>Demo pay ${F.esc(amount)}</button><p class="payment-demo-footnote">Presentation preview only. Your actual booking remains unpaid.</p>`;
      stage.querySelectorAll('[data-demo-method]').forEach(button=>button.onclick=()=>{method=button.dataset.demoMethod;choose();stage.querySelector(`[data-demo-method="${method}"]`).focus();});
      stage.querySelector('[data-demo-confirm]').onclick=()=>{
        if(busy||closed)return;busy=true;
        stage.innerHTML=`<div class="payment-demo-outcome" role="status" aria-live="polite"><span class="payment-demo-spinner" aria-hidden="true"></span><h3>Processing demo payment…</h3><p>${F.esc(method)} · ${F.esc(amount)}</p></div>`;
        timer=setTimeout(()=>{
          if(closed||!d.isConnected)return;
          stage.innerHTML=`<div class="payment-demo-outcome" role="status" aria-live="polite"><span class="payment-demo-tick" aria-hidden="true">✓</span><h3>Demo payment complete</h3><p><strong>${F.esc(amount)}</strong> via ${F.esc(method)}</p><p>This is how confirmation will appear after a successful payment.</p><p class="payment-demo-footnote">No money was taken. Your actual booking remains unpaid.</p></div><button type="button" class="button payment-demo-pay" data-demo-done>Done</button><button type="button" class="button button-outline full-button" data-demo-replay>Replay demo</button>`;
          stage.querySelector('[data-demo-done]').onclick=()=>d.close();
          stage.querySelector('[data-demo-replay]').onclick=choose;
          stage.querySelector('[data-demo-done]').focus();
        },1100);
      };
    }
    choose();
  }
  window.BarfordPaymentDemo={open};
})();
