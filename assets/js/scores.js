import { ScoresData } from "./scores-data.js?v=member74";
import { rankPlayers, calculatePlayerStatistics } from "./handicap-engine.js";


const state = {
  data: null,
  activeView: "leaderboard",
  selectedRoundId: null,
  selectedLeaderboardRoundId: null,
  selectedPlayerId: null,
  currentUserId: null,
  search: ""
};
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const formatChange = value => value == null ? "DNP" : value > 0 ? `+${value}` : `${value}`;
const latestResult = (playerId) => [...state.data.rounds].reverse().map(r => r.results.find(x => x.playerId === playerId)).find(Boolean);

async function refresh() {
  const auth=await window.BarfordMemberFlow.request(window.BarfordSupabase.auth.getSession());
  state.currentUserId=auth.session?.user?.id||null;
  if(!auth.session){
    $$('.view').forEach(view=>{view.innerHTML=`<article class="simple-card"><h2>Sign in to see society results</h2><p>View the leaderboard, round results and your handicap.</p><a class="button button-primary" href="${window.BarfordMemberFlow.loginUrl(location.href)}">Sign in to view results</a></article>`;});
    setView(new URLSearchParams(location.search).get('view')||'leaderboard');return;
  }
  state.data=await ScoresData.getSnapshot(state.currentUserId);
  const eventId=new URLSearchParams(location.search).get('event');
  if(eventId){const result=await window.BarfordMemberFlow.request(window.BarfordSupabase.from('rounds').select('id').eq('event_id',eventId).eq('season',2027).maybeSingle());if(result&&state.data.rounds.some(r=>r.id===result.id))state.selectedRoundId=result.id;}
  const requestedRound=new URLSearchParams(location.search).get('round');
  if(requestedRound&&state.data.rounds.some(r=>r.id===requestedRound))state.selectedRoundId=requestedRound;
  state.selectedRoundId ||= getCompletedRounds().at(-1)?.id || state.data.rounds[0]?.id;
  state.selectedPlayerId ||= state.data.players.find(p=>p.id===state.currentUserId)?.id || state.data.players[0]?.id;

  const completedRounds = getCompletedRounds();
  if (
    !state.selectedLeaderboardRoundId ||
    !completedRounds.some(round => round.id === state.selectedLeaderboardRoundId)
  ) {
    state.selectedLeaderboardRoundId = completedRounds.at(-1)?.id ?? null;
  }

  const find=document.getElementById('findMyPosition');find.hidden=!state.currentUserId;
  find.onclick=()=>{state.search='';document.getElementById('playerSearch').value='';setView('leaderboard');renderLeaderboard();const row=document.querySelector('.is-current-player');if(row){row.scrollIntoView({block:'center',behavior:'smooth'});row.tabIndex=-1;row.focus({preventScroll:true});}else document.getElementById('myPositionStatus').textContent='Your position will appear after your first published result.';};
  renderAll();
  setView(new URLSearchParams(location.search).get("view")||state.activeView);
}

function renderAll() {
  renderSeasonOverview();
  renderLeaderboardRoundTabs();
  renderLeaderboard();
  renderRoundTabs();
  renderRound();
  renderPlayerSelects();
  if (state.activeView === "handicaps") renderHandicapHistory();
  if (state.activeView === "statistics") renderStatistics();
}

function getCompletedRounds() {
  return [...state.data.rounds]
    .filter(round => round.results.some(result => result && (result.dnp || Number.isFinite(result.points))))
    .sort((a, b) => a.number - b.number);
}

function getLeaderboardRounds() {
  const completed = getCompletedRounds();
  const selectedIndex = completed.findIndex(round => round.id === state.selectedLeaderboardRoundId);
  return selectedIndex >= 0 ? completed.slice(0, selectedIndex + 1) : completed;
}

