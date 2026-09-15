(function () {
  'use strict';
  function parseHandicap(value) {
    const raw=String(value??'').trim();
    if(!/^\d{1,2}(\.\d)?$/.test(raw)||Number(raw)>54)throw Error('Enter a handicap from 0 to 54, with up to one decimal place.');
    return Number(raw);
  }
  function sortedMembers(rows) {
    return [...rows].sort((a,b)=>Number(a.handicap!=null)-Number(b.handicap!=null)||String(a.full_name).localeCompare(String(b.full_name))||a.id.localeCompare(b.id));
  }
  if(typeof module==='object'&&module.exports)module.exports={parseHandicap,sortedMembers};
  if(typeof document==='undefined')return;
  const db=window.BarfordSupabase,button=document.getElementById('adminAddHandicaps');
  if(!db||!button)return;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function request(task){let timer;try{const result=await Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Connection timed out. Refresh the list before trying again.')),15000);})]);if(result.error)throw result.error;return result.data;}finally{clearTimeout(timer);}}
  button.addEventListener('click',()=>{
    const dialog=document.createElement('dialog');dialog.className='admin-handicap-dialog';
    dialog.setAttribute('aria-labelledby','handicapDialogTitle');
    dialog.innerHTML=`<div class="admin-handicap-heading"><div><p class="eyebrow">Member handicaps</p><h2 id="handicapDialogTitle">Add handicaps</h2></div><button type="button" class="button button-outline" data-close>Close</button></div><p>Set the society handicap for each registered member. Members awaiting admin appear first.</p><div class="admin-handicap-filters"><label>Find a member<input type="search" data-search placeholder="Search by name or email"></label><label class="admin-handicap-pending"><input type="checkbox" data-pending> Awaiting admin only</label><button type="button" class="button button-outline" data-refresh>Refresh list</button></div><p data-count aria-live="polite"></p><p data-status role="status"></p><div data-list></div><p class="admin-handicap-help">Handicaps apply when new scorecards are prepared. Existing scorecards keep the handicap assigned for that round.</p>`;
    document.body.append(dialog);dialog.showModal();
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>dialog.remove(),{once:true});
    const list=dialog.querySelector('[data-list]'),status=dialog.querySelector('[data-status]');let records=[],loading=false;
    const count=()=>dialog.querySelector('[data-count]').textContent=`${records.filter(p=>p.handicap==null).length} awaiting admin · ${records.length} registered members`;
    function render(){
      const q=dialog.querySelector('[data-search]').value.trim().toLowerCase(),pending=dialog.querySelector('[data-pending]').checked;
      const filtered=sortedMembers(records).filter(p=>(!pending||p.handicap==null)&&`${p.full_name} ${p.email}`.toLowerCase().includes(q));count();
      list.innerHTML=filtered.map(p=>`<form class="admin-handicap-row" data-member="${esc(p.id)}"><div><strong>${esc(p.full_name)}</strong><small>${esc(p.email)}</small><span data-state>${p.handicap==null?'Awaiting admin':'Handicap set'}</span></div><label>Society handicap<input name="handicap" type="number" min="0" max="54" step="0.1" inputmode="decimal" required value="${esc(p.handicap??'')}" placeholder="Not set" aria-label="Handicap for ${esc(p.full_name)}"></label><button class="button button-primary" type="submit">${p.handicap==null?'Set handicap':'Save handicap'}</button><p class="admin-handicap-row-status" role="status"></p></form>`).join('')||'<p>No members match this filter.</p>';
      list.querySelectorAll('form').forEach(form=>form.onsubmit=async event=>{
        event.preventDefault();const p=records.find(p=>p.id===form.dataset.member),save=form.querySelector('button'),msg=form.querySelector('[role="status"]');
        try{
          const handicap=parseHandicap(form.elements.handicap.value);save.disabled=true;msg.textContent='Saving…';
          const saved=await request(db.rpc('admin_set_member_handicap',{target_member_id:p.id,new_handicap:handicap,expected_handicap:p.handicap}));
          if(!saved||saved.id!==p.id||Number(saved.handicap)!==handicap)throw Error('The saved handicap could not be confirmed. Refresh the list.');
          p.handicap=Number(saved.handicap);form.querySelector('[data-state]').textContent='Handicap set';save.textContent='Save handicap';count();msg.textContent=`Saved: ${handicap}`;
        }catch(error){msg.textContent=error.message||'Could not save. Please try again.';}finally{save.disabled=false;}
      });
    }
    async function load(){
      if(loading)return;loading=true;records=[];count();list.replaceChildren();status.textContent='Loading registered members…';
      try{
        const auth=await request(db.auth.getUser());if(!auth?.user)throw Error('Sign in with an admin account.');
        const profile=await request(db.from('profiles').select('is_admin').eq('id',auth.user.id).single());
        if(!profile?.is_admin)throw Error('Administrator access required.');
        records=await request(db.from('profiles').select('id,full_name,email,handicap').order('full_name'))||[];
        if(dialog.isConnected){render();status.textContent='';}
      }catch(error){status.textContent=error.message||'Could not load members.';}finally{loading=false;}
    }
    dialog.querySelector('[data-search]').oninput=render;dialog.querySelector('[data-pending]').onchange=render;
    dialog.querySelector('[data-refresh]').onclick=load;load();
  });
})();
