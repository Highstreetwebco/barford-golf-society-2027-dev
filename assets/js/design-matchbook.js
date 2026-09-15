(() => {
 'use strict';
 if(document.documentElement.dataset.design!=='matchbook')return;
 const gateway=document.querySelector('#visitorGateway');
 if(gateway){
  gateway.innerHTML=`<div class="matchbook-intro"><div class="matchbook-kicker"><span class="matchbook-dot" aria-hidden="true"></span> BARFORD GOLF SOCIETY <span>2027 SEASON</span></div><div class="matchbook-title"><p>More than<br>a round.</p><h1>It's your<br><em>golf society.</em></h1></div><p class="matchbook-summary">The people. The courses. The competition.<br>Everything that makes a Barford golf day.</p><div class="matchbook-entrances"><a class="button button-primary" href="account.html">Member sign in <span aria-hidden="true">↗</span></a><a class="matchbook-guest" href="events.html?guest=1">Explore events as a guest <span aria-hidden="true">→</span></a></div><p class="matchbook-join">New to Barford? <a href="signup.html">Create your member account</a></p></div><figure class="matchbook-photo"><img src="assets/images/performance/clubhouse-1280.webp" alt="A Barford golfer teeing off on a society golf day"><figcaption><span>OUT ON THE COURSE</span><strong>Good company.<br>Better golf days.</strong></figcaption><div class="matchbook-photo-label" aria-hidden="true">BARFORD<br><b>27</b></div></figure><div class="matchbook-season-strip"><div><strong>07</strong><span>Society rounds</span></div><div><strong>05</strong><span>Best rounds count</span></div><div class="matchbook-season-copy">A season to<br><strong>look forward to.</strong></div></div><nav class="matchbook-home-links" aria-label="Explore Barford"><a href="events.html?guest=1"><span>01 / THE CALENDAR</span><strong>Find your next round <b aria-hidden="true">↗</b></strong><small>Upcoming golf days and simple guest booking.</small></a><a href="scores.html"><span>02 / THE COMPETITION</span><strong>Follow the season <b aria-hidden="true">↗</b></strong><small>Round results and the society leaderboard.</small></a><a href="gallery.html"><span>03 / THE MEMORIES</span><strong>From the fairway <b aria-hidden="true">↗</b></strong><small>The people and moments from our golf days.</small></a></nav>`;
 }
 // Move existing interactive elements rather than cloning them: their data and handlers survive.
 const welcome=document.querySelector('.simple-welcome');
 if(welcome){const label=welcome.querySelector('.eyebrow');if(label)label.textContent='THE CLUBHOUSE / YOUR DASHBOARD';}
 const secondary=document.querySelector('.clubhouse-dashboard-secondary'),shortcuts=secondary?.querySelector('.simple-actions');
 if(shortcuts&&welcome){shortcuts.classList.add('matchbook-shortcuts');welcome.after(shortcuts);}
 const header=document.querySelector('.site-header .header-inner');
 if(header){const season=document.createElement('div');season.className='matchbook-rail-season';season.innerHTML='<span>BARFORD</span><strong>2027</strong><small>Golf. Together.</small>';header.append(season);}
 const enhance=()=>{
  const host=document.querySelector('#memberDashboardEvent');
  if(!host)return;
  const article=host.querySelector('.simple-next-event');
  if(!article||article.dataset.matchbookReady)return;
  article.dataset.matchbookReady='true';
  const heading=article.querySelector('.clubhouse-event-heading'),body=article.querySelector('.clubhouse-event-body'),action=body?.querySelector('.simple-next-action');
  if(heading&&action){action.classList.add('matchbook-action');heading.after(action);}
 };
 enhance();window.addEventListener('barford-dashboard-ready',enhance);
})();