function renderLeaderboardRoundTabs() {
  const tabs = $("#leaderboardRoundTabs");
  tabs.innerHTML = "";
  const rounds = getCompletedRounds();

  rounds.forEach(round => {
    const button = document.createElement("button");
    button.className = "leaderboard-round-tab";
    button.type = "button";
    button.role = "tab";
    button.textContent = `After ${round.name}`;
    button.setAttribute("aria-selected", String(round.id === state.selectedLeaderboardRoundId));
    button.addEventListener("click", () => {
      state.selectedLeaderboardRoundId = round.id;
      renderSeasonOverview();
      renderLeaderboardRoundTabs();
      renderLeaderboard();
    });
    tabs.append(button);
  });
}

const SEASON_ROUNDS = 7;

function friendlyDate(value) {
  if (!value) return "Date to be announced";
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(parsed);
}

function friendlyTime(value) {
  if (!value) return "";
  return String(value).slice(0, 5);
}

function renderSeasonOverview() {
  const completed = getCompletedRounds();
  const selectedRound = state.data.rounds.find(round => round.id === state.selectedLeaderboardRoundId)
    || completed.at(-1)
    || null;
  const completedCount = Math.min(completed.length, SEASON_ROUNDS);
  const displayedRound = selectedRound?.number || Math.min(completedCount + 1, SEASON_ROUNDS);

  $("#seasonProgressTitle").textContent = selectedRound
    ? `Round ${displayedRound} of ${SEASON_ROUNDS}`
    : `Before Round ${displayedRound}`;
  $("#seasonProgressCount").textContent = `${completedCount} of ${SEASON_ROUNDS} played`;
  $("#seasonProgressBar").style.width = `${(completedCount / SEASON_ROUNDS) * 100}%`;
  $(".season-progress-track").setAttribute("aria-valuenow", String(completedCount));

  if (selectedRound) {
    const results = selectedRound.results.filter(result => result && !result.dnp && Number.isFinite(result.points));
    const winner = [...results].sort((a, b) => b.points - a.points)[0];
    const winnerName = state.data.players.find(player => player.id === winner?.playerId)?.name;
    $("#lastEventName").textContent = selectedRound.name;
    $("#lastEventDetail").textContent = friendlyDate(selectedRound.date);
    $("#lastEventHighlights").innerHTML = [
      winnerName ? `<span><small>Winner</small><strong>${escapeHtml(winnerName)}</strong></span>` : "",
      winner ? `<span><small>Winning score</small><strong>${winner.points} pts</strong></span>` : "",
      `<span><small>Played</small><strong>${results.length} players</strong></span>`
    ].join("");
  } else {
    $("#lastEventName").textContent = "No event played yet";
    $("#lastEventDetail").textContent = "Round results will appear here once the scores are saved.";
    $("#lastEventHighlights").innerHTML = "";
  }

  const next = state.data.nextEvent;
  if (next) {
    const location = [next.venue, next.address].filter(Boolean).join(" · ");
    const firstTee = friendlyTime(next.first_tee_time);
    $("#nextEventName").textContent = next.name || "Next event";
    $("#nextEventDetail").textContent = [friendlyDate(next.event_date), location].filter(Boolean).join(" · ");
    $("#nextEventHighlights").innerHTML = [
      `<span><small>Up next</small><strong>Round ${Math.min(completedCount + 1, SEASON_ROUNDS)}</strong></span>`,
      firstTee ? `<span><small>First tee</small><strong>${escapeHtml(firstTee)}</strong></span>` : "",
      Number.isFinite(Number(next.price)) ? `<span><small>Price</small><strong>£${Number(next.price).toFixed(2)}</strong></span>` : ""
    ].join("");
  } else {
    $("#nextEventName").textContent = "Next event not announced";
    $("#nextEventDetail").textContent = "The committee will publish the next event here.";
    $("#nextEventHighlights").innerHTML = "";
  }
}

