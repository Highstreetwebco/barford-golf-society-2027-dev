import { rulesHTML } from "./league-rules.js?v=2027-operations-1";
const b = await window.barfordReady,
  e = b.escape;
const area = document.getElementById("leagueBoard");
const secret =
  '<span class="secret-score" aria-label="Secret — admins only"><span aria-hidden="true">•••</span></span>';
document.getElementById("leagueRules").innerHTML = rulesHTML;
async function load() {
  const { data, error } = await b.client.rpc("league_board");
  if (error) {
    area.innerHTML = b.empty("Scores could not load.", error.message);
    return;
  }
  const { players, rounds, visible_rounds: cutoff } = data;
  document.getElementById("leagueVisibility").textContent =
    cutoff === 7
      ? "Admin view · All seven rounds visible."
      : "Rounds 6 and 7 are secret. Totals and wins only include published rounds 1–5.";
  if (!players.length) {
    area.innerHTML = b.empty(
      "A fresh season.",
      "Registered players will appear here as accounts are created.",
    );
    return;
  }
  const ranked = players
    .map((p) => {
      const scores = rounds.flatMap((r) =>
        (r.results || [])
          .filter((s) => s.user_id === p.id)
          .map((s) => ({ ...s, round: r.round })),
      );
      const best = scores
        .filter((s) => s.points !== null)
        .map((s) => s.points)
        .sort((a, b) => b - a)
        .slice(0, 5);
      return {
        ...p,
        scores,
        total: best.reduce((a, b) => a + b, 0),
        wins: scores.filter((s) => s.winner).length,
      };
    })
    .sort(
      (a, b) =>
        b.total - a.total || b.wins - a.wins || a.name.localeCompare(b.name),
    );
  let rank = 0;
  area.innerHTML = `<h2>Season leaderboard</h2><p class="muted">Best five scores count. Scroll across for each round.</p><div class="table-scroll"><table class="league-table"><caption class="visually-hidden">2027 season leaderboard · best five scores</caption><thead><tr><th>Rank</th><th>Player</th><th>Best five</th><th>Wins</th>${Array.from({ length: 7 }, (_, i) => `<th>R${i + 1}${i >= cutoff ? " 🔒" : ""}</th>`).join("")}</tr></thead><tbody>${ranked
    .map((p, i) => {
      if (
        !i ||
        p.total !== ranked[i - 1].total ||
        p.wins !== ranked[i - 1].wins
      )
        rank = i + 1;
      return `<tr><td>${rank}</td><th scope="row">${e(p.name)}</th><td><strong>${p.total}</strong></td><td>${p.wins}</td>${Array.from(
        { length: 7 },
        (_, i) => {
          const s = p.scores.find((s) => s.round === i + 1);
          return `<td>${i >= cutoff ? secret : s ? (s.points ?? "DNP") : "—"}</td>`;
        },
      ).join("")}</tr>`;
    })
    .join("")}</tbody></table></div>`;
  const select = document.getElementById("leagueRound");
  const old = select.value;
  select.innerHTML = Array.from(
    { length: 7 },
    (_, i) =>
      `<option value="${i + 1}">Round ${i + 1}${i >= cutoff ? " · secret" : ""}</option>`,
  ).join("");
  select.value = old || String(rounds.at(-1)?.round || 1);
  select.onchange = () => {
    const n = Number(select.value),
      r = rounds.find((r) => r.round === n),
      target = document.getElementById("roundResults");
    if (n > cutoff) {
      target.innerHTML =
        '<p class="notice">🔒 Round ' +
        n +
        " is secret. Only admins can see these results.</p>";
      return;
    }
    if (!r) {
      target.innerHTML =
        '<p class="muted">This round has not been published yet.</p>';
      return;
    }
    target.innerHTML = `<p class="muted">Round average: ${r.average} points</p><div class="table-scroll"><table><thead><tr><th>Player</th><th>Round HCP</th><th>Points</th><th>Change</th><th>Next HCP</th></tr></thead><tbody>${ranked
      .map((p) => {
        const s = p.scores.find((s) => s.round === n);
        return s
          ? `<tr><th scope="row">${e(p.name)}${s.winner ? " 🏆" : ""}</th><td>${s.handicap ?? "Not set"}</td><td>${s.points ?? "DNP"}</td><td>${s.adjustment === null ? "—" : s.adjustment > 0 ? "+" + s.adjustment : s.adjustment}</td><td>${s.next_handicap ?? "Not set"}${s.committee_adjusted ? " (committee adjustment)" : ""}</td></tr>`
          : "";
      })
      .join("")}</tbody></table></div>`;
  };
  select.onchange();
}
document.getElementById("refreshLeague").onclick = load;
await load();
