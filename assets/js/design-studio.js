(() => {
 'use strict';
 const frame=document.querySelector('#designFrame'),page=document.querySelector('#previewPage'),full=document.querySelector('#openDesign');
 const selected=new URLSearchParams(location.search).get('design');
 let theme=['fairway','links','tour','matchbook','drive','round','teesheet'].includes(selected)?selected:'drive',phone=true;
 const descriptions={teesheet:'Tee sheet — a separate fixture-board interface. Tap a date, check your place and take the next step. Drive remains saved.',round:'Round — clear booking, payment and tee-group states, with one next step. Drive stays your favourite.',drive:'Drive — your current favourite and live design. Electric blue, orange and oversized golf graphics.',matchbook:'Matchbook — a new layout: side navigation, editorial homepage, event tiles and a task-first dashboard.',fairway:'Fairway — your earlier favourite, still saved.',links:'Links — an editorial golf style with navy, warm sand and your society photography.',tour:'Tour — a modern golf-app style with dark surroundings, bright accents and rounded controls.'};
 function render(navigate=true){
  const url=new URL(theme==='teesheet'?'tee-sheet.html':page.value,location.href);if(theme!=='teesheet')url.searchParams.set('design',theme);page.disabled=theme==='teesheet';
  if(navigate)frame.src=url.href;full.href=url.href;
  frame.className=phone?'phone':'desktop';frame.title=`${theme[0].toUpperCase()+theme.slice(1)} design — ${phone?'phone':'desktop'} preview`;
  document.querySelector('#designDescription').textContent=descriptions[theme];
  document.querySelectorAll('[data-theme]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.theme===theme)));
  document.querySelector('#phoneView').setAttribute('aria-pressed',String(phone));document.querySelector('#desktopView').setAttribute('aria-pressed',String(!phone));
 }
 document.querySelectorAll('[data-theme]').forEach(b=>b.addEventListener('click',()=>{theme=b.dataset.theme;render();}));
 page.addEventListener('change',()=>render());
 document.querySelector('#phoneView').addEventListener('click',()=>{phone=true;render(false);});
 document.querySelector('#desktopView').addEventListener('click',()=>{phone=false;render(false);});
 render();
})();
