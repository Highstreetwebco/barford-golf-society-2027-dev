import { rulesHTML } from "./league-rules.js?v=2027-simple-1";
import { rankPlayers, signed, changeValue } from "./league-view.js?v=2027-simple-1";

const b = await window.barfordReady;
const e = b.escape;
const area = document.getElementById("leagueBoard");
const select = document.getElementById("leagueRound");
const target = document.getElementById("roundResults");
const refresh = document.getElementById("refreshLeague");
const visibility = document.getElementById("leagueVisibility");
const roundDetails = document.getElementById("roundDetails");
let request = 0;
document.getElementById("leagueRules").innerHTML = rulesHTML;

function lockedRound(n) {
  return `<span class="locked-score" aria-label="Round ${n}: hidden, admins only"><span class="locked-dots" aria-hidden="true">•••</span><span class="lock-mark" aria-hidden="true">⌑</span></span>`;
}

function scoreCell(player, round, visible, published) {
  if (round > visible) return `<td class="is-locked">${lockedRound(round)}</td>`;
  if (!published.has(round)) return '<td class="not-played"><span aria-label="Not published">—</span></td>';
  const result = player.scores.find((s) => s.round === round);
  if (result?.points == null) return '<td class="not-played"><abbr title="Did not play">DNP</abbr></td>';
  const label = `Round ${round}: ${result.points} points${result.counted ? ", counted" : ", dropped"}${result.winner ? ", round winner" : ""}`;
  return `<td class="${result.counted ? "counted-score" : "dropped-score"}"><span aria-label="${e(label)}">${e(result.points)}${result.winner ? '<span class="round-win" aria-hidden="true">★</span>' : ""}</span></td>`;
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
  target.innerHTML = `<p class="round-summary">Round average: <strong>${e(round.average ?? "—")} points</strong></p><div class="table-scroll score-scroll" tabindex="0" role="region" aria-label="Round ${n} results"><table class="simple-score-table round-detail-table"><caption class="sr-only">Round ${n} scores and handicaps</caption><thead><tr><th scope="col">Player</th><th scope="col">Points</th><th scope="col">Round HCP</th><th scope="col">Change</th><th scope="col">Next HCP</th></tr></thead><tbody>${rows.map((p) => `<tr class="${p.id === b.state.user?.id ? "is-you" : ""}"><th scope="row">${e(p.name)}${p.result?.winner ? '<span class="winner-label">Winner</span>' : ""}</th><td><strong>${p.result?.points == null ? "DNP" : e(p.result.points)}</strong></td><td>${e(p.result?.handicap ?? "—")}</td><td>${e(signed(changeValue(p.result)))}</td><td>${e(p.result?.next_handicap ?? "—")}</td></tr>`).join("")}</tbody></table></div>`;
}

async function load() {
  const id = ++request;
  refresh.disabled = true;
  refresh.textContent = "Refreshing…";
  area.textContent = "Loading scores…";
  document.getElementById("standingsStatus").textContent = "Published results";
  area.setAttribute("aria-busy", "true");
  target.innerHTML = "";
  roundDetails.hidden = true;
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
    const data = { ...result, visible_rounds: cutoff,
      rounds: result?.rounds?.filter((r) => r.round <= cutoff) };
    const ranked = rankPlayers(data);
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
    document.getElementById("standingsStatus").textContent = `Standings after round ${through}`;
    area.innerHTML = `<div class="table-scroll score-scroll" tabindex="0" role="region" aria-label="Season leaderboard. Scroll sideways for every round."><table class="simple-score-table season-table"><caption class="sr-only">2027 Order of Merit. The best five published scores count.</caption><thead><tr><th scope="col" class="position-col">Pos</th><th scope="col" class="player-col">Player</th><th scope="col" class="total-col">Total</th>${Array.from({length:7}, (_, i) => `<th scope="col" class="${i + 1 > cutoff ? "is-locked" : ""}"><abbr title="Round ${i + 1}">R${i + 1}</abbr></th>`).join("")}<th scope="col">Played</th></tr></thead><tbody>${ranked.map((p) => `<tr class="${p.id === b.state.user?.id ? "is-you" : ""}"><td class="position-col">${p.rank}</td><th scope="row" class="player-col">${e(p.name)}${p.id === b.state.user?.id ? '<small class="you-label">You</small>' : ""}</th><td class="total-col"><strong>${p.total}</strong></td>${Array.from({length:7}, (_, i) => scoreCell(p, i + 1, cutoff, published)).join("")}<td>${p.played}</td></tr>`).join("")}</tbody></table></div><div class="score-key"><span><strong>Bold scores</strong> count</span><span><s>Crossed-out scores</s> are dropped</span><span>★ Round winner</span><span>DNP · Did not play</span></div><p class="table-mobile-hint">Swipe across the table to see all seven rounds.</p>`;
    const old = select.value;
    select.innerHTML = Array.from({length:7}, (_, i) => `<option value="${i + 1}">Round ${i + 1}${i + 1 > cutoff ? " · hidden" : !published.has(i + 1) ? " · not completed" : ""}</option>`).join("");
    select.value = old || String(through);
    select.onchange = () => showRound(data, ranked);
    showRound(data, ranked);
    roundDetails.hidden = false;
  } catch (error) {
    if (id !== request) return;
    visibility.textContent = "The leaderboard is unavailable. Your saved results have not changed.";
    area.innerHTML = b.empty("Scores could not load.", error.message || "Please try Refresh again.");
    target.innerHTML = "";
  } finally {
    if (id === request) {
      refresh.disabled = false;
      refresh.textContent = "Refresh";
      area.removeAttribute("aria-busy");
    }
  }
}

refresh.onclick = load;
window.addEventListener("barford-signout", () => {
  area.innerHTML = "Loading member standings…";
  target.innerHTML = "";
  load();
});
await load();
