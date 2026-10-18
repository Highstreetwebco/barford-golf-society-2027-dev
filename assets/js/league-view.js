export function rankPlayers(data, through = 7) {
  if (!data || !Array.isArray(data.rounds) || !Array.isArray(data.players))
    throw new Error("The score data is incomplete. Please refresh the leaderboard.");
  // Only published, visible rounds may contribute to any displayed statistic.
  // A missing visibility limit fails closed to the member view.
  const visible = Number.isInteger(data.visible_rounds)
    ? Math.max(0, Math.min(7, data.visible_rounds)) : 5;
  const cutoff = Math.min(visible, Number.isInteger(through) ? through : 5);
  const rounds = data.rounds.filter((r) =>
    Number.isInteger(r.round) && r.round >= 1 && r.round <= cutoff,
  ).sort((a, b) => a.round - b.round);
  if (new Set(rounds.map((r) => r.round)).size !== rounds.length ||
      new Set(data.players.map((p) => p.id)).size !== data.players.length)
    throw new Error("Duplicate score records were found. Please ask an admin to check this round.");
  for (const round of rounds) {
    if (!Array.isArray(round.results) ||
        new Set(round.results.map((s) => s.user_id)).size !== round.results.length)
      throw new Error("A round contains duplicate or incomplete results. Please ask an admin to check it.");
    for (const result of round.results) {
      if (result.points != null &&
          (!Number.isInteger(result.points) || result.points < 0 || result.points > 108))
        throw new Error("A round contains an invalid score. Please ask an admin to check it.");
    }
  }
  const list = data.players
    .map((p) => {
      const scores = rounds.flatMap((r) =>
        (r.results || [])
          .filter((s) => s.user_id === p.id)
          .map((s) => ({ ...s, round: r.round })),
      );
      const played = scores.filter((s) => s.points != null);
      const best = [...played].sort((a, b) => b.points - a.points || a.round - b.round).slice(0, 5);
      const countedRounds = new Set(best.map((s) => s.round));
      return {
        ...p,
        scores: scores.map((s) => ({ ...s, counted: s.points != null && countedRounds.has(s.round) })),
        total: best.reduce((sum, s) => sum + s.points, 0),
        wins: played.filter((s) => s.winner === true).length,
        played: played.length,
        counted: best.map((s) => s.points),
        dropped: played.filter((s) => !countedRounds.has(s.round)).map((s) => s.points),
      };
    })
    .sort(
      (a, b) =>
        b.total - a.total || b.wins - a.wins || a.name.localeCompare(b.name),
    );
  let rank = 0;
  return list.map((p, i) => {
    if (!i || p.total !== list[i - 1].total || p.wins !== list[i - 1].wins)
      rank = i + 1;
    return { ...p, rank };
  });
}
export function changeValue(s) {
  if (s?.handicap == null || s?.next_handicap == null)
    return s?.adjustment ?? null;
  return Math.round((Number(s.next_handicap) - Number(s.handicap)) * 10) / 10;
}
export function signed(n) {
  return n == null ? "—" : n > 0 ? "+" + n : String(n);
}
export function metricsHTML(s, e) {
  const value = (n) => (n == null ? "Not set" : e(n));
  return `<dl class="round-metrics"><div><dt>Round HCP</dt><dd>${value(s?.handicap)}</dd></div><div><dt>Round score</dt><dd>${s ? (s.points == null ? "DNP" : e(s.points) + "<small> pts</small>") : "—"}</dd></div><div><dt>HCP change</dt><dd>${e(signed(changeValue(s)))}</dd></div><div><dt>Next HCP</dt><dd>${value(s?.next_handicap)}</dd></div></dl>${s?.committee_adjusted ? '<p class="metric-note">Includes a committee handicap adjustment.</p>' : ""}`;
}
export async function mountPersonalResults(area, b) {
  if (!b.state.user) {
    area.hidden = true;
    return;
  }
  const { data, error } = await b.client.rpc("league_board");
  area.hidden = false;
  if (error) {
    area.innerHTML =
      '<h2>Your season</h2><p>Results could not load. <a href="scores.html">View the leaderboard</a></p>';
    return;
  }
  const latest = Math.max(
    0,
    ...data.rounds
      .filter((r) => r.round <= data.visible_rounds)
      .map((r) => r.round),
  );
  const ranked = rankPlayers(data, latest),
    me = ranked.find((p) => p.id === b.state.user.id),
    e = b.escape;
  if (!me || !latest) {
    area.hidden = true;
    return;
  }
  const result = me.scores.find((s) => s.round === latest);
  const best = Math.max(0, ...me.scores.map((s) => s.points || 0));
  const round = data.rounds.find((r) => r.round === latest);
  const published = Date.parse(round?.published_at || "");
  const fresh = Number.isFinite(published) && Date.now() >= published && Date.now() - published < 48 * 60 * 60 * 1000;
  if (fresh) {
    const players = ranked.map((p) => ({ player: p, score: p.scores.find((s) => s.round === latest) }))
      .sort((a, b) => (b.score?.points ?? -1) - (a.score?.points ?? -1) || a.player.name.localeCompare(b.player.name));
    area.classList.add("home-round-review");
    document.getElementById("nextEvent")?.closest("section")?.before(area);
    area.innerHTML = `<div class="section-heading"><div><p class="eyebrow">ROUND ${latest} · RESULTS PUBLISHED</p><h2>Your round review</h2></div><a href="scores.html">Full leaderboard →</a></div><div class="personal-highlights"><div><small>Your score</small><strong>${result?.points == null ? "DNP" : e(result.points) + "<small> pts</small>"}</strong></div><div><small>League position</small><strong>${me.rank}<small> / ${ranked.length}</small></strong></div><div><small>Best-five total</small><strong>${me.total}<small> pts</small></strong></div></div>${metricsHTML(result, e)}${result?.winner ? '<p class="metric-note"><strong>You won this round.</strong></p>' : ""}<div class="round-review-field"><div class="section-heading"><h3>Everyone’s round</h3><p class="muted">Round average: ${e(round.average ?? "—")} pts</p></div><ol class="round-review-list">${players.map(({ player, score }) => `<li class="${player.id === b.state.user.id ? "is-you" : ""}"><span><strong>${e(player.name)}${player.id === b.state.user.id ? " (you)" : ""}</strong>${score?.winner ? " <small>Winner</small>" : ""}</span><span>${score?.points == null ? "DNP" : e(score.points) + " pts"}</span></li>`).join("")}</ol></div>${data.visible_rounds < 7 ? '<p class="muted">Rounds 6 and 7 remain secret to members.</p>' : ""}`;
    return;
  }
  area.classList.remove("home-round-review");
  document.getElementById("nextEvent")?.closest("section")?.after(area);
  area.innerHTML = `<div class="section-heading"><div><p class="eyebrow">YOUR LATEST RESULTS · ROUND ${latest}</p><h2>${result?.winner ? "Round winner. Well played." : "Your season so far."}</h2></div><a href="scores.html">Full leaderboard →</a></div><div class="personal-highlights"><div><small>League position</small><strong>${me.rank}${ranked.filter((p) => p.rank === me.rank).length > 1 ? " equal" : ""}<small> / ${ranked.length}</small></strong></div><div><small>Best-five total</small><strong>${me.total}<small> pts</small></strong></div><div><small>Rounds played</small><strong>${me.played}<small> / ${latest}</small></strong></div></div>${metricsHTML(result, e)}<p class="metric-note">Best round: ${best ? best + " points" : "not played yet"} · ${me.total === ranked[0].total ? "Level with the leading points total" : ranked[0].total - me.total + " points behind the leader"}.</p>${data.visible_rounds < 7 ? '<p class="muted">Member standings and summaries include published rounds 1–5 only. Rounds 6 and 7 stay secret.</p>' : '<p class="muted">Admin view: includes published secret rounds.</p>'}`;
}
