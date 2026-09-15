(() => {
 'use strict';
 const tools=document.getElementById('scoreToolsDialog'),open=document.getElementById('scoreToolsButton');
 if(!tools||!open)return;
 open.onclick=()=>{const highScores=tools.querySelector('[data-score]')?.closest('details');if(highScores)highScores.hidden=document.getElementById('scoreKeypad').classList.contains('hidden');tools.showModal();};
 document.getElementById('closeScoreTools').onclick=()=>tools.close();
 tools.addEventListener('click',e=>{if(e.target.closest('[data-score],[data-edit-player],#handoffScorecard'))tools.close();});
 tools.addEventListener('close',()=>open.focus());
})();
