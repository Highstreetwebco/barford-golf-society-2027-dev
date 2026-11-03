import { rulesHTML } from "./league-rules.js?v=2027-simple-1";
import { rankPlayers, signed, changeValue } from "./league-view.js?v=2027-simple-1";
import { demonstrationBoard } from "./league-demo.js?v=2027-demo-1";

const b = await window.barfordReady;
const e = b.escape;
const area = document.getElementById("leagueBoard");
const select = document.getElementById("leagueRound");
const target = document.getElementById("roundResults");
const refresh = document.getElementById("refreshLeague");
const visibility = document.getElementById("leagueVisibility");
const roundDetails = document.getElementById("roundDetails");
const roundShortcut = document.getElementById("openRoundDetails");
const demoPanel = document.getElementById("leagueDemo");
const demoToggle = document.getElementById("toggleLeagueDemo");
let showDemo = true;
let request = 0;
document.getElementById("leagueRules").innerHTML = rulesHTML;

function lockedRound(n) {
  return `<span class="locked-score" role="img" aria-label="Round ${n}: hidden, admins only"><span class="locked-dots" aria-hidden="true">•••</span><svg class="lock-mark" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></span>`;
}

function roundTile(player, round, visible, published) {
  let style = "not-played", content = '<span aria-label="Not completed">—</span>';
  if (round > visible) { style = "is-locked"; content = lockedRound(round); }
  else if (published.has(round)) {
    const result = player.scores.find((s) => s.round === round);
    if (result?.points == null) content = '<abbr title="Did not play">DNP</abbr>';
    else {
      style = result.counted ? "counted-score" : "dropped-score";
      const label = `${result.points} points${result.counted ? ", counted" : ", dropped"}${result.winner ? ", round winner" : ""}`;
      content = `<span aria-label="${e(label)}">${e(result.points)}${result.winner ? '<span class="round-win" aria-hidden="true">★</span>' : ""}</span>`;
    }
  }
  return `<div class="round-score ${style}" data-round="${round}"><dt><span aria-hidden="true">R${round}</span><span class="sr-only">Round ${round}</span></dt><dd>${content}</dd></div>`;
}

function seasonHTML(ranked, cutoff, published, demo) {
  return `<div class="season-board"><div class="season-columns" aria-hidden="true"><span>Pos</span><span>Player</span><span>Total</span>${Array.from({length:7},(_,i)=>`<span>R${i+1}</span>`).join("")}<span>Played</span></div><ol class="season-list" role="list" aria-label="${demo ? "Demonstration · " : ""}2027 Order of Merit. Best five scores count.">${ranked.map((p) => `<li class="season-player ${p.id === b.state.user?.id ? "is-you" : ""}"><div class="player-summary"><span class="player-position"><span class="sr-only">Position </span>${p.rank}</span><h3 class="player-name">${e(p.name)}${p.id === b.state.user?.id ? '<small class="you-label">You</small>' : ""}</h3><div class="player-total"><span class="metric-label">Total</span><strong aria-label="${p.total} points">${p.total}</strong></div></div><dl class="player-rounds">${Array.from({length:7},(_,i)=>roundTile(p,i+1,cutoff,published)).join("")}</dl><p class="player-played"><strong>${p.played}</strong><span> rounds played</span></p></li>`).join("")}</ol></div><div class="score-key"><span><strong>Bold</strong> · counted</span><span><s>Crossed out</s> · dropped</span><span>★ Round winner</span><span>DNP · Did not play</span><span>— Not completed</span></div>`;
}

function showRound(data, ranked) {
  const n = Number(select.value);
  if (n > data.visible_rounds) {
    target.innerHTML = `<div class="round-locked"><strong>Round ${n} is hidden</strong><p>Only admins can view these scores. Members’ totals and positions stay at round 5.</p>${lockedRound(n)}</div>`;
    return;
  }
  const round = data.rounds.find((r) => r.round === n);
  if (!round) {
    target.innerHTML = b.empty("Results are not ready yet.", "They will appear after an admin completes the round.");
    return;
  }
  const rows = ranked.map((p) => ({ ...p, result: p.scores.find((s) => s.round === n) }))
    .sort((a, c) => (c.result?.points ?? -1) - (a.result?.points ?? -1) || a.name.localeCompare(c.name));
  target.innerHTML = `<p class="round-summary">${data.demo ? "Sample round average" : "Round average"}: <strong>${e(round.average ?? "—")} points</strong></p><ol class="round-result-list" role="list" aria-label="${data.demo ? "Demonstration · " : ""}Round ${n} scores and handicaps">${rows.map((p) => `<li class="round-result ${p.id === b.state.user?.id ? "is-you" : ""}"><div class="round-result-heading"><h3>${e(p.name)}${p.id === b.state.user?.id ? '<small class="you-label">You</small>' : ""}${p.result?.winner ? '<span class="winner-label">★ Round winner</span>' : ""}</h3><div class="round-points"><strong>${p.result?.points == null ? "DNP" : e(p.result.points)}</strong><span>points</span></div></div><dl class="round-handicaps"><div><dt>Round HCP</dt><dd>${e(p.result?.handicap ?? "—")}</dd></div><div><dt>Change</dt><dd>${e(signed(changeValue(p.result)))}</dd></div><div><dt>Next HCP</dt><dd>${e(p.result?.next_handicap ?? "—")}</dd></div></dl></li>`).join("")}</ol>`;
}

