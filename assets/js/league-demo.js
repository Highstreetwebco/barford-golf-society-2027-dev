import { adjustment, roundAverage } from "./league-rules.js?v=2027-simple-1";

// This roster entry is a setup test account, not a society member.
const setupMember = "ec1208f1-1cb7-4365-9b02-7ed93fa7ee6e";
const seed = (value) => [...value].reduce((n, ch) => Math.imul(n ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261);
const nameKey = (name) => name.trim().toLocaleLowerCase("en-GB");

// Presentation data only. Never save these scores or handicaps to the season.
export function demonstrationBoard(roster, actualPlayers = []) {
  if (!Array.isArray(roster)) throw new Error("The member list could not load. Please try Refresh again.");
  const accounts = new Map(actualPlayers.map((p) => [nameKey(p.name), p.id]));
  const players = roster.filter((p) => p.id !== setupMember && !p.invite_only)
    .map((p) => ({
      id: accounts.get(nameKey(p.name)) || p.id,
      member_id: p.id,
      name: p.name,
      starting_handicap: 8 + seed(p.id + ":handicap") % 23,
    })).sort((a, b) => a.name.localeCompare(b.name));
  const winners = [...players].sort((a, b) => seed(a.member_id + ":winner") - seed(b.member_id + ":winner") || a.id.localeCompare(b.id));
  const handicaps = new Map(players.map((p) => [p.id, p.starting_handicap]));
  const rounds = Array.from({ length: players.length ? 3 : 0 }, (_, i) => {
    const round = i + 1, winner = winners[i % winners.length]?.id;
    const entries = players.map((p) => ({
      user_id: p.id, status: "played",
      points: p.id === winner ? 40 + i : 20 + seed(p.member_id + ":round:" + round) % 19,
    }));
    const average = roundAverage(entries);
    const results = entries.map((entry) => {
      const handicap = handicaps.get(entry.user_id);
      const change = average === null ? 0 : adjustment(entry.points, average, handicap);
      const next = Math.max(0, handicap + change);
      handicaps.set(entry.user_id, next);
      return { user_id: entry.user_id, points: entry.points, handicap,
        next_handicap: next, adjustment: next - handicap, winner: entry.user_id === winner };
    });
    return { round, average, results };
  });
  return { demo: true, visible_rounds: 5, players, rounds };
}
