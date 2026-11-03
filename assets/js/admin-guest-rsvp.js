import {guestFields,guestPayload,wireTerms} from './guest-form.js?v=2027-guest-rsvp-1';
export async function editGuestRsvp(person,event,b,onSaved) {
  const e=b.escape,base={event_id:event.id,member_id:person.member_id};
  const call=async(action,payload={})=>{const {data,error}=await b.client.rpc('admin_guest_rsvp',{action,payload:{...base,...payload}});if(error)throw error;return data;};
  let invite=await call('view');
  const dialog=document.createElement('dialog');dialog.className='simple-admin-dialog';dialog.setAttribute('aria-labelledby','adminGuestTitle');
  dialog.innerHTML=`<form class="form-stack"><h2 id="adminGuestTitle">Edit guest RSVP</h2><p>${e(event.name)} · Invited by ${e(invite.host_name)}</p><p class="notice">Admin changes remain available after the guest’s 10-day deadline. Changes to published tee groups require review and republishing.</p>${guestFields(invite,e,b.date,{admin:true})}<button type="button" class="secondary" data-photo>Edit guest photo</button><div class="actions"><button type="submit">Save guest RSVP</button><button type="button" class="secondary" data-close>Cancel</button></div><p role="status"></p></form>`;
  document.body.append(dialog);dialog.showModal();const form=dialog.querySelector('form'),status=dialog.querySelector('[role=status]');let busy=false;
  wireTerms(form);if(form.elements.accept_terms)form.elements.accept_terms.required=false;
  dialog.querySelector('[data-close]').onclick=()=>{if(!busy)dialog.close();};dialog.oncancel=event=>{if(busy)event.preventDefault();};dialog.onclose=()=>dialog.remove();
  dialog.querySelector('[data-photo]').onclick=async()=>{try{const {editMemberPhoto}=await import('./admin-member-photos.js?v=2027-admin-photos-1');await editMemberPhoto({member_id:person.member_id,username:invite.full_name});}catch(error){status.textContent=error.message;}};
  form.onsubmit=async event=>{event.preventDefault();if(busy||!form.reportValidity())return;busy=true;form.inert=true;status.textContent='Saving guest RSVP…';try{invite=await call('save',guestPayload(form,invite));await onSaved();dialog.close();b.toast('Guest RSVP saved.');}catch(error){status.textContent=error.message;}finally{busy=false;form.inert=false;}};
  return new Promise(resolve=>dialog.addEventListener('close',resolve,{once:true}));
}