async function load() {
  const id = ++request;
  refresh.disabled = true;
  demoToggle.disabled = true;
  demoPanel.hidden = true;
  refresh.textContent = "Refreshing…";
  area.textContent = "Loading scores…";
  document.getElementById("standingsStatus").textContent = "Published results";
  area.setAttribute("aria-busy", "true");
  target.innerHTML = "";
  roundDetails.hidden = true;
  roundShortcut.hidden = true;
  try {
    await b.refresh();
    const user = b.state.user?.id;
    const admin = b.state.admin;
    const { data: result, error } = await b.client.rpc("league_board");
    if (id !== request || user !== b.state.user?.id || admin !== b.state.admin) return;
    if (error) throw error;
    // Enforce the current viewer limit as well as the server's redaction.
    const limit = Number.isInteger(result?.visible_rounds) ? result.visible_rounds : 5;
    const cutoff = Math.max(0, Math.min(admin ? 7 : 5, limit));
    let data = { ...result, visible_rounds: cutoff,
      rounds: result?.rounds?.filter((r) => r.round <= cutoff) };
    let ranked = rankPlayers(data);
    // A failed score read never falls back to fictitious results. Any published
    // round takes priority, including one beyond the current viewer's cutoff.
    if (result.rounds.length === 0) {
      if (showDemo) {
        const { data: roster, error: rosterError } = await b.client.rpc("member_roster");
        if (id !== request || user !== b.state.user?.id || admin !== b.state.admin) return;
        if (rosterError) throw rosterError;
        data = demonstrationBoard(roster, result.players);
        ranked = rankPlayers(data);
      }
      demoPanel.hidden = false;
      document.getElementById("leagueDemoTitle").textContent = showDemo ? "Demonstration · 3 rounds" : "Try the three-round demonstration";
      document.getElementById("leagueDemoCopy").textContent = showDemo
        ? "Sample scores and handicaps using society member names. Real results will appear here when the season begins."
        : "See how the leaderboard will look with sample results from the member list.";
      demoToggle.textContent = showDemo ? "Show actual results" : "Show demonstration";
    }
    const published = new Set(data.rounds.map((r) => r.round));
    visibility.textContent = cutoff === 7
      ? "Admin view · All seven rounds count. Rounds 6 and 7 stay hidden from members."
      : "Rounds 6 and 7 are hidden. Member totals and positions use published rounds 1–5 only.";
    if (!ranked.length || !published.size) {
      area.innerHTML = b.empty("The season starts here.", "The leaderboard will appear when the first round is completed.") +
        (cutoff < 7 ? `<div class="season-locks"><span>Round 6 ${lockedRound(6)}</span><span>Round 7 ${lockedRound(7)}</span></div>` : "");
      return;
    }
    const through = Math.max(...published);
    document.getElementById("standingsStatus").textContent = `${data.demo ? "Demo · " : ""}Standings after round ${through}`;
    area.innerHTML = seasonHTML(ranked, cutoff, published, data.demo);
    const old = select.value;
    select.innerHTML = Array.from({length:7}, (_, i) => `<option value="${i + 1}">Round ${i + 1}${i + 1 > cutoff ? " · hidden" : !published.has(i + 1) ? " · not completed" : ""}</option>`).join("");
    select.value = published.has(Number(old)) || Number(old) > cutoff ? old : String(through);
    select.onchange = () => showRound(data, ranked);
    showRound(data, ranked);
    roundDetails.hidden = false;
    roundShortcut.hidden = false;
  } catch (error) {
    if (id !== request) return;
    visibility.textContent = "The leaderboard is unavailable. Your saved results have not changed.";
    area.innerHTML = b.empty("Scores could not load.", error.message || "Please try Refresh again.");
    target.innerHTML = "";
  } finally {
    if (id === request) {
      refresh.disabled = false;
      demoToggle.disabled = false;
      refresh.textContent = "Refresh";
      area.removeAttribute("aria-busy");
    }
  }
}

roundShortcut.onclick = (event) => {
  event.preventDefault();
  if (roundDetails.hidden) return;
  roundDetails.open = true;
  roundDetails.querySelector("summary").focus({preventScroll:true});
  roundDetails.scrollIntoView({block:"start"});
};
refresh.onclick = load;
demoToggle.onclick = () => { showDemo = !showDemo; select.value = ""; load(); };
window.addEventListener("barford-signout", () => {
  area.innerHTML = "Loading member standings…";
  target.innerHTML = "";
  load();
});
await load();
