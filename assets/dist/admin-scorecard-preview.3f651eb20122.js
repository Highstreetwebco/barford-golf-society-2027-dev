(()=>{"use strict";if((location.pathname.split("/").pop()||"")!=="admin.html")return;const c=document.getElementById("adminHoleEditor");if(!c)return;const s=document.createElement("style");s.id="adminScorecardPreviewStyles",s.textContent=`
    #adminHoleEditor.scorecard-preview-editor{display:grid;gap:10px;margin-top:14px}
    #adminHoleEditor .admin-hole-row.scorecard-hole{display:grid;grid-template-columns:72px minmax(0,1fr);gap:10px 14px;align-items:center;padding:13px 14px;border:1px solid #e1e6e2;border-radius:15px;background:#fff;box-shadow:0 3px 12px rgba(3,37,27,.035)}
    #adminHoleEditor .scorecard-hole-number{grid-row:1/3;display:flex;align-items:center;gap:7px;align-self:stretch;padding-right:12px;border-right:1px solid #e7ebe8;color:#123c2f}
    #adminHoleEditor .scorecard-hole-number span{font-size:.7rem;font-weight:850;letter-spacing:.06em;text-transform:uppercase;color:#77827c}
    #adminHoleEditor .scorecard-hole-number strong{font-size:1.55rem;line-height:1}
    #adminHoleEditor .scorecard-tee-line{display:flex;align-items:center;gap:11px;min-width:0}
    #adminHoleEditor .scorecard-tee-name{display:inline-flex;align-items:center;justify-content:center;flex:0 0 68px;min-height:34px;padding:5px 9px;border-radius:9px;font-size:.78rem;font-weight:950;letter-spacing:.02em}
    #adminHoleEditor .scorecard-tee-name.yellow{background:#f6dc3c;color:#302900}
    #adminHoleEditor .scorecard-tee-name.red{background:#d94a43;color:#fff}
    #adminHoleEditor .scorecard-fact{display:flex;align-items:center;gap:5px;white-space:nowrap;color:#5d6862;font-size:.79rem;font-weight:800}
    #adminHoleEditor .scorecard-fact.yards{min-width:122px}
    #adminHoleEditor .scorecard-fact input{width:62px!important;min-width:0!important;min-height:38px!important;height:38px!important;padding:6px 7px!important;border:1px solid #d7ded9!important;border-radius:9px!important;background:#fbfcfb!important;color:#15211c!important;font-size:.96rem!important;font-weight:850!important;text-align:center!important;box-shadow:none!important}
    #adminHoleEditor .scorecard-fact.yards input{width:70px!important}
    #adminHoleEditor .scorecard-fact input:focus{border-color:#0b5a40!important;box-shadow:0 0 0 3px rgba(11,90,64,.1)!important;outline:0!important}
    #adminHoleEditor .scorecard-dot{color:#a1aaa5;font-weight:700}
    @media(max-width:700px){
      #adminHoleEditor.scorecard-preview-editor{gap:9px}
      #adminHoleEditor .admin-hole-row.scorecard-hole{grid-template-columns:1fr;gap:8px;padding:12px;border-radius:14px}
      #adminHoleEditor .scorecard-hole-number{grid-row:auto;border-right:0;border-bottom:1px solid #edf0ee;padding:0 0 9px;align-self:auto}
      #adminHoleEditor .scorecard-hole-number strong{font-size:1.35rem}
      #adminHoleEditor .scorecard-tee-line{display:grid;grid-template-columns:64px minmax(93px,1.25fr) minmax(70px,.8fr) minmax(58px,.7fr);gap:7px;align-items:center}
      #adminHoleEditor .scorecard-tee-name{flex:none;width:64px;min-height:36px;padding:5px 6px}
      #adminHoleEditor .scorecard-fact{justify-content:flex-start;gap:4px;font-size:.72rem}
      #adminHoleEditor .scorecard-fact.yards{min-width:0}
      #adminHoleEditor .scorecard-fact input,#adminHoleEditor .scorecard-fact.yards input{width:100%!important;max-width:58px!important;min-height:40px!important;height:40px!important;font-size:1rem!important}
      #adminHoleEditor .scorecard-fact.yards input{max-width:66px!important}
      #adminHoleEditor .scorecard-dot{display:none}
    }
    @media(max-width:390px){
      #adminHoleEditor .scorecard-tee-line{grid-template-columns:58px minmax(86px,1.25fr) minmax(64px,.8fr) minmax(54px,.7fr);gap:5px}
      #adminHoleEditor .scorecard-tee-name{width:58px;font-size:.7rem}
      #adminHoleEditor .scorecard-fact{font-size:.67rem}
    }
  `,document.getElementById(s.id)||document.head.appendChild(s);const d=(e,n)=>e.querySelector(`input[data-field="${n}"]`),m=(e,n,a="",i="")=>{const t=document.createElement("span");t.className=`scorecard-fact ${i}`.trim();const r=document.createElement("span");if(r.textContent=e,t.append(r,n),a){const o=document.createElement("span");o.textContent=a,t.append(o)}return t},x=()=>{const e=document.createElement("span");return e.className="scorecard-dot",e.textContent="\xB7",e},f=(e,n,a,i,t)=>{const r=document.createElement("div");r.className="scorecard-tee-line";const o=document.createElement("span");return o.className=`scorecard-tee-name ${n}`,o.textContent=e,r.append(o,m("",a,"yds","yards"),x(),m("Par",i),x(),m("SI",t)),r},u=e=>{if(!(e instanceof HTMLElement)||e.dataset.scorecardRefined==="1")return;const n=e.querySelector(":scope > strong"),a=d(e,"par"),i=d(e,"yards"),t=d(e,"stroke_index"),r=d(e,"red_par"),o=d(e,"red_yards"),p=d(e,"red_stroke_index");if(!n||!a||!i||!t||!r||!o||!p)return;const E=n.textContent.trim();[a,i,t,r,o,p].forEach(h=>{h.placeholder="",h.inputMode="numeric"});const l=document.createElement("div");l.className="scorecard-hole-number",l.innerHTML=`<span>Hole</span><strong>${E}</strong>`,e.textContent="",e.classList.add("scorecard-hole"),e.dataset.scorecardRefined="1",e.append(l,f("Yellow","yellow",i,a,t),f("Red","red",o,r,p))},g=()=>{c.classList.add("scorecard-preview-editor"),c.querySelectorAll(".admin-hole-row").forEach(u)};g(),new MutationObserver(g).observe(c,{childList:!0,subtree:!1})})();
