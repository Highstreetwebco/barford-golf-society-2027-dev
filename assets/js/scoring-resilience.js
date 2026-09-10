(() => {
  'use strict';
  const CACHE='barford-fast-scorecard-v4',PREFIX='barford-scorecard-',DB='barford-score-safety';
  let dbPromise,writeChain=Promise.resolve();
  const parse=value=>{try{return JSON.parse(value||'null');}catch{return null;}};
  const localRead=key=>{try{return parse(localStorage.getItem(key));}catch{return null;}};
  const open=()=>dbPromise||(dbPromise=new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB,1);
    request.onupgradeneeded=()=>{for(const [name,keyPath] of [['snapshots','key'],['pending','card_id']])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name,{keyPath});};
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  }));
  async function transaction(store,mode,fn){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(store,mode);const request=fn(tx.objectStore(store));let result;request.onsuccess=()=>{result=request.result;};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Phone backup unavailable'));});}
  function save(model){
    const value=JSON.stringify(model);let local=false;
    try{localStorage.setItem(PREFIX+model.card.id,value);localStorage.setItem(CACHE,value);local=true;}catch{}
    const record={key:PREFIX+model.card.id,value,saved_at:model.savedAt,card_id:model.card.id,user_id:model.userId};
    // Serialize backup writes so an earlier save cannot overwrite a newer score.
    const backup=writeChain.catch(()=>{}).then(async()=>{await transaction('snapshots','readwrite',store=>store.put(record));return true;});
    writeChain=backup;
    if(local){backup.catch(()=>{});return Promise.resolve({local:true,backup:false});}
    return window.BarfordMemberFlow.bounded(backup,2500).then(()=>({local:false,backup:true}),()=>({local:false,backup:false}));
  }
  async function read(userId,cardId,eventId){
    const matches=m=>m?.userId===userId&&m.card?.id&&(!cardId||m.card.id===cardId)&&(!eventId||m.card.event_id===eventId);
    const candidates=[localRead(CACHE),cardId?localRead(PREFIX+cardId):null];
    try{const records=await window.BarfordMemberFlow.bounded(transaction('snapshots','readonly',s=>s.getAll()),2500);candidates.push(...records.map(r=>parse(r.value)));}catch{}
    return candidates.filter(matches).sort((a,b)=>Number(b.savedAt)-Number(a.savedAt))[0]||null;
  }
  async function legacyPending(cardId){try{return await transaction('pending','readonly',s=>s.get(cardId));}catch{return null;}}
  async function removeLegacy(cardId){try{await transaction('pending','readwrite',s=>s.delete(cardId));}catch{}}
  window.BarfordScoreSafety={save,read,legacyPending,removeLegacy};
  if(navigator.storage?.persist)navigator.storage.persist().catch(()=>{});
  let wakeEnabled=false,wakeLock;
  const wake=async()=>{if(!wakeEnabled||document.visibilityState!=='visible')return;try{wakeLock=await navigator.wakeLock.request('screen');}catch{}};
  const button=document.getElementById('scoreWakeButton');
  if(button&&navigator.wakeLock){button.classList.remove('hidden');button.onclick=async()=>{wakeEnabled=!wakeEnabled;button.setAttribute('aria-pressed',String(wakeEnabled));button.textContent=wakeEnabled?'Let screen sleep':'Keep screen awake';if(wakeEnabled)await wake();else try{await wakeLock?.release();}catch{}};}
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')wake();});
})();
