(() => {
 'use strict';
 const requested=new URLSearchParams(location.search).get('design');
 const themes={fairway:null,links:'assets/css/design-links.css',tour:'assets/css/design-tour.css',matchbook:'assets/css/design-matchbook.css',drive:'assets/css/design-drive.css',round:'assets/css/design-round.css'};
 const design=Object.prototype.hasOwnProperty.call(themes,requested)?requested:'drive';
 document.documentElement.dataset.design=design;
 if(design==='round'){const layout=document.createElement('script');layout.src='assets/js/design-round.js';document.body.append(layout);}
 if(themes[design]){const sheet=document.createElement('link');sheet.rel='stylesheet';sheet.href=themes[design];document.head.append(sheet);}
 if(design==='drive'){const layout=document.createElement('script');layout.src='assets/js/design-drive.js';document.body.append(layout);}
 if(design==='matchbook'){const layout=document.createElement('script');layout.src='assets/js/design-matchbook.js';document.body.append(layout);}
 document.addEventListener('click',event=>{
  const a=event.target.closest('a[href]');if(!a||a.hasAttribute('download'))return;
  const url=new URL(a.href,location.href),base=location.pathname.slice(0,location.pathname.lastIndexOf('/')+1);
  if(url.origin!==location.origin||!url.pathname.startsWith(base)||!url.pathname.endsWith('.html')||url.pathname.endsWith('/designs.html'))return;
  url.searchParams.set('design',design);a.href=url.href;
 },true);
})();
