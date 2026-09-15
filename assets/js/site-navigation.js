(() => {
  'use strict';
  const page = location.pathname.split('/').pop() || 'index.html';
  const activePage = ({'event.html':'events.html','signup.html':'account.html','scoring.html':'events.html'})[page] || page;
  const pages = [['index.html','Home'],['events.html','Events'],['scores.html','Leaderboard'],['gallery.html','Gallery'],['account.html','Sign in'],['payments.html','Payments'],['worldevents.html','Society trips'],['shop.html','Shop'],['about.html','About us']];
  const current = href => activePage === href ? ` aria-current="${page === href ? 'page' : 'location'}" class="active"` : '';
  const link = ([href,label]) => `<a href="${href}"${current(href)}>${label}</a>`;
  document.querySelectorAll('.site-header .header-inner').forEach(header => {
    const brand = header.querySelector('.brand');
    if (brand) {
      brand.setAttribute('aria-label','Barford Golf Society home');
      // Consistent branding also removes old duplicate text in the admin header.
      brand.innerHTML = '<img src="assets/images/barford-golf-society-logo.png" width="64" height="64" alt=""><span class="brand-wordmark" aria-hidden="true"><strong>Barford</strong><small>Golf Society</small></span>';
    }
    let more = header.querySelector('.site-nav');
    if (!more) { more = document.createElement('nav'); more.className='site-nav'; header.append(more); }
    more.id='primary-navigation'; more.setAttribute('aria-label','More pages'); more.innerHTML='<div class="nav-page-group"><p class="nav-group-label">Your golf</p>'+pages.slice(0,4).map(link).join('')+'</div><div class="nav-page-group"><p class="nav-group-label">Your account</p>'+pages.slice(4,6).map(link).join('')+'</div><div class="nav-page-group"><p class="nav-group-label">The society</p>'+pages.slice(6).map(link).join('')+'</div>';
    let toggle = header.querySelector('.menu-button');
    if (!toggle) { toggle=document.createElement('button'); toggle.className='menu-button'; toggle.type='button'; header.insertBefore(toggle,more); }
    toggle.innerHTML='<span class="menu-button-label">More</span>';
    toggle.setAttribute('aria-controls',more.id); toggle.setAttribute('aria-expanded','false'); toggle.setAttribute('aria-label','Open more pages');
    const primary=document.createElement('nav'); primary.className='desktop-primary'; primary.setAttribute('aria-label','Main pages'); primary.innerHTML=pages.slice(0,4).map(link).join(''); header.insertBefore(primary,toggle);
    const admin=document.createElement('a'); admin.className='header-admin-link'; admin.href='admin.html'; admin.textContent='Admin'; admin.hidden=true;
    if(page==='admin.html')admin.setAttribute('aria-current','page'); header.insertBefore(admin,toggle);
    const close=()=>{more.classList.remove('is-open');toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','Open more pages');toggle.querySelector('.menu-button-label').textContent='More';document.body.classList.remove('mobile-menu-open');};
    toggle.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')!=='true';more.classList.toggle('is-open',open);toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',open?'Close more pages':'Open more pages');toggle.querySelector('.menu-button-label').textContent=open?'Close':'More';document.body.classList.toggle('mobile-menu-open',open);});
    more.addEventListener('click',event=>{if(event.target.closest('a'))close();});
    document.addEventListener('click',event=>{if(!header.contains(event.target))close();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&toggle.getAttribute('aria-expanded')==='true'){close();toggle.focus();}});
  });
  function setContext(context) {
    const signedIn=Boolean(context?.session), isAdmin=signedIn&&context?.profile?.is_admin===true;
    document.body.classList.toggle('is-admin',isAdmin);
    document.querySelectorAll('.header-admin-link').forEach(link=>{link.hidden=!isAdmin;});
    const labels={'index.html':signedIn?'Dashboard':'Home','account.html':signedIn?'My account':'Sign in','payments.html':signedIn?'My payments':'Payments'};
    document.querySelectorAll('.desktop-primary a,.site-nav a').forEach(link=>{const text=labels[link.getAttribute('href').split('?')[0]];if(text)link.textContent=text;});
    document.querySelectorAll('.event-return-links a[href="index.html"]').forEach(link=>{link.textContent=signedIn?'← Dashboard':'← Home';});
    document.querySelectorAll('.mobile-quick-nav a[href="index.html"] > span:last-child').forEach(label=>{label.textContent=labels['index.html'];});
  }
  window.BarfordNavigation={activePage,setContext};
  window.addEventListener('barford-member-context',event=>setContext(event.detail));
})();
