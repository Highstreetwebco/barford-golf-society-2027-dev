(()=>{"use strict";const l=window.BarfordSupabase;if(!l)return;const i=()=>{const a=document.querySelector("#adminAccountList");if(!a)return;new MutationObserver(()=>c(a)).observe(a,{childList:!0}),c(a)},c=async a=>{const r=[...a.querySelectorAll(".admin-account-row")];if(!r.length||r.every(e=>e.dataset.golfSettingsReady))return;const{data:g,error:p}=await l.from("profiles").select("id,full_name,handicap,playing_category").order("full_name");if(p)return;const b=new Map((g||[]).map(e=>[String(e.full_name||"").trim().toLowerCase(),e]));r.forEach(e=>{if(e.dataset.golfSettingsReady)return;const f=e.querySelector(".admin-account-name strong")?.textContent?.trim().toLowerCase(),n=b.get(f);if(!n)return;e.dataset.golfSettingsReady="1";const t=document.createElement("div");t.className="admin-member-golf-settings",t.innerHTML=`
        <div class="admin-member-golf-heading"><strong>Golf settings</strong><small>Committee controlled</small></div>
        <label>Playing tees
          <select data-member-tee>
            <option value="">Not set</option>
            <option value="men" ${n.playing_category==="men"?"selected":""}>Yellow tees</option>
            <option value="women" ${n.playing_category==="women"?"selected":""}>Red tees</option>
          </select>
        </label>
        <label>Starting handicap
          <input data-member-handicap type="number" min="0" max="54" step="0.1" inputmode="decimal" value="${n.handicap??""}" placeholder="e.g. 18.0">
        </label>
        <button class="button button-small button-outline" type="button" data-save-member-golf>Save golf settings</button>
        <small data-member-golf-status></small>`,e.appendChild(t),t.querySelector("[data-save-member-golf]").addEventListener("click",async y=>{const d=y.currentTarget,s=t.querySelector("[data-member-golf-status]"),v=t.querySelector("[data-member-tee]").value||null,m=t.querySelector("[data-member-handicap]").value.trim(),o=m===""?null:Number(m);if(o!==null&&(!Number.isFinite(o)||o<0||o>54)){s.textContent="Enter a handicap between 0 and 54.";return}d.disabled=!0,s.textContent="Saving\u2026";const{error:u}=await l.from("profiles").update({playing_category:v,handicap:o,updated_at:new Date().toISOString()}).eq("id",n.id);d.disabled=!1,s.textContent=u?u.message:"Saved."})})};document.readyState==="loading"?document.addEventListener("DOMContentLoaded",i,{once:!0}):i()})();