function renderLeaderboard() {
  const list = $("#leaderboardList");
  list.innerHTML = "";

  const selectedRound = state.data.rounds.find(
    round => round.id === state.selectedLeaderboardRoundId
  );
  const roundsForStandings = getLeaderboardRounds();
  const roundLabel = selectedRound ? `after ${selectedRound.name}` : "before the season starts";

  $("#leaderboardHeading").textContent = "2027 Championship";
  $("#leagueTableRound").textContent = selectedRound
    ? `Round ${selectedRound.number}`
    : "Awaiting Round 1";

  $("#leaderboardContext").innerHTML = selectedRound
    ? `<strong>${escapeHtml(selectedRound.name)} standings</strong><span>Your five highest round scores count. From Round 6 onwards, a better score automatically replaces your lowest counting score. Tap a player for their full history.</span>`
    : `<strong>No completed rounds yet</strong><span>The leaderboard will appear after scores are calculated and saved.</span>`;

  if (!selectedRound) {
    list.innerHTML = `<div class="preseason-empty"><span aria-hidden="true">🏌️</span><strong>No standings yet</strong><p>The League Table will appear after Round 1 has been completed.</p></div>`;
    $("#statusMessage").textContent = "";
    return;
  }

  const eligiblePlayers = state.data.players.filter(player =>
    !selectedRound || Number(player.fromRound || 1) <= Number(selectedRound.number)
  );
  const allRanked = rankPlayers(eligiblePlayers, roundsForStandings, state.data.achievements);
  const ranked = allRanked.filter(player => player.name.toLowerCase().includes(state.search));
  const previousRanked = rankPlayers(
    state.data.players,
    roundsForStandings.slice(0, -1),
    state.data.achievements
  );
  const previousPositions = new Map(previousRanked.map(player => [player.id, player.position]));
  const animationSignature = `${selectedRound?.id || "preseason"}:${allRanked
    .map(player => `${player.id}-${player.position}-${player.statistics.seasonPoints}`)
    .join("|")}`;
  let playFilm = false;
  try {
    const animationKey = "bgs-leaderboard-film-seen";
    playFilm = playFilm && localStorage.getItem(animationKey) !== animationSignature;
    if (playFilm) localStorage.setItem(animationKey, animationSignature);
  } catch {
    playFilm = false;
  }
  list.classList.toggle("leaderboard-cinematic", playFilm);

  ranked.forEach((player, playerIndex) => {
    const node = $("#leaderboardCardTemplate").content.cloneNode(true);
    const card = node.querySelector(".player-card");
    const summary = node.querySelector(".player-card-summary");
    const detail = node.querySelector(".player-details");
    const selectedResult = selectedRound?.results.find(result => result.playerId === player.id);
    const previousPosition = previousPositions.get(player.id) ?? allRanked.length + 1;
    const positionChange = previousPosition - player.position;
    if (player.position <= 3 && !state.search) {
      card.classList.add("top-three-row", `top-position-${player.position}`);
    }
    if (player.id === state.currentUserId) card.classList.add("is-current-player");
    if (playFilm) {
      card.classList.add("ranking-motion");
      card.style.setProperty("--move-from", `${positionChange * 64}px`);
      card.style.setProperty("--move-delay", `${0.25 + Math.min(playerIndex, 12) * 0.065}s`);
      if (positionChange > 0) card.classList.add("moved-up");
      if (positionChange < 0) card.classList.add("moved-down");
    }

    node.querySelector(".rank-badge").textContent = player.position;
    node.querySelector(".player-position-label").textContent = player.position;
    node.querySelector(".player-name").textContent = player.name;
    const initials = player.name.split(/\s+/).filter(Boolean).slice(0,2).map(part => part[0]).join("").toUpperCase();
    node.querySelector(".leaderboard-initials").textContent = initials || "BG";
    const avatar = node.querySelector(".leaderboard-avatar img");
    avatar.dataset.playerPhoto=player.id;avatar.loading="lazy";avatar.decoding="async";
    if (player.photoUrl) {
      avatar.src = player.photoUrl;
      avatar.alt = `${player.name} profile picture`;
      avatar.hidden = false;
      avatar.addEventListener("error", () => { avatar.hidden = true; }, { once: true });
    }
    node.querySelector(".round-handicap strong").textContent = selectedResult && !selectedResult.dnp ? selectedResult.handicapUsed : "—";
    node.querySelector(".round-points strong").textContent = selectedResult ? (selectedResult.dnp ? "DNP" : selectedResult.points) : "—";
    node.querySelector(".next-handicap strong").textContent = selectedResult && !selectedResult.dnp ? selectedResult.nextHandicap : "—";
    const adjustment = node.querySelector(".next-handicap em");
    adjustment.textContent = selectedResult && !selectedResult.dnp ? formatChange(selectedResult.adjustment) : "";
    adjustment.className = selectedResult ? changeClass(selectedResult.adjustment) : "same";
    node.querySelector(".rounds-played strong").textContent = `${player.statistics.roundsPlayed}/${SEASON_ROUNDS}`;

    node.querySelector(".player-points").textContent = player.statistics.seasonPoints;

    summary.setAttribute(
      "aria-label",
      `${player.name}, position ${player.position}, ${player.statistics.seasonPoints} points, ${roundLabel}`
    );

    summary.addEventListener("click", () => {
      const open = card.classList.toggle("is-open");
      summary.setAttribute("aria-expanded", String(open));
      detail.hidden = !open;
      if (open && !detail.dataset.rendered) {
        detail.innerHTML = playerDetailsMarkup(player, roundsForStandings);
        detail.dataset.rendered = "true";
      }
    });
    list.append(node);
  });

  $("#statusMessage").textContent = ranked.length ? "" : "No players match that search.";
  if (playFilm) {
    window.clearTimeout(window.cinematicCleanupTimer);
    window.cinematicCleanupTimer = window.setTimeout(() => {
      list.classList.remove("leaderboard-cinematic");
      list.querySelectorAll(".ranking-motion").forEach(card => {
        card.classList.remove("ranking-motion");
        card.style.removeProperty("--move-from");
        card.style.removeProperty("--move-delay");
      });
    }, 3900);
  }
}

