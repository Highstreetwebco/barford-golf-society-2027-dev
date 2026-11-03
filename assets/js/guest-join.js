import {photoPickerHTML,wirePhotoPicker} from './photo-input.js?v=2027-guest-rsvp-1';
import {guestFields,guestPayload,wireTerms} from './guest-form.js?v=2027-guest-rsvp-1';
import {calendarLinks,calendarICS} from './event-calendar.js?v=2027-guest-rsvp-1';
const area=document.getElementById('guestJoin'), title=document.getElementById('guestTitle');
const token=location.hash.slice(1), endpoint='https://xspzmthygrajzktydvvj.supabase.co/functions/v1/guest-rsvp';
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>new Date(value+'T12:00:00Z').toLocaleDateString('en-GB',{timeZone:'Europe/London',weekday:'short',day:'numeric',month:'long',year:'numeric'});
const money=value=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(value);
let invite,dirty=false,busy=false;
window.addEventListener('beforeunload',event=>{if(dirty||busy){event.preventDefault();event.returnValue='';}});
async function action(name,payload={}) {
  const response=await fetch(endpoint,{method:'POST',headers:{apikey:'sb_publishable_xLM39PjQf4XdTVfNHFOzAQ_i4re6w_c','Content-Type':'application/json'},body:JSON.stringify({action:name,token,...payload}),signal:AbortSignal.timeout(20000)});
  const data=await response.json();if(!response.ok||data.error)throw new Error(data.error||'Your RSVP could not be saved. Please try again.');return data;
}
function eventDetails() {
  title.textContent=`You’ve been invited to ${invite.event_name}`;
  document.title=invite.event_name+' guest invitation | Barford Golf Society';
  return `<p class="eyebrow">INVITED BY ${e(invite.host_name)}</p><div class="guest-event-facts"><p><strong>${e(date(invite.date))}</strong></p><p>${e(invite.address||invite.location||'Venue details to follow')}</p><p>${invite.guest_price==null?'Guest price to be confirmed':`Guest price <strong>${money(invite.guest_price)}</strong>`}${invite.payment_due?` · Payment due ${e(date(invite.payment_due))}`:''}</p></div>`;
}
function focusHeading(){area.querySelector('h2')?.focus({preventScroll:true});}
function showForm() {
  const joined=invite.status==='joined';dirty=false;
  area.innerHTML=eventDetails()+`<h2 tabindex="-1">${joined?'Edit your RSVP':'Join the event'}</h2><p>No account or password needed. ${invite.event_type!=='social'?`You’ll be grouped with ${e(invite.host_name)} when both of you have confirmed places.`:''}</p>${!joined&&invite.waiting?'<p class="notice">The event is full. Your RSVP will join the waiting list; it is not a confirmed place.</p>':''}<form id="guestForm" class="form-stack">${guestFields(invite,e,date)}${invite.photo_url?`<img class="photo-preview" src="${e(invite.photo_url)}" alt="Your current profile photo"><label class="check"><input type="checkbox" name="remove_photo">Remove current photo</label>`:''}<div data-photo>${photoPickerHTML()}</div><p class="muted">Keep this invitation private. Anyone with its link can view and edit this RSVP before the deadline.</p><div class="actions"><button type="submit">${joined?'Save RSVP':invite.waiting?'Join waiting list':'RSVP to event'}</button>${joined?'<button type="button" class="secondary" data-back>Back to confirmation</button>':''}</div><p class="form-status" role="status"></p><button type="button" class="text-button" data-reload hidden>Reload latest RSVP</button></form>`;
  const form=area.querySelector('form'), selected=wirePhotoPicker(form.querySelector('[data-photo]')), status=form.querySelector('[role=status]');
  wireTerms(form);form.addEventListener('input',()=>dirty=true);
  form.querySelector('[data-back]')?.addEventListener('click',()=>{if(!dirty||confirm('Discard your unsaved changes?'))showConfirmation();});
  form.querySelector('[data-reload]').onclick=async()=>{if(!dirty||confirm('Reload and discard unsaved changes?')){dirty=false;await load();}};
  form.onsubmit=async event=>{
    event.preventDefault();if(busy||!form.reportValidity())return;
    busy=true;form.inert=true;status.textContent='Saving your RSVP…';
    try {
      const photo=await selected(),payload=guestPayload(form,invite),remove=form.elements.remove_photo?.checked;
      invite=await action('save',{payload});dirty=false;
      let warning='';
      if(photo||remove){
        try {
          if(photo){const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(photo);});invite=await action('photo',{photo:data});}
          else invite=await action('remove_photo');
        }catch{warning='Your RSVP is saved, but the photo change failed. Use Edit RSVP to try adding or removing it again.';}
      }
      showConfirmation(warning,true);
    }catch(error){status.textContent=error.message||'Could not save. Please try again.';form.querySelector('[data-reload]').hidden=false;}
    finally{busy=false;form.inert=false;}
  };
  focusHeading();
}
function showConfirmation(warning='',saved=false) {
  dirty=false;
  const joined=invite.status==='joined',confirmed=invite.attending&&!invite.reserve,withdrawn=joined&&!invite.attending&&!invite.reserve;
  const heading=invite.cancelled?'Event cancelled':!joined?'Guest bookings are closed':withdrawn?'Your RSVP has been withdrawn':invite.reserve?'You’re on the waiting list':saved?'You’ve successfully RSVP’d':'Your RSVP is confirmed';
  area.innerHTML=eventDetails()+`<div class="guest-confirmation"><span class="guest-confirm-mark" aria-hidden="true">${confirmed&&!invite.cancelled?'✓':'•'}</span><h2 tabindex="-1">${heading}</h2>${joined?`<p><strong>${e(invite.full_name)}</strong></p>`:''}<p>${invite.cancelled?'Please contact your inviting member about the cancellation.':!joined?'Ask your inviting member to contact the admins if you would like to join.':withdrawn?'Your place is no longer reserved. Any cancellation charges are subject to the event terms.':invite.reserve?'Your response is saved, but your place is not confirmed. No payment is due until a place is confirmed. Your inviting member can check with the admins.':`Your place is saved.${invite.event_type!=='social'?` You’ll be in ${e(invite.host_name)}’s tee group when both of you are playing.`:''}`}</p>${invite.tee_time&&confirmed?`<p class="notice">Your tee time: <strong>${e(invite.tee_time)}</strong> (UK time)</p>`:''}</div>${warning?`<p class="notice" role="status">${e(warning)}</p>`:''}${confirmed&&!invite.cancelled?'<section data-calendar class="guest-calendar"><h3>Save to calendar</h3></section>':''}<p class="guest-deadline">${invite.editable?`You can edit until 00:00 UK time on <strong>${e(date(invite.cutoff_date))}</strong>.`:'Online guest edits are closed.'} After the 10-day cutoff, ask ${e(invite.host_name)} to contact the admins for changes.</p>${invite.editable&&joined&&!invite.cancelled?'<button type="button" data-edit>Edit RSVP</button>':''}<p class="muted">Return using the same link in your invitation message. Keep it private: it gives access to your booking.</p>`;
  area.querySelector('[data-edit]')?.addEventListener('click',showForm);
  const calendar=area.querySelector('[data-calendar]');
  if(calendar){const links=calendarLinks(invite);calendar.insertAdjacentHTML('beforeend',`<div class="actions"><a class="button secondary" target="_blank" rel="noopener noreferrer" href="${e(links.google)}">Google Calendar</a><button type="button" class="secondary" data-ics>Apple / download calendar</button><a class="button secondary" target="_blank" rel="noopener noreferrer" href="${e(links.outlook)}">Outlook</a></div>${links.allDay?'<p class="muted">Saved as an all-day event until your individual tee time is published. Check with your inviting member before travelling.</p>':''}`);calendar.querySelector('[data-ics]').onclick=()=>{const url=URL.createObjectURL(new Blob([calendarICS(invite)],{type:'text/calendar;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='barford-event.ics';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);};}
  focusHeading();
}
async function load(){
  try{if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(token))throw new Error('Open the complete invitation link sent by your inviting member.');invite=await action('view');if(invite.status==='open'&&invite.booking_open&&invite.guest_price!=null&&!invite.cancelled)showForm();else showConfirmation();}
  catch(error){area.innerHTML=`<h2 tabindex="-1">Invitation unavailable</h2><p>${e(error.message||'Check your connection and try again.')}</p><button data-retry>Try again</button>`;area.querySelector('[data-retry]').onclick=load;focusHeading();}
}
await load();
