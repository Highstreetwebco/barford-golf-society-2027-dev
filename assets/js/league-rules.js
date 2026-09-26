export function adjustment(points, average, handicap) {
  const d = points - average;
  const base =
    d >= 10
      ? -4
      : d >= 8
        ? -3
        : d >= 6
          ? -2
          : d >= 4
            ? -1
            : d >= 2
              ? -0.5
              : d >= -1
                ? 0
                : d >= -3
                  ? 0.5
                  : d >= -5
                    ? 1
                    : d >= -7
                      ? 2
                      : d >= -9
                        ? 3
                        : 4;
  return Math.max(
    -3,
    Math.min(
      2,
      Math.round(
        base *
          (handicap <= 9
            ? 0.5
            : handicap <= 18
              ? 0.75
              : handicap <= 28
                ? 1
                : 1.25),
      ),
    ),
  );
}
export function roundAverage(entries) {
  const points = entries
    .filter((x) => x.status === "played" && x.points > 0)
    .map((x) => x.points)
    .sort((a, b) => a - b);
  if (points.length < 4) return null;
  const trimmed = points.length > 4 ? points.slice(1, -1) : points;
  return Math.round(trimmed.reduce((a, b) => a + b, 0) / trimmed.length);
}
export function handicapAt(player, round, rounds) {
  let h = player.starting_handicap;
  for (const r of [...rounds].sort((a, b) => a.round_number - b.round_number)) {
    if (r.round_number >= round || !r.published_entries) continue;
    const result = r.results?.find((x) => x.user_id === player.id);
    if (result) h = result.next_handicap;
  }
  return h;
}
export const rulesHTML = `<details class="panel section league-rules"><summary>Scoring &amp; handicap rules</summary>
<p>Seven rounds; your best five Stableford scores count. Equal totals are ordered by number of round wins; players still level share a rank. A tied round winner is chosen by an organiser after countback.</p>
<p>At least four played scores are required. With five or more, remove one highest and one lowest score before averaging. Round the average to the nearest whole point. DNP (including a zero entered as DNP) does not count towards the average or change a handicap.</p>
<div class="table-scroll"><table><caption>Points compared with the round average</caption><thead><tr><th>Difference</th><th>Base adjustment</th></tr></thead><tbody>${[
  ["+10 or more", "−4"],
  ["+8 to +9", "−3"],
  ["+6 to +7", "−2"],
  ["+4 to +5", "−1"],
  ["+2 to +3", "−0.5"],
  ["−1 to +1", "0"],
  ["−3 to −2", "+0.5"],
  ["−5 to −4", "+1"],
  ["−7 to −6", "+2"],
  ["−9 to −8", "+3"],
  ["−10 or less", "+4"],
]
  .map(([d, a]) => `<tr><td>${d}</td><td>${a}</td></tr>`)
  .join("")}</tbody></table></div>
<p>Multiply by the player’s round handicap band: up to 9 × 0.5; over 9 to 18 × 0.75; over 18 to 28 × 1; over 28 × 1.25. Round to a whole shot (half values towards positive infinity), then limit the change to −3 through +2. Handicaps cannot go below zero. There is no extra winner’s cut.</p>
<p>Rounds 6 and 7, and their effect on totals, wins and handicap history, remain private to admins. Starting handicap or score corrections recalculate all subsequent published rounds.</p></details>`;