function playerDetailsMarkup(player, roundsForStandings = state.data.rounds) {
  const s = player.statistics;
  const history = roundsForStandings.map(round => {
    const result = round.results.find(item => item.playerId === player.id);
    return { round, result };
  }).filter(item => item.result);
  let running = 0;
  return `
    <div class="detail-stats">
      ${statTile("Current handicap", s.currentHandicap)}
      ${statTile("Average score", s.average == null ? "—" : s.average.toFixed(1))}
      ${statTile("Best round", s.best ?? "—")}
      ${statTile("Season points", s.seasonPoints)}
    </div>
    <div class="history-list">
      ${history.map(({round,result}) => {
        if (Number.isFinite(result.points)) running += result.points;
        const seasonAtPoint = history
          .slice(0, history.findIndex(x => x.round.id === round.id) + 1)
          .map(x => x.result.points).filter(Number.isFinite).sort((a,b)=>b-a).slice(0,5).reduce((a,b)=>a+b,0);
        return `<article class="history-card">
          <div>
            <h4>${escapeHtml(round.name)}</h4>
            <p>Handicap used: <strong>${result.handicapUsed}</strong></p>
            <p>${result.dnp ? "Did not play" : `Stableford score: <strong>${result.points}</strong>`}</p>
          </div>
          <div class="history-values">
            <span class="history-label">Adjustment</span>
            <strong class="change ${changeClass(result.adjustment)}">${formatChange(result.adjustment)}</strong>
          </div>
          <div>
            <span class="history-label">Next-round handicap</span>
            <strong class="next-handicap-value">${result.nextHandicap}</strong>
          </div>
          <div class="history-values">
            <span class="history-label">Running season total</span>
            <strong>${seasonAtPoint}</strong>
          </div>
        </article>`;
      }).join("") || "<p>No rounds recorded.</p>"}
    </div>`;
}

function statTile(label,value){ return `<div class="stat-tile"><span>${label}</span><strong>${value}</strong></div>`; }
function changeClass(value){ return value == null || value === 0 ? "same" : value > 0 ? "up" : "down"; }

function renderRoundTabs() {
  const tabs = $("#roundTabs"); tabs.innerHTML = "";
  state.data.rounds.forEach(round => {
    const button = document.createElement("button");
    button.className = "round-tab";
    button.type = "button";
    button.role = "tab";
    button.textContent = round.name;
    button.setAttribute("aria-selected", String(round.id === state.selectedRoundId));
    button.addEventListener("click", () => { state.selectedRoundId = round.id; renderRoundTabs(); renderRound(); });
    tabs.append(button);
  });
}

