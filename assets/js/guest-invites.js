const b = await window.barfordReady,
  e = b.escape;
export async function guestAction(action, payload = {}) {
  const { data, error } = await b.client.rpc("guest_invitations", {
    action,
    payload,
  });
  if (error) throw error;
  return data;
}
export function inviteURL(token) {
  const url = new URL("guest.html", location.href);
  url.hash = token;
  return url.href;
}
export function shareInvite(ev, token, host) {
  const url = inviteURL(token);
  const message = `${host} has invited you to join Barford Golf Society for ${ev.name} on ${b.date(ev.date)}${ev.first_time ? `, first tee ${ev.first_time}` : ""}.\n\nGuest price: ${b.money(ev.guest_price)}. RSVP using the link below — no account or password needed. Enter your name, contact number and handicap, and add a photo if you like. We’ll keep you in my tee group when we both have confirmed places. Places are subject to availability. You can return to this same private link to edit your RSVP until 10 days before the event; after that, ask me to contact the admins. Please do not forward your personal link.\n\n${url}`;
  const trigger = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "invite-dialog";
  dialog.setAttribute("aria-label", "Share guest invitation");
  dialog.innerHTML = `<h2>Your guest invitation</h2><p>Send this invitation to one person. Create another invite for another guest.</p><label>Invitation message<textarea rows="10" readonly>${e(message)}</textarea></label><div class="actions section"><button data-share>Choose app & recipient</button><button class="secondary" data-copy>Copy invitation</button><button class="secondary" data-close>Close</button></div><div data-fallback hidden><p>Choose WhatsApp, or copy the invitation and paste it into Messenger or another app.</p><a class="button secondary" target="_blank" rel="noopener noreferrer" href="https://wa.me/?text=${encodeURIComponent(message)}">Open WhatsApp</a></div><p role="status"></p>`;
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelector("[data-close]").onclick = () => dialog.close();
  dialog.onclose = () => {
    dialog.remove();
    if (trigger?.isConnected && !trigger.disabled) trigger.focus({ preventScroll: true });
    else document.querySelector("[data-home-invite]")?.focus({ preventScroll: true });
  };
  const status = dialog.querySelector("[role=status]");
  const fallback = () => {
    dialog.querySelector("[data-fallback]").hidden = false;
  };
  dialog.querySelector("[data-share]").onclick = async () => {
    if (!navigator.share) {
      fallback();
      return;
    }
    try {
      await navigator.share({
        title: "Barford guest invitation",
        text: message,
      });
      status.textContent =
        "Share menu opened. Complete sending in your chosen app.";
    } catch (err) {
      if (err.name !== "AbortError") {
        fallback();
        status.textContent =
          "Your browser could not open sharing. Use the options below.";
      }
    }
  };
  dialog.querySelector("[data-copy]").onclick = async () => {
    try {
      await navigator.clipboard.writeText(message);
      status.textContent = "Invitation copied. Paste it into your message.";
    } catch {
      dialog.querySelector("textarea").select();
      status.textContent = "Select and copy the invitation above.";
    }
  };
}
export function invitePlaceholder(ev) {
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London'}).format(new Date());
  if(ev.cancelled||ev.date<today)return '';
  return '<div class="guest-invite-area" data-guest-invites><button type="button" class="secondary" disabled>Invite a guest</button></div>';
}
export async function mountGuestInvites(area,ev,category='member',{showCreate=true,showManagement=true}={}) {
  if(!area)return;
  const deadline=new Date(ev.date+'T00:00:00Z');deadline.setUTCDate(deadline.getUTCDate()-10);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London'}).format(new Date());
  const closed=ev.cancelled||today>=deadline.toISOString().slice(0,10)||(ev.rsvp_deadline&&today>ev.rsvp_deadline);
  if(!b.state.user){area.innerHTML='<button type="button" class="secondary" data-login>Invite a guest</button><small>Sign in and RSVP first to invite someone.</small>';area.querySelector('button').onclick=async()=>{if(await b.requireMember())await mountGuestInvites(area,ev,category,{showCreate,showManagement});};return;}
  let data;
  try{data=await guestAction('mine',{event_id:ev.id});}catch{area.innerHTML='<p class="muted">Guest invitations could not load.</p><button class="secondary" data-retry>Try again</button>';area.querySelector('button').onclick=()=>mountGuestInvites(area,ev,category,{showCreate,showManagement});return;}
  if(!area.isConnected)return;
  if((data.category||category)==='guest'){area.hidden=true;return;}
  const links=(data.links||[]).filter(l=>!l.revoked&&Number(l.event_id)===Number(ev.id));
  area.innerHTML=`${showCreate?`<button type="button" class="secondary" data-create-invite ${closed||ev.guest_price==null?'disabled':''}>Invite a guest</button><small>${closed?'Guest invitations close 10 days before the event. Contact the admins for help.':ev.guest_price==null?'The admins need to confirm the guest price first.':`No account needed for your guest · ${b.money(ev.guest_price)} per guest`}</small>`:''}${showManagement&&links.length?`<details><summary>Your guest invitations (${links.length})</summary>${links.map((l,i)=>`<div class="response-row"><span>${l.claimed?`${e(l.guest_name)} · ${l.reserve?'waiting list':l.attending?'RSVP saved':'withdrawn'}`:`Unused invitation ${i+1}`}</span><button type="button" class="text-button" data-reshare="${e(l.token)}">${l.claimed?'Resend to this guest':'Share invitation'}</button>${!l.claimed?`<button type="button" class="text-button" data-revoke="${e(l.token)}">Cancel invite</button>`:''}</div>`).join('')}</details>`:''}<p role="status"></p>`;
  const status=area.querySelector('[role=status]');
  area.querySelector('[data-create-invite]')?.addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;try{const link=await guestAction('create',{event_id:ev.id});shareInvite(ev,link.token,link.host_name);await mountGuestInvites(area,ev,category,{showCreate,showManagement});}catch(error){status.textContent=error.message;button.disabled=false;}});
  area.querySelectorAll('[data-reshare]').forEach(button=>button.onclick=()=>shareInvite(ev,button.dataset.reshare,b.state.profile?.full_name||'A Barford member'));
  area.querySelectorAll('[data-revoke]').forEach(button=>button.onclick=async()=>{if(!confirm('Cancel this unused invitation? Its link will stop working.'))return;button.disabled=true;try{await guestAction('revoke',{token:button.dataset.revoke});await mountGuestInvites(area,ev,category,{showCreate,showManagement});}catch(error){status.textContent=error.message;button.disabled=false;}});
}
