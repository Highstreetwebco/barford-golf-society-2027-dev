const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function demo(){
 const controls=new Map(),timers=new Map();let next=0,closeHandler,html='';
 const control=k=>{if(!controls.has(k))controls.set(k,{focus(){}});return controls.get(k);};
 const methods=['Apple Pay','Google Pay','Card'].map(m=>({dataset:{demoMethod:m},focus(){}}));
 const stage={innerHTML:'',querySelector:control,querySelectorAll:()=>methods};
 const dialog={isConnected:true,classList:{add(){}},querySelector:()=>stage,addEventListener:(name,fn)=>{if(name==='close')closeHandler=fn;},close(){this.isConnected=false;closeHandler();}};
 const F={money:n=>'£'+n.toFixed(2),eventPrice:(e,r)=>r.is_course_member?e.course_member_price:e.price,priceLabel:r=>r.is_course_member?'Course member price':'Barford member price',esc:x=>String(x).replaceAll('<','&lt;'),dialog:(title,content)=>{html=content;return dialog;}};
 const window={BarfordMemberFlow:F};Object.defineProperty(window,'BarfordSupabase',{get(){throw Error('Demo must never access database or payment API');}});
 const c={window,setTimeout:fn=>{timers.set(++next,fn);return next;},clearTimeout:id=>timers.delete(id)};
 vm.createContext(c);vm.runInContext(fs.readFileSync('assets/js/payment-demo.js','utf8'),c);
 return {open:c.window.BarfordPaymentDemo.open,stage,control,methods,dialog,timers,html:()=>html};
}
test('all demo methods complete locally using the selected event price, without changing a booking',()=>{
 for(const choice of ['Apple Pay','Google Pay','Card']){
  const h=demo(),event={name:'<Golf day>',price:40,course_member_price:15},rsvp={is_course_member:true,payment_status:'unpaid'};
  h.open(event,rsvp);assert.match(h.html(),/£15.00/);assert.match(h.html(),/&lt;Golf day>/);assert.match(h.html(),/DEMO/);
  h.methods.find(m=>m.dataset.demoMethod===choice).onclick();
  h.control('[data-demo-confirm]').onclick();h.control('[data-demo-confirm]').onclick();assert.equal(h.timers.size,1);
  assert.match(h.stage.innerHTML,/Processing demo payment/);
  [...h.timers.values()][0]();assert.match(h.stage.innerHTML,/Demo payment complete/);assert.ok(h.stage.innerHTML.includes(choice));assert.match(h.stage.innerHTML,/actual booking remains unpaid/);
  assert.equal(rsvp.payment_status,'unpaid');
  h.control('[data-demo-replay]').onclick();assert.match(h.stage.innerHTML,/Choose how to pay/);
 }
});
test('closing a processing demo cancels its animation and prevents a late confirmation',()=>{
 const h=demo();h.open({name:'Golf',price:40},{});h.control('[data-demo-confirm]').onclick();const late=[...h.timers.values()][0];h.dialog.close();assert.equal(h.timers.size,0);late();assert.doesNotMatch(h.stage.innerHTML,/Demo payment complete/);
});
test('Pay now routes to the demo only while real checkout is disabled',async()=>{
 let demos=0,real=0;const config={stripeCheckoutEnabled:false,stripeCheckoutFunction:'checkout'};
 const c={window:{BarfordMemberFlow:{payment:()=>({due:true}),bounded:p=>p,dialog(){}},BarfordPaymentDemo:{open(){demos++;}},BARFORD_2027_CONFIG:config,BarfordSupabase:{functions:{invoke:async()=>{real++;return{data:{url:'https://checkout.stripe.com/example'}};}}}},URL,navigator:{onLine:true},location:{assign(){}}};
 vm.createContext(c);vm.runInContext(fs.readFileSync('assets/js/payment-checkout.js','utf8'),c);
 const b={disabled:false,textContent:'Pay now'};await c.window.BarfordPayments.pay({id:'one'},{},b);assert.equal(demos,1);assert.equal(real,0);
 config.stripeCheckoutEnabled=true;await c.window.BarfordPayments.pay({id:'one'},{},b);assert.equal(demos,1);assert.equal(real,1);
});