function renderRound() {
  const round = state.data.rounds.find(r => r.id === state.selectedRoundId);
  const list = $("#roundList"); list.innerHTML = "";
  if (!round) { $("#roundSummary").innerHTML = "<strong>No rounds created</strong>"; return; }
  const played = round.results.filter(result => Number.isFinite(result.points));
  const winner = [...played].sort((a,b)=>b.points-a.points)[0];
  const winnerName = state.data.players.find(p => p.id === winner?.playerId)?.name ?? "Not recorded";
  $("#roundSummary").innerHTML = `<strong>${escapeHtml(round.name)}</strong><br>${round.date || "Date not set"} · Winner: ${escapeHtml(winnerName)}`;

  [...round.results].sort((a,b)=>(b.points ?? -1)-(a.points ?? -1)).forEach(result => {
    const player = state.data.players.find(p => p.id === result.playerId);
    if (!player || !player.name.toLowerCase().includes(state.search)) return;
    const row = document.createElement("article"); row.className = "round-row";
    row.innerHTML = `<div><h4>${escapeHtml(player.name)}</h4><div class="metric-line">
      <span>HCP <strong>${result.handicapUsed}</strong></span><span>Points <strong>${result.dnp ? "DNP" : result.points}</strong></span>
      <span>Adjustment <strong class="change ${changeClass(result.adjustment)}">${formatChange(result.adjustment)}</strong></span>
      <span>Next HCP <strong>${result.nextHandicap}</strong></span></div></div>`;
    list.append(row);
  });
}

function renderPlayerSelects() {
  const select = $("#handicapPlayerSelect");
  const current = state.selectedPlayerId;
  select.innerHTML = state.data.players.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  select.value = current || state.data.players[0]?.id || "";
}

function renderHandicapHistory() {
  const player = state.data.players.find(p => p.id === state.selectedPlayerId);
  const timeline = $("#handicapTimeline");
  if (!player) { $("#handicapChart").innerHTML = ""; timeline.innerHTML = ""; return; }
  const points = [{ label:"Start", value:player.startingHandicap }];
  state.data.rounds.forEach(round => {
    const result = round.results.find(r => r.playerId === player.id);
    if (result) points.push({ label:round.name, value:result.nextHandicap, result });
  });
  $("#handicapChart").innerHTML = createChart(points);
  timeline.innerHTML = points.slice(1).map(point => `<div class="timeline-row"><span>${escapeHtml(point.label)}</span><strong>${point.value}</strong></div>`).join("");
}

function createChart(points) {
  if (points.length < 2) return "<p>More round data is needed to draw the graph.</p>";
  const width=700,height=270,pad=42, values=points.map(p=>p.value), min=Math.min(...values)-1,max=Math.max(...values)+1;
  const x=i=>pad+(i*(width-pad*2)/(points.length-1));
  const y=v=>height-pad-((v-min)/(max-min||1))*(height-pad*2);
  const poly=points.map((p,i)=>`${x(i)},${y(p.value)}`).join(" ");
  const grid=[0,.25,.5,.75,1].map(t=>`<line class="chart-grid" x1="${pad}" y1="${pad+t*(height-pad*2)}" x2="${width-pad}" y2="${pad+t*(height-pad*2)}"/>`).join("");
  const dots=points.map((p,i)=>`<circle class="chart-point" cx="${x(i)}" cy="${y(p.value)}" r="6"><title>${p.label}: ${p.value}</title></circle><text class="chart-label" x="${x(i)}" y="${height-12}" text-anchor="middle">${escapeHtml(p.label.replace("Round ","R"))}</text>`).join("");
  return `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true">${grid}<polyline class="chart-line" points="${poly}"/>${dots}</svg>`;
}

