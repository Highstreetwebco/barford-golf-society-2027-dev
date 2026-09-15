(() => {
 'use strict';
 const tools=document.getElementById('scoreToolsDialog'),open=document.getElementById('scoreToolsButton');
 if(!tools||!open)return;
 open.onclick=()=>tools.showModal();
 document.getElementById('closeScoreTools').onclick=()=>tools.close();
 tools.addEventListener('click',e=>{if(e.target.closest('[data-score],[data-edit-player],#handoffScorecard'))tools.close();});
 tools.addEventListener('close',()=>open.focus());
})();
