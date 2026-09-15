(() => {
 'use strict';
 const $=id=>document.getElementById(id),names=['Player One','Player Two','Player Three','Player Four'];let selected=0,hole=1;const rounds={};
 const scores=()=>rounds[hole]||(rounds[hole]=[null,null,null,null]);
 document.body.classList.add('matchday-ui');$('scoreLoading').classList.add('hidden');$('scoreReady').classList.remove('hidden');
 $('scoreBack').href='designs.html?design=drive';$('scoreBack').textContent='← Designs';$('competitionSummary').textContent='Practice group';$('scoreSyncButton').textContent='Practice only';$('scoreSafetyText').textContent='Try the buttons. No scores are saved.';
 $('redTeeSummary').classList.add('hidden');$('scoreSessionNotice').textContent='Tap a player, then enter their score.';
 function render(){
  $('holeProgress').textContent=`Hole ${hole} of 18`;$('holeTitle').textContent=`Hole ${hole}`;$('holePar').textContent='Par 4';$('holeYards').textContent='360 yards';$('holeIndex').textContent='Stroke index 7';
  $('scoreCurrentPlayers').innerHTML=names.map((name,i)=>`<button class="score-player-row ${selected===i?'is-selected':''}" data-player="${i}" aria-pressed="${selected===i}"><span><strong>${name}</strong><small>Yellow tees · Practice</small></span><b>${scores()[i]??'—'}<small>${scores()[i]===null?'Not entered':'Entered'}</small></b></button>`).join('');
  $('scoreCurrentPlayers').querySelectorAll('button').forEach(b=>b.onclick=()=>{selected=+b.dataset.player;render();});
  $('selectedPlayerPrompt').innerHTML=`<strong>${names[selected]}</strong><small>Strokes / X = pick up</small>`;
  $('nextHole').disabled=scores().some(s=>s===null);$('nextHoleTop').disabled=$('nextHole').disabled;$('previousHole').disabled=hole===1;$('nextHole').textContent=hole===18?'Review practice scores':scores().some(s=>s===null)?'Enter all scores above':'Next hole';
 }
 function enter(value){scores()[selected]=value;const next=scores().findIndex(s=>s===null);if(value!==null&&next>=0)selected=next;render();}
 document.querySelectorAll('[data-score]').forEach(b=>b.onclick=()=>enter(+b.dataset.score));$('pickupScore').onclick=()=>enter('X');$('clearScore').onclick=()=>enter(null);
 $('previousHole').onclick=()=>{hole=Math.max(1,hole-1);render();};$('nextHole').onclick=$('nextHoleTop').onclick=()=>{if(!scores().some(s=>s===null)){hole=Math.min(18,hole+1);selected=0;render();}};
 $('groupOverview').onclick=()=>{const d=document.createElement('dialog');d.className='score-tools-dialog';d.innerHTML='<h2>Practice overview</h2>'+names.map((name,i)=>`<p>${name}: ${scores()[i]??'Not entered'} on hole ${hole}</p>`).join('')+'<button class="button button-primary">Back to scoring</button>';document.body.append(d);d.querySelector('button').onclick=()=>{d.close();d.remove();};d.showModal();};
 $('viewHole').onclick=()=>{const d=document.createElement('dialog');d.className='score-tools-dialog';d.innerHTML='<h2>Hole map</h2><p>Open your real event scorecard to view its mapped holes.</p><button class="button button-primary">Back to scoring</button>';document.body.append(d);d.querySelector('button').onclick=()=>{d.close();d.remove();};d.showModal();};
 render();
})();