function renderStatistics() {
  const grid=$("#statisticsGrid"); grid.innerHTML="";
  rankPlayers(state.data.players,state.data.rounds,state.data.achievements)
    .filter(p=>p.name.toLowerCase().includes(state.search))
    .forEach(player=>{
      const s=calculatePlayerStatistics(player,state.data.rounds,state.data.achievements);
      const card=document.createElement("article"); card.className="stat-card";
      card.innerHTML=`<h4>${escapeHtml(player.name)}</h4><div class="stat-card-grid">
        ${statTile("Current HCP",s.currentHandicap)}${statTile("Average",s.average==null?"—":s.average.toFixed(1))}
        ${statTile("Best",s.best??"—")}${statTile("Worst",s.worst??"—")}
        ${statTile("Rounds",s.roundsPlayed)}${statTile("Wins",s.wins)}
        ${statTile("Runner-up",s.runnerUps)}${statTile("Third",s.thirds)}
        ${statTile("Nearest Pin",s.nearestPin)}${statTile("Longest Drive",s.longestDrive)}
        ${statTile("Season points",s.seasonPoints)}
      </div>`;
      grid.append(card);
    });
}

function setView(name) {
  if(!["leaderboard","rounds","handicaps","statistics"].includes(name))name="leaderboard";
  state.activeView=name;
  const url=new URL(location.href);url.searchParams.set("view",name);history.replaceState(null,"",url);
  $$(".nav-tab").forEach(b=>{b.classList.toggle("is-active",b.dataset.view===name);b.setAttribute("aria-pressed",String(b.dataset.view===name));});
  $$(".view").forEach(v=>{const active=v.id===`${name}View`;v.hidden=!active;v.classList.toggle("is-active",active)});
  if(!state.data)document.querySelectorAll('.view a[href*="account.html"]').forEach(link=>link.href=window.BarfordMemberFlow.loginUrl(location.href));
  const titles={leaderboard:["Leaderboard","Best five rounds count towards the season total."],rounds:["Rounds","Every player, handicap and adjustment in a phone-friendly view."],handicaps:["Handicap History","See how handicaps move throughout the season."],statistics:["Statistics","Performance summaries for every member."]};
  const heroTitle=$("#heroTitle"),heroSubtitle=$("#heroSubtitle");
  if(heroTitle)heroTitle.textContent=titles[name][0];
  if(heroSubtitle)heroSubtitle.textContent=titles[name][1];
  if(state.data){if(name==="handicaps")renderHandicapHistory();if(name==="statistics")renderStatistics();}
}

function escapeHtml(value=""){return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

$$(".nav-tab").forEach(button=>button.addEventListener("click",()=>{setView(button.dataset.view);$("#scoresNav").classList.remove("is-open")}));
const scoresMenuButton = $("#scoresMenuButton");
if (scoresMenuButton) {
  scoresMenuButton.addEventListener("click", () => {
    const open = $("#scoresNav").classList.toggle("is-open");
    scoresMenuButton.setAttribute("aria-expanded", String(open));
  });
}
$("#playerSearch").addEventListener("input",event=>{state.search=event.target.value.trim().toLowerCase();renderLeaderboard();renderRound();if(state.activeView==="statistics")renderStatistics()});
$("#handicapPlayerSelect").addEventListener("change",event=>{state.selectedPlayerId=event.target.value;renderHandicapHistory()});
window.addEventListener("scores:photos-ready",event=>{
  if(event.detail.userId!==state.currentUserId||!state.data)return;
  const photos=new Map(event.detail.photos.map(photo=>[photo.id,photo.url]));
  state.data.players.forEach(player=>{player.photoUrl=photos.get(player.id)||null;});
  document.querySelectorAll('[data-player-photo]').forEach(avatar=>{
    const url=photos.get(avatar.dataset.playerPhoto);if(!url)return;
    avatar.src=url;avatar.hidden=false;avatar.addEventListener("error",()=>{avatar.hidden=true;},{once:true});
  });
});
window.addEventListener("scores:data-changed",refresh);



refresh().catch(()=>{$$('.view').forEach(view=>{view.innerHTML='<article class="simple-card" role="status"><h2>Results could not be loaded</h2><p>Please try again to see the latest scores.</p><button class="button button-primary" data-retry-results>Reload results</button></article>';view.querySelector('[data-retry-results]').onclick=()=>location.reload();});});
