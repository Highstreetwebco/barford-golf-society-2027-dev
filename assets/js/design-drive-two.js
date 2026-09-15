(() => {
 'use strict';
 if(document.documentElement.dataset.variant!=='drive-two')return;
 const gateway=document.querySelector('#visitorGateway');
 if(gateway)gateway.innerHTML=`<section class="drive-two-entrance"><div class="drive-two-copy"><p class="eyebrow">BARFORD / YOUR NEXT ROUND STARTS HERE</p><h1>GOOD GOLF.<br><span>BETTER<br>COMPANY.</span></h1><p>Book a round. Meet your group.<br>Enjoy the golf. We’ll keep things simple.</p><nav class="drive-two-start" aria-label="Get started"><a href="account.html" class="drive-two-member"><span>ALREADY A MEMBER?</span><strong>Open my clubhouse <b aria-hidden="true">↗</b></strong><small>Sign in for your round and group scorecard.</small></a><a href="events.html?guest=1" class="drive-two-guest"><strong>Playing as a guest? <b aria-hidden="true">↗</b></strong><small>See the golf days and RSVP with your name.</small></a></nav><p class="drive-two-signup">New member? <a href="signup.html">Create your account →</a></p></div><div class="drive-two-art" aria-hidden="true"><span>THE<br>GOOD<br>ROUND.</span><div class="drive-two-ball"></div><small>BARFORD GOLF SOCIETY · 2027</small></div></section><section class="drive-two-explore"><div><span>01 / BOOK</span><a href="events.html?guest=1">Find your next golf day ↗</a><p>Dates, prices and available places.</p></div><div><span>02 / COMPETE</span><a href="scores.html">See the leaderboard ↗</a><p>Round results and the season standings.</p></div><div><span>03 / RELIVE</span><a href="gallery.html">Open the photo album ↗</a><p>The people and moments behind the scores.</p></div></section>`;
 const home=document.querySelector('.simple-member-home .simple-shell');
 if(home){
  const welcome=home.querySelector('.simple-welcome'),links=home.querySelector('.drive-dashboard-links'),grid=home.querySelector('.clubhouse-dashboard-grid');
  if(welcome){const eyebrow=welcome.querySelector('.eyebrow');if(eyebrow)eyebrow.textContent='LET’S GET YOU READY TO PLAY';}
  // Keep the round ahead of secondary shortcuts, without replacing live controls.
  if(links&&grid)grid.after(links);
 }
})();
