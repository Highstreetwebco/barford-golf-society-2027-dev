(() => {
  "use strict";
  const client = window.BarfordSupabase;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
  const money = value => value == null || value === "" || !Number.isFinite(Number(value)) ? "Price to be confirmed" : Number(value) === 0 ? "Free" : `£${Number(value).toFixed(2)}`;
  const date = value => value ? new Intl.DateTimeFormat("en-GB", {weekday:"short",day:"numeric",month:"short",year:"numeric"}).format(new Date(`${value}T12:00:00`)) : "Date to be confirmed";
  const time = value => value ? String(value).slice(0,5) : "Coming soon";
  const preference = value => ({dont_mind:"No preference",first:"Early",middle:"Middle",end:"Later"}[value] || "No preference");
  const eventUrl = id => `event.html?event=${encodeURIComponent(id)}`;
  const scoreUrl = model => `scoring.html?event=${encodeURIComponent(model.event.id)}${model.card ? `&card=${encodeURIComponent(model.card.id)}` : ""}`;
  const safeReturn = value => {
    try { const u = new URL(value || "index.html", location.href); const base = new URL("./", location.href); return u.origin === base.origin && u.pathname.startsWith(base.pathname) && /\.html$/.test(u.pathname) ? u.pathname+u.search+u.hash : "index.html"; } catch { return "index.html"; }
  };
  const loginUrl = destination => `account.html?returnTo=${encodeURIComponent(safeReturn(destination))}`;
  const bounded = (operation, ms = 12000) => new Promise((resolve,reject) => {
    const timer = setTimeout(() => reject(new Error("The connection is taking too long. Please try again.")),ms);
    Promise.resolve(operation).then(resolve,reject).finally(() => clearTimeout(timer));
  });
  const request = async operation => { const result = await bounded(operation); if(result?.error) throw result.error; return result?.data; };
  const payment = (event,rsvp) => {
    if (event.status === "cancelled") return {label:rsvp?.payment_status === "refunded" ? "Payment refunded" : "Event cancelled",due:false};
    if (rsvp?.payment_status === "refunded") return {label:"Payment refunded",due:false};
    if (rsvp?.payment_status === "paid") return {label:"Paid",due:false};
    if (rsvp?.payment_status === "waived" || (event.price != null && Number(event.price) === 0)) return {label:"No payment needed",due:false};
    if (rsvp?.status !== "playing") return {label:rsvp?.status === "reserve" ? "No payment requested while on reserve" : "Book before paying",due:false};
    if (event.price == null) return {label:"Price to be confirmed",due:false};
    return {label:`${money(event.price)} outstanding`,due:true};
  };
  // Work in pence and use the same eligibility rules as each payment receipt.
  const paymentSummary = (events,rsvps) => events.reduce((total,event)=>{
    const rsvp=rsvps.find(row=>row.event_id===event.id);
    if(payment(event,rsvp).due && Number.isFinite(Number(event.price)) && Number(event.price)>0){total.pence+=Math.round(Number(event.price)*100);total.count++;}
    if(rsvp?.status==='playing' && event.status!=='cancelled' && event.price==null && !['paid','refunded','waived'].includes(rsvp.payment_status))total.unpriced++;
    return total;
  },{pence:0,count:0,unpriced:0});
  const roundReport = (round,players,achievements=[]) => {
    const results=round.results.filter(r=>!r.dnp&&Number.isFinite(r.points)).sort((a,b)=>b.points-a.points);
    const lines=results.map(r=>{
      const position=results.findIndex(other=>other.points===r.points)+1;
      return `${position}. ${players.find(p=>p.id===r.playerId)?.name||'Member'} — ${r.points} pts`;
    });
    const awards=[['win','Winner'],['runnerUp','Runner-up'],['third','Third place'],['longestDrive','Longest drive'],['nearestPin','Nearest the pin']].flatMap(([type,label])=>achievements.filter(a=>a.roundId===round.id&&a.type===type).map(a=>`${label}: ${players.find(p=>p.id===a.playerId)?.name||'Member'}`));
    return [`Barford Golf Society 2027`,round.name,round.date?date(round.date):'',`${results.length} players · Published Stableford results`,'',...awards,'','Points order (equal points shown as ties)',...lines].filter(line=>line!==undefined).join('\n');
  };
  const shareText = (title,text) => {
    const d=dialog(title,`<p>Review the text, then copy it or choose where to share it.</p><label>Message<textarea rows="10">${esc(text)}</textarea></label><div class="simple-actions"><button type="button" class="button button-primary" data-copy-text>Copy report</button>${navigator.share?'<button type="button" class="button button-outline" data-share-text>Share…</button>':''}</div><p role="status"></p>`);
    d.querySelector('[data-copy-text]').onclick=async()=>{try{await navigator.clipboard.writeText(d.querySelector('textarea').value);d.querySelector('[role="status"]').textContent='Copied. Paste it into WhatsApp or your preferred app.';}catch{d.querySelector('textarea').select();d.querySelector('[role="status"]').textContent='Select and copy the text to share it.';}};
    d.querySelector('[data-share-text]')?.addEventListener('click',async()=>{try{await navigator.share({title,text:d.querySelector('textarea').value});}catch(error){if(error.name!=='AbortError')d.querySelector('[role="status"]').textContent='Sharing is unavailable. Use Copy report instead.';}});
  };
  const bookingLabel = model => model.event.status === "cancelled" ? "Event cancelled" : model.bookingError ? "Booking could not be checked" : ({playing:"You’re playing",reserve:"You’re on the reserve list",not_playing:"You’re not playing",cancelled:"You’re not playing"}[model.rsvp?.status] || "Please tell us if you’re playing");
  const nextAction = model => {
    const {event,rsvp,card,session,locked,group=[],bookingError}=model;
    const details = {label:"View event",href:eventUrl(event.id),kind:"link"};
    if (event.status === "cancelled") return {...details,message:"This event has been cancelled."};
    if (!session && (event.status === "completed" || event.event_date < today())) return {...details,label:"View results",href:`scores.html?view=rounds&event=${encodeURIComponent(event.id)}`,message:"This event has finished."};
    if (!session) return {...details,label:"Sign in to book",href:loginUrl(eventUrl(event.id)),message:"Sign in to see your booking and tee time."};
    if (bookingError) return {label:"Try again",kind:"retry",message:"Your booking could not be checked. Please try again."};
    if (card && ["submitted","locked"].includes(card.status)) return {...details,label:card.status === "locked" ? "View results" : "View submitted scores",href:card.status === "locked" ? `scores.html?view=rounds&event=${encodeURIComponent(event.id)}` : scoreUrl(model),message:card.status === "locked" ? "The round is complete." : "Scores submitted. Awaiting committee approval."};
    if (event.status === "completed" || event.event_date < today()) return {...details,label:"View results",href:`scores.html?view=rounds&event=${encodeURIComponent(event.id)}`,message:"This event has finished."};
    if (rsvp?.status === "reserve") return {...details,label:"View reserve booking",message:"You’re on reserve. We’ll move you into the playing list if a place opens."};
    if (rsvp?.status === "playing" && event.event_date === today() && card) return {kind:card.scorer_id ? "link" : "scorer",href:scoreUrl(model),label:!card.scorer_id ? "Choose our scorer" : card.scorer_id === session.user.id ? card.status === "in_progress" ? "Continue round" : "Open scorecard" : "View group scorecard",message:card.scorer_id === session.user.id ? "You’re scoring for your group today." : card.scorer_id ? "Your group’s scorer is ready." : "Choose one person to enter your group’s scores."};
    const pay = payment(event,rsvp);
    if (rsvp?.status === "playing" && pay.due) return {kind:"link",label:"Payment details",href:`payments.html?event=${encodeURIComponent(event.id)}`,message:`You’re playing. ${pay.label}.`};
    if (rsvp?.status === "playing") return {...details,label:group.length ? "View my group" : "View booking",href:eventUrl(event.id)+(group.length ? "#my-group" : ""),message:group.length ? `Your tee time is ${time(group.find(p=>p.is_you)?.tee_time || group[0].tee_time)}.` : "You’re all set. Your tee time will appear here when it is ready."};
    if (locked === null) return {kind:"retry",label:"Try again",message:"We couldn’t check whether bookings are open."};
    if (locked) return {kind:"contact",label:"Request a change",message:"Bookings are closed while the committee arranges the groups."};
    const full = model.availability?.available != null && Number(model.availability.available) === 0;
    return {kind:"book",label:full ? "Join reserve list" : rsvp?.status ? "Change to playing" : "Book my place",message:full ? "This event is full. You can join the reserve list." : rsvp?.status ? "You’re marked as not playing. You can still change your choice." : "Would you like to play at this event?"};
  };
  const getCard = async (eventId,userId) => {
    const memberships = await request(client.from("event_scorecard_players")
      .select("event_scorecards!inner(id,event_id,status,scorer_id)")
      .eq("member_id",userId).eq("event_scorecards.event_id",eventId).limit(1));
    return memberships?.[0]?.event_scorecards || null;
  };
  // Supplied records must come from the current page's completed, authorised reads.
  // Mutations call this without records so lock, booking and payment stay fresh.
  const loadEvent = async (id, initial = {}) => {
    if (!client) throw new Error("The account connection is unavailable. Please refresh the page.");
    const [event,auth] = await Promise.all([
      initial.event?.id === id ? initial.event : request(client.from("events").select("*").eq("id",id).single()),
      Object.prototype.hasOwnProperty.call(initial,"session") ? {session:initial.session} : request(client.auth.getSession())
    ]);
    const model={event,session:auth.session,rsvp:null,locked:false,group:[],card:null,availability:null};
    if (!auth.session) return model;
    const reads = await Promise.allSettled([
      Object.prototype.hasOwnProperty.call(initial,"rsvp") ? Promise.resolve(initial.rsvp) : request(client.from("rsvps").select("id,event_id,status,payment_status,buggy_requested,preferred_tee_time").eq("event_id",id).eq("member_id",auth.session.user.id).maybeSingle()),
      request(client.rpc("get_event_rsvp_lock_status",{target_event_id:id})),
      request(client.rpc("get_event_availability",{p_event_id:id})),
      event.tee_times_status === "published" ? request(client.rpc("get_my_event_tee_group",{target_event_id:id})) : Promise.resolve([]),
      getCard(id,auth.session.user.id)
    ]);
    model.rsvp=reads[0].status === "fulfilled" ? reads[0].value : null;
    model.bookingError=reads[0].status === "rejected";
    model.locked=reads[1].status === "fulfilled" ? Boolean(reads[1].value) : null;
    model.availability=reads[2].status === "fulfilled" ? reads[2].value?.[0] : null;
    model.group=reads[3].status === "fulfilled" && event.tee_times_status === "published" ? reads[3].value || [] : [];
    model.card=reads[4].status === "fulfilled" ? reads[4].value : null;
    model.cardError=reads[4].status === "rejected";
    return model;
  };
  let activeDialog;
  const dialog = (title,html) => {
    activeDialog?.close(); activeDialog?.remove();
    const previous=document.activeElement;
    const d=document.createElement("dialog");d.className="simple-dialog";
    d.setAttribute("aria-labelledby","simpleDialogTitle");
    d.innerHTML=`<div class="simple-dialog-panel"><button class="button simple-dialog-close" type="button" data-dialog-close>Close</button><h2 id="simpleDialogTitle">${esc(title)}</h2>${html}</div>`;
    document.body.append(d);d.querySelector("[data-dialog-close]").onclick=()=>d.close();
    d.addEventListener("close",()=>{previous?.focus();d.remove();if(activeDialog===d)activeDialog=null;},{once:true});
    activeDialog=d;d.showModal();return d;
  };
  const contact = (event,reason="change my booking") => {
    const text=`Hi, please could you help me ${reason}${event ? ` for ${event.name} on ${date(event.event_date)}` : ""}? Thank you.`;
    const d=dialog("Ask the committee",`<p>Send this message to your usual committee contact.</p><label>Your message<textarea id="committeeMessage" rows="5">${esc(text)}</textarea></label><div class="simple-actions"><button type="button" class="button button-primary" id="copyCommitteeMessage">Copy message</button>${navigator.share ? '<button type="button" class="button button-outline" id="shareCommitteeMessage">Share message</button>' : ""}</div><p id="committeeMessageStatus" role="status"></p>`);
    d.querySelector("#copyCommitteeMessage").onclick=async()=>{try{await navigator.clipboard.writeText(d.querySelector("textarea").value);d.querySelector("#committeeMessageStatus").textContent="Copied. Paste it into a message to the committee.";}catch{d.querySelector("textarea").select();d.querySelector("#committeeMessageStatus").textContent="Select and copy the message, then send it to the committee.";}};
    d.querySelector("#shareCommitteeMessage")?.addEventListener("click",async()=>{try{await navigator.share({text:d.querySelector("textarea").value});}catch{}});
  };
  const saveBooking = async (model,wantsToPlay,buggy,windowChoice) => {
    if (!model.session) {location.href=loginUrl(eventUrl(model.event.id));return null;}
    const locked=await request(client.rpc("get_event_rsvp_lock_status",{target_event_id:model.event.id}));
    if (locked) throw new Error("Bookings have now closed. Please ask the committee to make this change.");
    await request(client.rpc("set_my_event_rsvp",{p_event_id:model.event.id,p_status:wantsToPlay ? "playing" : "not_playing",p_buggy_requested:Boolean(buggy),p_preferred_tee_time:windowChoice || "dont_mind"}));
    return loadEvent(model.event.id);
  };
  const openBooking = model => {
    if (!model.session) {location.href=loginUrl(eventUrl(model.event.id));return;}
    if(model.locked) {contact(model.event);return;}
    const own=model.rsvp,full=model.availability?.available != null && Number(model.availability.available)===0 && own?.status!=="playing";
    const d=dialog(own?.status === "playing" || own?.status === "reserve" ? "Change booking" : full ? "Join the reserve list" : "Book my place",`<p><strong>${esc(model.event.name)}</strong><br>${esc(date(model.event.event_date))} · ${esc(money(model.event.price))}</p><form id="simpleBookingForm"><fieldset><legend>Walking or buggy?</legend><div class="simple-choices"><label><input type="radio" name="travel" value="walking" ${!own?.buggy_requested ? "checked" : ""}><span>Walking</span></label><label><input type="radio" name="travel" value="buggy" ${own?.buggy_requested ? "checked" : ""}><span>Buggy requested</span></label></div></fieldset><label>Tee-time preference <small>Optional</small><select name="teeWindow">${["dont_mind","first","middle","end"].map(v=>`<option value="${v}" ${v===(own?.preferred_tee_time||"dont_mind") ? "selected" : ""}>${preference(v)}</option>`).join("")}</select></label><p>We’ll do our best to match your preference.</p>${full ? '<p>If a place opens, you’ll automatically move into the playing list.</p>' : ""}<button class="button button-primary full-button" type="submit">${full ? "Confirm reserve place" : "Confirm booking"}</button><p class="form-status" role="status"></p></form>`);
    d.querySelector("form").onsubmit=async e=>{
      e.preventDefault();const button=d.querySelector('[type="submit"]'),status=d.querySelector(".form-status"),data=new FormData(e.currentTarget);button.disabled=true;button.textContent="Saving booking…";
      try{
        const fresh=await saveBooking(model,true,data.get("travel")==="buggy",data.get("teeWindow"));
        if(!fresh || fresh.bookingError || fresh.session?.user.id !== model.session.user.id || !["playing","reserve"].includes(fresh.rsvp?.status)) throw new Error("Your request was sent, but we could not check the confirmation. Close this message and refresh before trying again.");
        d.close();window.dispatchEvent(new CustomEvent("barford-booking-changed",{detail:{eventId:model.event.id,model:fresh}}));
        dialog(fresh.rsvp?.status === "reserve" ? "You’re on the reserve list" : "Your place is booked",`<p>${esc(model.event.name)} · ${esc(date(model.event.event_date))}</p><p>${fresh.rsvp?.buggy_requested ? "Buggy requested" : "Walking"} · ${esc(preference(fresh.rsvp?.preferred_tee_time))} tee-time preference</p><p>${esc(payment(fresh.event,fresh.rsvp).label)}</p><a class="button button-primary full-button" href="${eventUrl(model.event.id)}">View my booking</a>`);
      }catch(error){status.textContent=error.message||"Your booking could not be saved. Please try again.";button.disabled=false;button.textContent="Try again";}
    };
  };
  const withdraw = model => {
    if(model.locked) {contact(model.event);return;}
    const reserve=model.rsvp?.status==="reserve";
    const d=dialog(reserve ? "Leave the reserve list?" : "Confirm you can’t play",`<p>${esc(model.event.name)} · ${esc(date(model.event.event_date))}</p><p>${model.rsvp?.status === "playing" ? "Your place may be offered to someone on the reserve list." : "You can change your choice again while bookings are open."}</p><button id="confirmWithdrawal" class="button button-primary" type="button">${reserve ? "Leave reserve list" : "Confirm I can’t play"}</button><p class="form-status" role="status"></p>`);
    d.querySelector("#confirmWithdrawal").onclick=async e=>{e.currentTarget.disabled=true;try{const fresh=await saveBooking(model,false,model.rsvp?.buggy_requested,model.rsvp?.preferred_tee_time);if(fresh.bookingError || fresh.rsvp?.status!=="not_playing" || fresh.session?.user.id!==model.session.user.id)throw new Error("Please refresh to check your booking.");d.close();window.dispatchEvent(new CustomEvent("barford-booking-changed",{detail:{eventId:model.event.id,model:fresh}}));}catch(error){d.querySelector(".form-status").textContent=error.message;e.target.disabled=false;}};
  };
  const showRoster = async model => {
    const d=dialog("Who’s playing",'<p id="simpleRosterStatus" role="status">Loading the player list…</p><div id="simpleRosterList"></div>');
    try{const rows=await request(client.rpc("get_event_rsvp_roster",{p_event_id:model.event.id}));d.querySelector("#simpleRosterStatus").textContent=model.event.name;d.querySelector("#simpleRosterList").innerHTML=["playing","reserve"].map(status=>`<h3>${status==="playing" ? "Playing" : "Reserve list"}</h3><ol class="simple-player-list">${rows.filter(p=>p.status===status).map(p=>`<li>${esc(p.full_name)}${p.member_id===model.session?.user.id ? " (You)" : ""}</li>`).join("")||"<li>No members yet</li>"}</ol>`).join("");}catch{d.querySelector("#simpleRosterStatus").textContent="The player list could not be loaded. Please close and try again.";}
  };
  const chooseScorer = async model => {
    if(!model.card || model.card.status!=="ready") {location.href=scoreUrl(model);return;}
    const d=dialog("Who will enter the scores?",'<p>Choose one member to score for your group.</p><div id="simpleScorerChoices">Loading your group…</div><p class="form-status" role="status"></p>');
    try{
      const players=await request(client.from("event_scorecard_players").select("member_id,display_name").eq("scorecard_id",model.card.id));
      d.querySelector("#simpleScorerChoices").innerHTML=players.filter(p=>p.member_id).map(p=>`<button class="button button-outline full-button" type="button" data-scorer-id="${esc(p.member_id)}">${esc(p.display_name)}${p.member_id===model.session.user.id ? " (You)" : ""}</button>`).join("");
      d.querySelectorAll("[data-scorer-id]").forEach(b=>b.onclick=async()=>{d.querySelectorAll("[data-scorer-id]").forEach(x=>x.disabled=true);try{await request(client.rpc("select_scorecard_scorer",{target_event_id:model.event.id,target_scorer_id:b.dataset.scorerId}));d.close();window.dispatchEvent(new CustomEvent("barford-booking-changed",{detail:{eventId:model.event.id}}));}catch(error){d.querySelector(".form-status").textContent=error.message;d.querySelectorAll("[data-scorer-id]").forEach(x=>x.disabled=false);}});
    }catch{d.querySelector("#simpleScorerChoices").textContent="Your group could not be loaded. Please close and try again.";}
  };
  const directions = event => {
    const destination=[event.venue,event.address].filter(Boolean).join(", "),encoded=encodeURIComponent(destination);
    dialog("Directions",`<p>${esc(destination)}</p><div class="simple-actions"><a class="button button-primary" href="https://www.google.com/maps/dir/?api=1&destination=${encoded}" target="_blank" rel="noopener">Google Maps</a><a class="button button-outline" href="https://maps.apple.com/?daddr=${encoded}&dirflg=d" target="_blank" rel="noopener">Apple Maps</a><a class="button button-outline" href="https://waze.com/ul?q=${encoded}&navigate=yes" target="_blank" rel="noopener">Waze</a></div>`);
  };
  const activate = (action,model) => {
    if(action.kind==="book")openBooking(model);else if(action.kind==="contact")contact(model.event);else if(action.kind==="scorer")chooseScorer(model);else if(action.kind==="retry")window.dispatchEvent(new CustomEvent("barford-booking-changed",{detail:{eventId:model.event.id}}));else location.href=action.href;
  };
  const promotions = async () => {if(!client)return;try{const auth=await request(client.auth.getSession());if(!auth?.session)return;const rows=await request(client.rpc("get_my_unseen_rsvp_promotions"));const p=rows?.[0];if(!p || activeDialog)return;const d=dialog("A place has opened for you",`<p>You’ve moved from reserve to the playing list for <strong>${esc(p.event_name)}</strong>.</p><button class="button button-primary full-button" id="promotionSeen" type="button">View my booking</button><p class="form-status" role="status"></p>`);d.querySelector("#promotionSeen").onclick=async()=>{try{await request(client.rpc("mark_my_rsvp_promotion_seen",{p_id:p.id}));location.href=eventUrl(p.event_id);}catch{d.querySelector(".form-status").textContent="Please try again.";}};}catch{}};
  window.BarfordMemberFlow={esc,today,money,date,time,preference,eventUrl,scoreUrl,safeReturn,loginUrl,bounded,request,payment,paymentSummary,roundReport,shareText,bookingLabel,nextAction,getCard,loadEvent,dialog,contact,openBooking,withdraw,showRoster,chooseScorer,directions,activate,promotions};
})();
