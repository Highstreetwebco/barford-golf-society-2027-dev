(() => {
  'use strict';
  const F=window.BarfordMemberFlow,M=window.BarfordScoreModel,S=window.BarfordScoreSafety,client=window.BarfordSupabase,$=id=>document.getElementById(id);
  const params=new URLSearchParams(location.search),requestedCard=params.get('card'),requestedEvent=params.get('event');
  if(requestedEvent){for(const id of ['scoreBack','scoreEventLink'])if(document.getElementById(id))document.getElementById(id).href=F.eventUrl(requestedEvent);}
  let session,model,selected,hole=1,view='card',loading=false,flushing=null,refreshing=null,busy=false,syncTimer,storageOK=true,lastSyncError="",verifiedCard=null,offlineMemberId=null,identityBlocked=false,saveVersion=0;
  const show=id=>$(id)?.classList.remove('hidden'),hide=id=>$(id)?.classList.add('hidden');
  const activeUserId=()=>session?.user?.id||offlineMemberId;
  const canEdit=()=>!identityBlocked&&model?.card.status==='in_progress'&&model.card.scorer_id===activeUserId()&&!model.submitQueued&&!busy;
  const hasPending=()=>Object.keys(model?.dirty||{}).length>0;
  const connectionError=error=>/connection|network|failed to fetch|fetch failed|timeout|timed out|taking too long|load failed/i.test(error?.message||'');
  const ownScorer=()=>model?.card.scorer_id===activeUserId();
  const tee=(p,h)=>p.playing_category==='women'?{par:Number(h.red_par||h.par),yards:h.red_yards,si:Number(h.red_stroke_index||h.stroke_index),name:h.red_tee_name||'Red'}:{par:Number(h.par),yards:h.yards,si:Number(h.stroke_index),name:h.yellow_tee_name||'Yellow'};
  const shots=(hcp,si)=>hcp<si?0:Math.floor((hcp-si)/18)+1;
  const points=(p,h,v)=>!M.valid(v)||v.picked_up?0:Math.max(0,2+tee(p,h).par-(Number(v.strokes)-shots(Number(p.handicap_used),tee(p,h).si)));
  const total=(p,start=1,end=18)=>model.holes.filter(h=>h.hole_number>=start&&h.hole_number<=end).reduce((sum,h)=>sum+points(p,h,model.scores[M.key(p.id,h.hole_number)]),0);
  const scoreText=v=>M.valid(v)?v.picked_up?'Picked up':String(v.strokes):'Enter score';
  const completeHole=()=>model.players.every(p=>M.valid(model.scores[M.key(p.id,hole)]));
  function status(text){$('scoreSyncButton').textContent=text;$('scoreSafetyText').textContent=text;}
  function updateStatus(){
    if(!model)return;
    if(!storageOK){status('Phone save failed — keep this page open');return;}
    if(['submitted','locked'].includes(model.card.status)){status(model.card.status==='locked'?'Results approved':'Submitted to committee');return;}
    if(flushing){status('Sending scores…');return;}
    if(lastSyncError){$('scoreSyncButton').textContent='Not sent — tap to retry';$('scoreSafetyText').textContent=lastSyncError;return;}
    if(model.submitQueued){status('Saved on phone — submission waiting');return;}
    if(hasPending()){status(navigator.onLine?'Saved on phone — tap to retry':'Saved on phone — waiting for signal');return;}
    if((model.cleared||[]).length){status('Replace the cleared score to finish saving');return;}
    if(!ownScorer()){status(navigator.onLine?'Viewing group scores':'Offline copy of group scores');return;}
    status(navigator.onLine?'Scores saved to server':'Offline — scores saved on phone');
  }
  async function persist(){
    if(!model)return false;
    model.hole=hole;model.selected=selected;model.view=view;model.savedAt=Date.now();
    const version=++saveVersion,result=await S.save(model);if(version===saveVersion)storageOK=result.local||result.backup;return result.local||result.backup;
  }
  async function cacheCourse(){
    if(!model.event?.course_scorecard_id||!navigator.onLine)return;
    try{const maps=await F.request(client.from('course_hole_maps').select('*').eq('course_scorecard_id',model.event.course_scorecard_id));const record={eventId:model.card.event_id,courseId:model.event.course_scorecard_id,eventData:model.event,holes:model.holes,views:maps,savedAt:Date.now()};for(const suffix of [`${record.courseId}:${record.eventId}`,record.courseId])localStorage.setItem('barford-course-'+suffix,JSON.stringify(record));}catch{}
  }
  function unavailable(message){hide('scoreLoading');hide('scoreReady');hide('halfwayReview');hide('roundReview');show('scoreUnavailable');$('scoreUnavailableMessage').textContent=message;}
  async function load(){
    if(loading)return;loading=true;
    try{
      const auth=await F.request(client.auth.getSession());session=auth.session;
      if(session)try{localStorage.setItem('barford-score-active-member',session.user.id);}catch{}
      if(!session){$('scoreSignIn').href=F.loginUrl(location.href);show('scoreSignIn');throw Error('Sign in to open your group’s scorecard.');}
      const cached=await F.bounded(S.read(session.user.id,requestedCard,requestedEvent),4000).catch(()=>null);
      if(cached){model=cached;model.dirty=model.dirty||Object.fromEntries(Object.entries(model.scores||{}).map(([k,v])=>[k,v.changed_at||'1970-01-01T00:00:00.000Z']));model.cleared=model.cleared||[];hole=Math.min(18,Math.max(1,Number(params.get('hole')||model.hole)||1));selected=model.selected;view=model.view||'card';}
      if(navigator.onLine)await refresh();
      else if(!model)throw Error('Open this scorecard once while connected so it is available on this phone.');
      if(!model.players?.length||model.holes?.length!==18)throw Error('The committee is still preparing this scorecard. Please return to your event.');
      if(!selected||!model.players.some(p=>p.id===selected))selected=model.players.find(p=>!M.valid(model.scores[M.key(p.id,hole)]))?.id||model.players[0].id;
      hide('scoreLoading');hide('scoreUnavailable');render();
      if(navigator.onLine&&(hasPending()||model.submitQueued))flush();
      cacheCourse();
    }catch(error){
      if(!session&&connectionError(error)){
        let id;try{id=localStorage.getItem('barford-score-active-member');}catch{}
        if(id){const cached=await S.read(id,requestedCard,requestedEvent).catch(()=>null);
          if(cached?.userId===id&&cached.card?.status==='in_progress'&&cached.card.scorer_id===id&&cached.players?.length&&cached.holes?.length===18){
            offlineMemberId=id;model=cached;model.scores=Object.fromEntries(Object.entries(model.scores||{}).map(([k,v])=>[k,M.normalise(v)]));model.dirty=model.dirty||Object.fromEntries(Object.entries(model.scores).map(([k,v])=>[k,v.changed_at]));model.cleared=model.cleared||[];hole=Math.min(18,Math.max(1,Number(params.get('hole')||model.hole)||1));selected=model.selected||model.players[0].id;view=model.view||'card';
            lastSyncError='Using your saved round. Reconnect to send scores.';hide('scoreLoading');hide('scoreUnavailable');render();return;
          }
        }
      }
      if(model?.card?.id&&model.players?.length&&model.holes?.length===18&&(!navigator.onLine||connectionError(error))&&(!verifiedCard||(verifiedCard.status==='in_progress'&&verifiedCard.scorer_id===session?.user.id))){lastSyncError='Using the scorecard saved on this phone. Connection unavailable; tap to retry.';render();}else unavailable(error.message||'Your scorecard could not be opened. Please try again.');}
    finally{loading=false;}
  }
  async function confirmSession(){
    if(identityBlocked)throw Error('Sign in again to send this saved scorecard.');
    if(session)return;
    const auth=await F.request(client.auth.getSession());
    if(!auth.session||auth.session.user.id!==offlineMemberId){identityBlocked=true;offlineMemberId=null;render();throw Error('Sign in with the member account used for this saved round.');}
    session=auth.session;offlineMemberId=null;
  }
  async function refresh(){
    await confirmSession();
    if(flushing)await flushing;
    if(refreshing)return refreshing;
    refreshing=fetchFresh().finally(()=>{refreshing=null;});return refreshing;
  }
  async function fetchFresh(){
    let cardId=requestedCard||model?.card?.id;
    if(!cardId&&requestedEvent){const card=await F.getCard(requestedEvent,session.user.id);cardId=card?.id;}
    if(!cardId){const cards=await F.request(client.from('event_scorecards').select('id').eq('scorer_id',session.user.id).in('status',['ready','in_progress']).order('updated_at',{ascending:false}).limit(1));cardId=cards?.[0]?.id;}
    if(!cardId)throw Error('Your scorecard is not ready yet. Return to the event to choose your group’s scorer.');
    const card=await F.request(client.from('event_scorecards').select('id,event_id,status,scorer_id,updated_at').eq('id',cardId).single());
    verifiedCard=card;
    if(requestedEvent&&card.event_id!==requestedEvent)throw Error('This scorecard belongs to a different event. Return to your event and open its scorecard.');
    const [players,holes,event]=await Promise.all([
      F.request(client.from('event_scorecard_players').select('id,member_id,display_name,handicap_used,position,playing_category,tee_name').eq('scorecard_id',card.id).order('position')),
      F.request(client.from('event_holes').select('hole_number,par,yards,stroke_index,red_par,red_yards,red_stroke_index,yellow_tee_name,red_tee_name,longest_drive,nearest_pin').eq('event_id',card.event_id).order('hole_number')),
      F.request(client.from('events').select('*').eq('id',card.event_id).single())
    ]);
    if(!players.length||holes.length!==18)throw Error('The committee is still preparing the players and holes for this scorecard.');
    const rows=await F.request(client.from('event_hole_scores').select('scorecard_player_id,hole_number,strokes,picked_up,client_changed_at').in('scorecard_player_id',players.map(p=>p.id)));
    let previous=model?.card.id===card.id?model:await S.read(session.user.id,card.id,card.event_id);
    if(!previous)previous={scores:{},dirty:{},cleared:[],submitQueued:false};
    const legacy=await S.legacyPending(card.id);
    if(legacy&&previous.userId===session.user.id){for(const raw of legacy.args?.score_changes||[]){const v=M.normalise(raw),k=M.key(v.scorecard_player_id,v.hole_number);if(!previous.scores[k]||M.stamp(v)>M.stamp(previous.scores[k])){previous.scores[k]=v;(previous.dirty||={})[k]=v.changed_at;}}previous.submitQueued=previous.submitQueued||legacy.submit_when_synced;}
    // Never replay old local edits after submission or after another member takes over.
    const writable=card.scorer_id===session.user.id&&card.status==='in_progress';
    const dirty=writable?(previous.dirty||{}):{},cleared=writable?(previous.cleared||[]):[];
    model={...previous,userId:session.user.id,card,players,holes,event,dirty,cleared,submitQueued:writable&&Boolean(previous.submitQueued),scores:M.merge(rows,previous.scores||{},dirty,cleared)};
    const newConflict=!writable&&Object.keys(previous.dirty||{}).length>0;
    if(newConflict)model.recoveryNotice='Scoring is now closed or assigned to another member. Your previous phone copy has been kept in the backup.';
    // Keep the old unsent copy separately for committee recovery without allowing replay.
    if(newConflict){try{localStorage.setItem('barford-score-recovery-'+card.id,JSON.stringify(previous));}catch{}}
    if(await persist())await S.removeLegacy(card.id);
  }
  function render(){
    if(!model)return;
    if(identityBlocked){unavailable('Your saved scores are still on this phone. Sign in with the account used for this round to continue.');$('scoreSignIn').href=F.loginUrl(location.href);show('scoreSignIn');return;}
    document.body.classList.add('matchday-ui');
    const back=F.eventUrl(model.card.event_id);$('scoreBack').href=back;$('scoreEventLink').href=back;
    $('competitionSummary').textContent=model.event?.name||'Group scorecard';
    if(['submitted','locked'].includes(model.card.status)){view='review';review();updateStatus();return;}
    if(view==='halfway'){halfway();updateStatus();return;}
    if(view==='review'){review();updateStatus();return;}
    show('scoreReady');hide('scoreLoading');hide('scoreUnavailable');hide('halfwayReview');hide('roundReview');
    const h=model.holes.find(x=>x.hole_number===hole);if(!h)return;
    $('holeProgress').textContent=`Hole ${hole} of 18`;$('holeTitle').textContent=`Hole ${hole}`;
    $('holePar').textContent=`Par ${h.par}`;$('holeYards').textContent=`${h.yards||'—'} yards`;$('holeIndex').textContent=`Stroke index ${h.stroke_index}`;
    $('redHolePar').textContent=`Par ${h.red_par||h.par}`;$('redHoleYards').textContent=`${h.red_yards||'—'} yards`;$('redHoleIndex').textContent=`Stroke index ${h.red_stroke_index||h.stroke_index}`;
    $('yellowTeeSummary').classList.toggle('hidden',!model.players.some(p=>p.playing_category!=='women'));$('redTeeSummary').classList.toggle('hidden',!model.players.some(p=>p.playing_category==='women'));
    const comps=[h.longest_drive?'Longest drive':'',h.nearest_pin?'Nearest the pin':''].filter(Boolean);
    $('competitionAlertTitle').textContent=comps.join(' · ');$('competitionAlertText').textContent='Competition on this hole';$('competitionAlert').classList.toggle('hidden',!comps.length);
    const editable=canEdit(),scorer=model.players.find(p=>p.member_id===model.card.scorer_id);
    $('scoreSessionNotice').textContent=(model.recoveryNotice||model.submitQueued)?'':(!ownScorer()?`Viewing only. ${scorer?.display_name||'Your nominated scorer'} enters the group’s scores.`:model.card.status==='ready'?'Start your round when you are ready to score.':'Tap a player, then enter their score below.');
    if(model.recoveryNotice)$('scoreSessionNotice').textContent=model.recoveryNotice;
    if(model.submitQueued)$('scoreSessionNotice').textContent='Submission is waiting for a connection. Keep this page open when you reconnect.';
    $('startRound').classList.toggle('hidden',!(ownScorer()&&model.card.status==='ready'));
    $('startRound').disabled=busy||!navigator.onLine;
    $('handoffScorecard').classList.toggle('hidden',!editable||model.players.filter(p=>p.member_id).length<2);
    $('scoreCurrentPlayers').innerHTML=model.players.map(p=>{const v=model.scores[M.key(p.id,hole)];return `<button class="score-player-row ${selected===p.id?'is-selected':''}" type="button" data-player="${p.id}" aria-pressed="${selected===p.id}" aria-label="${F.esc(p.display_name)}, ${F.esc(scoreText(v))}"><span><strong>${F.esc(p.display_name)}</strong><small>${F.esc(tee(p,h).name)} tees · ${total(p)} points so far</small></span><b>${F.esc(M.valid(v)?v.picked_up?'X':String(v.strokes):'—')}<small>${M.valid(v)?points(p,h,v)+' pts this hole':'Not entered'}</small></b></button>`;}).join('');
    $('scoreCurrentPlayers').querySelectorAll('[data-player]').forEach(b=>b.onclick=()=>{selected=b.dataset.player;render();persist();});
    const p=model.players.find(p=>p.id===selected)||model.players[0];
    $('selectedPlayerPrompt').innerHTML=`<strong>${F.esc(p.display_name)}</strong><small>${editable?'Strokes / X = pick up':'Viewing only'}</small>`;
    $('scoreKeypad').classList.toggle('hidden',!editable);
    $('previousHole').disabled=hole===1;$('previousHoleBottom').disabled=hole===1;
    $('nextHole').disabled=editable&&!completeHole();$('nextHoleTop').disabled=editable&&!completeHole();
    $('nextHole').textContent=hole===18?'Review full scorecard':editable&&!completeHole()?'Enter all scores above':hole===9?'Review front nine':'Next hole';
    renderStrip();updateStatus();
  }
  function renderStrip(){
    const start=hole<=9?1:10,nums=Array.from({length:9},(_,i)=>start+i);
    $('liveNineStrip').innerHTML=`<p>Tap a hole to view or correct a score. Each entry shows strokes / points. X means picked up.</p><div class="live-card-header"><strong>${start===1?'Front nine':'Back nine'}</strong>${nums.map(n=>`<b>${n}</b>`).join('')}</div>`+model.players.map(p=>`<div class="live-card-row"><span>${F.esc(p.display_name)}</span>${nums.map(n=>{const v=model.scores[M.key(p.id,n)],h=model.holes.find(x=>x.hole_number===n);return `<button type="button" data-edit-player="${p.id}" data-edit-hole="${n}" aria-label="${F.esc(p.display_name)}, hole ${n}, ${F.esc(scoreText(v))}" class="${n===hole?'is-current':''}">${M.valid(v)?v.picked_up?'X':`${v.strokes}/${points(p,h,v)}`:'—'}</button>`;}).join('')}</div>`).join('');
    $('liveNineStrip').querySelectorAll('[data-edit-player]').forEach(b=>b.onclick=()=>navigate(Number(b.dataset.editHole),b.dataset.editPlayer));
  }
  async function edit(value,pickedUp=false,clear=false){
    if(!canEdit()||!selected)return;
    const k=M.key(selected,hole);
    if(clear){delete model.scores[k];delete model.dirty[k];model.cleared=[...new Set([...model.cleared,k])];}
    else{const timestamp=new Date(Math.max(Date.now(),M.stamp(model.scores[k])+1)).toISOString();model.scores[k]={scorecard_player_id:selected,hole_number:hole,strokes:value,picked_up:pickedUp,changed_at:timestamp};model.dirty[k]=timestamp;model.cleared=model.cleared.filter(x=>x!==k);const next=model.players.find(p=>!M.valid(model.scores[M.key(p.id,hole)]));if(next)selected=next.id;}
    render();await persist();updateStatus();clearTimeout(syncTimer);syncTimer=setTimeout(flush,350);
  }
  async function flush(){
    if(flushing)return flushing;
    if(refreshing){try{await refreshing;}catch{return false;}if(flushing)return flushing;}
    if(!model||!navigator.onLine||!ownScorer()||model.card.status!=='in_progress')return false;
    if(!session){try{await confirmSession();await refresh();}catch(error){lastSyncError=error.message;updateStatus();return false;}if(flushing)return flushing;if(!ownScorer()||model.card.status!=='in_progress')return false;}
    flushing=(async()=>{
      lastSyncError='';
      try{
        while(hasPending()){
          const sent={...model.dirty},changes=M.changes(model.scores,sent);
          if(changes.length)await F.request(client.rpc('sync_scorecard',{target_scorecard_id:model.card.id,score_changes:changes}));
          model.dirty=M.acknowledge(model.dirty,sent);await persist();
        }
        if(model.submitQueued){
          if(!M.complete(model.players,model.holes,model.scores))throw Error('Some scores are missing. Complete the card before submitting.');
          const current=await F.request(client.from('event_scorecards').select('status,scorer_id').eq('id',model.card.id).single());
          if(!['submitted','locked'].includes(current.status)){
            await F.request(client.rpc('submit_scorecard',{target_scorecard_id:model.card.id}));
            const confirmed=await F.request(client.from('event_scorecards').select('status').eq('id',model.card.id).single());
            if(!['submitted','locked'].includes(confirmed.status))throw Error('Submission has not been confirmed yet. Please try again.');
            model.card.status=confirmed.status;
          }else model.card.status=current.status;
          model.submitQueued=false;model.dirty={};await persist();await S.removeLegacy(model.card.id);view='review';render();
        }
        return true;
      }catch(error){
        lastSyncError=connectionError(error)?'Saved on this phone. Reconnect, then tap to retry.':error.message||'Scores could not be sent. Please try again.';
        if(!connectionError(error)){
          try{const latest=await F.request(client.from('event_scorecards').select('status,scorer_id').eq('id',model.card.id).single());
            if(latest.scorer_id!==session.user.id||['submitted','locked'].includes(latest.status)){
              if(hasPending())try{localStorage.setItem('barford-score-recovery-'+model.card.id,JSON.stringify(model));}catch{}
              model.card={...model.card,...latest};model.dirty={};model.submitQueued=false;await persist();
            }else if(model.submitQueued){model.submitQueued=false;await persist();}
          }catch{}
        }
        return false;
      }
    })().finally(()=>{flushing=null;updateStatus();if(view==='review')review();});updateStatus();return flushing;
  }
  function navigate(n,player){hole=Math.min(18,Math.max(1,n));selected=player||model.players.find(p=>!M.valid(model.scores[M.key(p.id,hole)]))?.id||model.players[0].id;view='card';render();persist();}
  function halfway(){view='halfway';hide('scoreReady');hide('roundReview');show('halfwayReview');$('halfwayPlayers').innerHTML=model.players.map(p=>`<article><strong>${F.esc(p.display_name)}</strong><b>${total(p,1,9)} points</b></article>`).join('');persist();}
  function review(){
    view='review';hide('scoreReady');hide('halfwayReview');hide('scoreLoading');show('roundReview');
    const submitted=['submitted','locked'].includes(model.card.status),all=M.complete(model.players,model.holes,model.scores);
    const expanded=new Set([...$('roundReview').querySelectorAll('details[open]')].map(el=>el.dataset.reviewDetails));
    const title=submitted?model.card.status==='locked'?'Round approved':'Scores submitted':ownScorer()?'Check your group’s scores':'Your group’s scores';
    const explanation=submitted?model.card.status==='locked'?'The committee has approved this round.':'Your scorecard has reached the committee and is awaiting approval.':all?ownScorer()?'Check the scores with your group, then submit.':'Your scorer will submit the card to the committee.':'Scores so far. Unplayed holes are shown as missing.';
    $('roundReview').innerHTML=`<h1>${title}</h1><p>${explanation}</p>
      <div class="group-overview-table"><table><caption>Stableford points for your group</caption><thead><tr><th scope="col">Player</th><th scope="col">Front 9</th><th scope="col">Back 9</th><th scope="col">Total</th></tr></thead><tbody>${model.players.map(p=>{const played=model.holes.filter(h=>M.valid(model.scores[M.key(p.id,h.hole_number)])).length;return `<tr><th scope="row">${F.esc(p.display_name)}<small>${played}/18 holes recorded</small></th><td>${total(p,1,9)}</td><td>${total(p,10,18)}</td><td><strong>${total(p)}</strong></td></tr>`;}).join('')}</tbody></table></div>
      ${!submitted?'<button class="button button-outline" id="returnToCard">Back to scorecard</button>':''}${!submitted&&ownScorer()?`<button class="button button-primary" id="finaliseScores" ${!all||model.submitQueued||flushing?'disabled':''}>${model.submitQueued?'Waiting to submit when connected':'Submit scores to committee'}</button>`:''}
      <p id="finaliseStatus" role="status">${F.esc(lastSyncError)||(model.submitQueued?'Your card is saved on this phone. Reconnect with this page open to finish submitting.':!all?'Complete all 18 holes for every player before submitting.':'')}</p>
      ${model.players.map(p=>`<details class="review-player" data-review-details="${p.id}" ${expanded.has(p.id)?'open':''}><summary>${F.esc(p.display_name)} · ${total(p)} pts <small>${submitted||!ownScorer()?'View hole scores':'Check or edit hole scores'}</small></summary><div class="review-grid">${model.holes.map(h=>{const v=model.scores[M.key(p.id,h.hole_number)];return `<button type="button" data-review-player="${p.id}" data-review-hole="${h.hole_number}" aria-label="${F.esc(p.display_name)}, hole ${h.hole_number}, ${F.esc(scoreText(v))}" ${submitted?'disabled':''}><small>Hole ${h.hole_number}</small><strong>${M.valid(v)?v.picked_up?'X':`${v.strokes}/${points(p,h,v)}`:'—'}</strong></button>`;}).join('')}</div><footer>Strokes / points · X means picked up</footer></details>`).join('')}
      ${model.card.status==='locked'?`<a class="button button-primary" href="scores.html?view=rounds&event=${encodeURIComponent(model.card.event_id)}">Published round results</a>`:''}<a class="button button-outline" href="${F.eventUrl(model.card.event_id)}">Back to my event</a>`;
    $('roundReview').querySelectorAll('[data-review-player]').forEach(b=>b.onclick=()=>navigate(Number(b.dataset.reviewHole),b.dataset.reviewPlayer));
    $('returnToCard')?.addEventListener('click',()=>navigate(hole));$('finaliseScores')?.addEventListener('click',submit);persist();
  }
  async function submit(){
    if(!canEdit()||!M.complete(model.players,model.holes,model.scores))return;
    model.submitQueued=true;if(!await persist()){model.submitQueued=false;$('finaliseStatus').textContent='This phone could not save the card. Keep this page open and reconnect before trying again.';return;}
    review();await flush();updateStatus();
  }
  async function startRound(){
    busy=true;$('startRound').disabled=true;
    try{await F.request(client.rpc('claim_scorecard',{target_scorecard_id:model.card.id}));await refresh();}
    catch(error){F.dialog('Round could not be started',`<p>${F.esc(error.message)}</p><p>Your round can be started on the event day.</p>`);}
    finally{busy=false;render();}
  }
  function handoff(){
    if(!canEdit())return;
    if(!session){F.dialog('Reconnect before handing over','<p>Your round is saved on this phone. Reconnect and tap the save status before handing scoring to another member.</p>');return;}
    const d=F.dialog('Hand over scoring','<p>Choose the member who will continue entering scores. They should then open this event’s scorecard on their phone.</p><div id="handoffChoices"></div><p class="form-status" role="status"></p>');
    d.querySelector('#handoffChoices').innerHTML=model.players.filter(p=>p.member_id&&p.member_id!==session.user.id).map(p=>`<button class="button button-outline full-button" data-next-scorer="${p.member_id}">${F.esc(p.display_name)}</button>`).join('');
    d.querySelectorAll('[data-next-scorer]').forEach(b=>b.onclick=async()=>{
      busy=true;render();d.querySelectorAll('button').forEach(x=>x.disabled=true);
      try{if(!navigator.onLine)throw Error('Connect to the internet before handing over scoring.');if(model.cleared.length)throw Error('Enter a replacement for each cleared score first.');if(!await flush()||hasPending())throw Error('Your latest scores must reach the server before you hand over. Please try again.');await F.request(client.rpc('handoff_scorecard',{target_scorecard_id:model.card.id,target_new_scorer_id:b.dataset.nextScorer}));model.card.scorer_id=b.dataset.nextScorer;model.dirty={};model.submitQueued=false;await persist();await S.removeLegacy(model.card.id);d.close();await refresh();}
      catch(error){d.querySelector('.form-status').textContent=error.message;d.querySelectorAll('button').forEach(x=>x.disabled=false);}
      finally{busy=false;render();}
    });
  }
  $('groupOverview').onclick=()=>{review();updateStatus();};
  $('viewHole').onclick=()=>{persist();const p=model.players.find(p=>p.id===selected);location.href=`hole-view.html?from=scoring&event=${encodeURIComponent(model.card.event_id)}&card=${encodeURIComponent(model.card.id)}&hole=${hole}&tee=${p?.playing_category==='women'?'women':'men'}`;};
  document.querySelectorAll('[data-score]').forEach(b=>b.onclick=()=>edit(Number(b.dataset.score)));$('pickupScore').onclick=()=>edit(null,true);$('clearScore').onclick=()=>edit(null,false,true);
  const next=()=>{if(canEdit()&&!completeHole())return;if(hole===9){halfway();return;}if(hole===18){review();return;}navigate(hole+1);};
  $('nextHole').onclick=next;$('nextHoleTop').onclick=next;$('previousHole').onclick=()=>navigate(hole-1);$('previousHoleBottom').onclick=()=>navigate(hole-1);
  $('continueBackNine').onclick=()=>navigate(10);$('backToFrontNine').onclick=()=>navigate(9);$('scoreSyncButton').onclick=async()=>{if(!model){load();return;}if(hasPending()||model.submitQueued)await flush();else if(navigator.onLine)try{await refresh();lastSyncError='';render();}catch{status('Could not refresh — tap to retry');}};
  $('startRound').onclick=startRound;$('handoffScorecard').onclick=handoff;$('retryScorecard').onclick=load;
  window.addEventListener('online',()=>{if(model){flush();if(!hasPending()&&!model.submitQueued)refresh().then(render).catch(()=>updateStatus());}else load();});
  window.addEventListener('offline',()=>{updateStatus();if(model)render();});
  document.addEventListener('visibilitychange',()=>{if(model)persist();if(document.visibilityState==='visible'&&navigator.onLine){if(hasPending()||model?.submitQueued)flush();else if(model)refresh().then(render).catch(()=>{});}});
  window.addEventListener('storage',event=>{if(event.key==='barford-score-active-member'&&event.newValue!==activeUserId()){identityBlocked=true;render();}});
  window.addEventListener('pagehide',()=>persist());
  setInterval(()=>{if(!model||!navigator.onLine||document.visibilityState==='hidden')return;if(hasPending()||model.submitQueued)flush();else if(!busy&&!loading)refresh().then(()=>{lastSyncError='';render();}).catch(()=>{});},15000);
  load();
})();
