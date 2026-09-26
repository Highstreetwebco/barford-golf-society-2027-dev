import { rulesHTML } from "./league-rules.js?v=2027-results-1";
import { rankPlayers, metricsHTML } from "./league-view.js?v=2027-results-1";
const b = await window.barfordReady,
  e = b.escape,
  area = document.getElementById("leagueBoard"),
  select = document.getElementById("leagueRound"),
  target = document.getElementById("roundResults");
document.getElementById("leagueRules").innerHTML = rulesHTML;
async function load() {
  const { data, error } = await b.client.rpc("league_board");
  if (error) {
    area.innerHTML = b.empty("Scores could not load.", error.message);
    target.innerHTML = "";
    return;
  }
  const cutoff = data.visible_rounds;
  document.getElementById("leagueVisibility").textContent =
    cutoff === 7
      ? "Admin view · All seven rounds visible."
      : "Rounds 6 and 7 are secret. Totals and wins only include published rounds 1–5.";
  const latest = Math.max(
    0,
    ...data.rounds.filter((r) => r.round <= cutoff).map((r) => r.round),
  );
  const old = select.value;
  select.innerHTML = Array.from(
    { length: 7 },
    (_, i) =>
      `<option value="${i + 1}">Round ${i + 1}${i >= cutoff ? " · secret" : ""}</option>`,
  ).join("");
  select.value = old || String(latest || 1);
  select.onchange = () => {
    const n = Number(select.value),
      round = data.rounds.find((r) => r.round === n && r.round <= cutoff),
      ranked = rankPlayers(data, n);
    area.innerHTML = `<h2>Season leaderboard</h2><p class="muted">Best five scores count. Choose a round to see the standings and handicaps at that point in the season.</p>${cutoff < 7 ? '<div class="secret-rounds"><span>Round 6 <span class="secret-score" aria-label="Secret — admins only"><span aria-hidden="true">•••</span></span></span><span>Round 7 <span class="secret-score" aria-label="Secret — admins only"><span aria-hidden="true">•••</span></span></span></div>' : ""}`;
    if (n > cutoff) {
      target.innerHTML =
        '<p class="notice">🔒 Round ' +
        n +
        " is secret. Only admins can see these results.</p>";
      return;
    }
    if (!round) {
      target.innerHTML = b.empty(
        "This round has not been published yet.",
        "Results appear here once the organiser completes the round.",
      );
      return;
    }
    target.innerHTML = `<div class="section-heading"><div><p class="eyebrow">STANDINGS AFTER ROUND ${n}</p><h2>Round ${n} results</h2></div><p class="muted">Round average: ${e(round.average)} points</p></div><div class="standings-list">${ranked
      .map((p) => {
        const s = p.scores.find((s) => s.round === n);
        return `<article class="standing-card ${p.id === b.state.user?.id ? "is-you" : ""}" aria-label="${e(p.name)} round ${n}"><div class="standing-heading"><span class="rank-number">${p.rank}</span><div><h3>${e(p.name)}${p.id === b.state.user?.id ? " <small>(you)</small>" : ""}</h3><p>${s?.winner ? "Round winner · " : ""}${p.played} played · ${p.wins} wins</p></div><div class="standing-total"><strong data-total>${p.total}</strong><small>League pts</small></div></div>${metricsHTML(s, e)}</article>`;
      })
      .join("")}</div>`;
  };
  select.onchange();
}
document.getElementById("refreshLeague").onclick = load;
await load();
