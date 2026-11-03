export const participantId = player => player?.participant_id || player?.user_id || player?.member_id;
// Guest/host relationships and confirmed pairs are indivisible. Never silently split them.
export function packPlayers(players, playingPairs = []) {
  const rank = (p) => ({ First: 0, Middle: 1, End: 2 })[p.preferred_time] ?? 1;
  const ordered = [...players].sort(
    (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name),
  );
  const units = [], paired = new Set(), parent = new Map(ordered.map(p=>[participantId(p),participantId(p)]));
  const root = id => { while(parent.get(id)!==id)id=parent.get(id);return id; };
  const unite = (a,b) => { if(parent.has(a)&&parent.has(b))parent.set(root(b),root(a)); };
  for(const pair of playingPairs)unite(pair.first_user,pair.second_user);
  for(const guest of ordered.filter(p=>p.guest_host_id)) {
    if(!parent.has(guest.guest_host_id))throw new Error(`${guest.name}'s inviting member is not confirmed. Resolve their RSVP before creating tee groups.`);
    unite(guest.guest_host_id,participantId(guest));
  }
  const components = new Map();
  for(const person of ordered) { const id=root(participantId(person));if(!components.has(id))components.set(id,[]);components.get(id).push(person); }
  for(const unit of components.values()) {
    if(unit.length>4)throw new Error(`The linked group for ${unit[0].name} has ${unit.length} players. A tee group holds four; review guest invitations and confirmed playing pairs.`);
    if(unit.length>1){units.push(unit);unit.forEach(p=>paired.add(participantId(p)));}
  }
  const remaining = ordered.filter((p) => !paired.has(participantId(p)));
  const buggy = remaining.filter((p) => p.buggy);
  units.push(...remaining.filter((p) => !p.buggy).map((p) => [p]));
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
