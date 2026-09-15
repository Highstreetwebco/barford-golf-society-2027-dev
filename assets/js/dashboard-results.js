(() => {
  'use strict';
  const F=window.BarfordMemberFlow,WINDOW=48*60*60*1000;
  function select(events,now=Date.now()){
    return events.filter(e=>e.status==='completed'&&Number.isFinite(Date.parse(e.results_published_at))&&Date.parse(e.results_published_at)<=now&&now<Date.parse(e.results_published_at)+WINDOW).sort((a,b)=>Date.parse(b.results_published_at)-Date.parse(a.results_published_at))[0]||null;
  }
  function render(host,event,snapshot,roundId,memberId){
    const round=snapshot?.rounds?.find(r=>r.id===roundId),results=round?.locked&&!round.restricted?(round.results||[]).filter(r=>!r.dnp&&Number.isFinite(r.points)).sort((a,b)=>b.points-a.points):[];
    const own=results.find(r=>r.playerId===memberId),name=id=>snapshot.players?.find(p=>p.id===id)?.name||'Member';
    host.innerHTML=`<section class="simple-card dashboard-round-results" aria-labelledby="dashboardResultsTitle"><p class="eyebrow">Round complete</p><h2 id="dashboardResultsTitle">Round results</h2><p><strong>${F.esc(event.name)}</strong> · ${F.esc(F.date(event.event_date))}</p>
      ${own?`<div class="simple-next-action"><strong>You scored ${F.esc(own.points)} Stableford points</strong><p>${own.nextHandicap!=null?'Next-round handicap: '+F.esc(own.nextHandicap):'View the full results for your round.'}</p></div>`:''}
      ${results.length?`<ol class="simple-player-list">${results.slice(0,3).map(r=>`<li value="${results.findIndex(x=>x.points===r.points)+1}">${F.esc(name(r.playerId))} — <strong>${F.esc(r.points)} pts</strong></li>`).join('')}</ol><p>Highest points · equal points shown as ties. Full results include competition awards.</p>`:`<p>${round?.restricted?'These results are being held for the presentation evening.':snapshot?'Open the full round results below.':'The results summary couldn’t be loaded. Open the full results to try again.'}</p>`}
      <a class="button button-primary full-button" href="scores.html?view=rounds&event=${encodeURIComponent(event.id)}">View full round results</a><div class="simple-actions"><a class="button button-outline" href="gallery.html?event=${encodeURIComponent(event.id)}">Event photos</a><a class="button button-outline" href="events.html">Upcoming events</a></div><p>This round stays here for 48 hours after publication, then your next event takes its place.</p></section>`;
  }
  window.BarfordDashboardResults={select,render,expires:event=>Date.parse(event.results_published_at)+WINDOW};
})();
