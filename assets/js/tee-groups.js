// Keep buggy partners together; tee preferences are best-effort around these pairs.
export function packPlayers(players) {
  const rank = (p) => ({ First: 0, Middle: 1, End: 2 })[p.preferred_time] ?? 1;
  const ordered = [...players].sort(
    (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name),
  );
  const buggy = ordered.filter((p) => p.buggy);
  const units = ordered.filter((p) => !p.buggy).map((p) => [p]);
  for (let i = 0; i < buggy.length; i += 2) units.push(buggy.slice(i, i + 2));
  const mean = (unit) => unit.reduce((n, p) => n + rank(p), 0) / unit.length;
  units.sort(
    (a, b) =>
      mean(a) - mean(b) ||
      b.length - a.length ||
      a[0].name.localeCompare(b[0].name),
  );
  const groups = [];
  for (const unit of units) {
    let group = groups.find((g) => g.length + unit.length <= 4);
    if (!group) {
      group = [];
      groups.push(group);
    }
    group.push(...unit);
  }
  return groups;
}
