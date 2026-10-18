import assert from 'node:assert/strict';
import { rankPlayers, changeValue } from '../assets/js/league-view.js';
import { roundAverage, adjustment, handicapAt } from '../assets/js/league-rules.js';

function board(rows, visible = 7) {
  return {
    visible_rounds: visible,
    players: rows.map((scores, i) => ({id: `p${i}`, name: `Player ${i}`, starting_handicap: 20})),
    rounds: Array.from({length: Math.max(0, ...rows.map((scores) => scores.length))}, (_, i) => ({
      round: i + 1,
      results: rows.map((scores, p) => ({user_id: `p${p}`, points: scores[i] ?? null, winner: false})),
    })),
  };
}

// Independent oracle: enumerate every subset of at most five rounds.
function bestFiveOracle(scores) {
  let best = 0;
  for (let mask = 0; mask < 1 << scores.length; mask++) {
    const picked = scores.filter((score, i) => score != null && mask & (1 << i));
    if (picked.length <= 5) best = Math.max(best, picked.reduce((a, b) => a + b, 0));
  }
  return best;
}

const reference = board([[46, 39, 33, 32, 26, 25, 22], [38, 36, 33, 30, 27, 22, 15]]);
assert.deepEqual(rankPlayers(reference).map((p) => p.total), [176, 164]);
assert.deepEqual(rankPlayers(reference)[0].counted, [46, 39, 33, 32, 26]);
assert.deepEqual(rankPlayers(reference)[0].dropped, [25, 22]);
for (let count = 0; count <= 7; count++) {
  const values = [20, 30, 15, 40, 25, 35, 45].slice(0, count);
  const result = rankPlayers(board([values]))[0];
  assert.equal(result.total, bestFiveOracle(values));
  assert.equal(result.played, count);
  assert.equal(result.counted.length, Math.min(count, 5));
  assert.equal(result.dropped.length, Math.max(0, count - 5));
}
assert.equal(rankPlayers(board([[30, null, 40, null, 25, 32, null]]))[0].played, 4);
assert.equal(rankPlayers(board([[30, null, 40, null, 25, 32, null]]))[0].total, 127);
assert.equal(rankPlayers(board([[30, 30, 30, 30, 30, 30, 30]]))[0].counted.length, 5);
assert.deepEqual(rankPlayers(board([[30, 30, 30, 30, 30, 30, 30]]))[0].scores.filter((s) => s.counted).map((s) => s.round), [1, 2, 3, 4, 5]);

// Hidden scores cannot change totals, played count, wins, tie-breaks or rank.
const hidden = board([[20, 21, 22, 23, 24, 99, 98], [20, 21, 22, 23, 24, 1, 2]], 5);
hidden.rounds[5].results[0].winner = true;
hidden.rounds[6].results[0].winner = true;
const safe = rankPlayers(hidden);
assert.deepEqual(safe.map((p) => [p.total, p.played, p.wins, p.rank]), [[110, 5, 0, 1], [110, 5, 0, 1]]);
assert(safe.every((p) => p.scores.every((s) => s.round <= 5)));
delete hidden.visible_rounds;
assert.deepEqual(rankPlayers(hidden).map((p) => p.total), [110, 110]);
assert.deepEqual(rankPlayers({...hidden, visible_rounds: 7}, 4).map((p) => p.total), [86, 86]);
const tie = board([[30, 30], [30, 30], [29, 30]]);
tie.rounds[0].results[1].winner = true;
assert.deepEqual(rankPlayers(tie).map((p) => [p.id, p.rank]), [['p1', 1], ['p0', 2], ['p2', 3]]);
tie.rounds[0].results[1].winner = false;
assert.deepEqual(rankPlayers(tie).map((p) => p.rank), [1, 1, 3]);

// Deterministic property checks: every number of rounds, missing rounds,
// equal scores and shuffled publication order, against subset enumeration.
let seed = 123456;
function random() { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; }
for (let i = 0; i < 1200; i++) {
  const count = i % 8;
  const scores = Array.from({length:count}, () => random() < .2 ? null : 1 + Math.floor(random() * 54));
  const data = board([scores]);
  if (i % 2) data.rounds.reverse();
  const before = JSON.stringify(data);
  const actual = rankPlayers(data)[0];
  assert.equal(actual.total, bestFiveOracle(scores));
  assert.equal(actual.played, scores.filter((s) => s != null).length);
  assert.equal(JSON.stringify(data), before, 'Ranking must not mutate the source');
}

const duplicateRound = board([[30]]);
duplicateRound.rounds.push(structuredClone(duplicateRound.rounds[0]));
assert.throws(() => rankPlayers(duplicateRound), /Duplicate/);
const duplicateScore = board([[30]]);
duplicateScore.rounds[0].results.push({...duplicateScore.rounds[0].results[0]});
assert.throws(() => rankPlayers(duplicateScore), /duplicate/);
for (const bad of [-1, 109, 30.5, '30', NaN, Infinity]) {
  assert.throws(() => rankPlayers(board([[bad]])), /invalid score/);
}
assert.throws(() => rankPlayers(null), /incomplete/);

const entries = (values) => values.map((points) => ({points, status: points == null || points === 0 ? 'dnp' : 'played'}));
assert.equal(roundAverage(entries([10, 20, 30])), null);
assert.equal(roundAverage(entries([10, 20, 30, 40])), 25);
assert.equal(roundAverage(entries([10, 20, 21, 30, 50])), 24);
assert.equal(roundAverage(entries([10, 10, 30, 40, 40])), 27);
assert.equal(roundAverage(entries([20, 30, 40, 50, null, 0])), 35);
for (const [points, average, handicap, expected] of [
  [34,30,20,-1], [32,30,20,0], [27,30,20,1], [40,30,9,-2],
  [45,30,30,-3], [1,30,30,2], [28,30,9,0], [30,30,20,0],
]) assert.equal(adjustment(points,average,handicap), expected);
assert.equal(handicapAt({id:'p0',starting_handicap:20,adjustments:[]}, 2,
  [{round_number:1,published_entries:[],results:[{user_id:'p0',next_handicap:17}]}]),17);
assert.equal(handicapAt({id:'p0',starting_handicap:20,adjustments:[{round_number:2,handicap:15}]}, 2,
  [{round_number:1,published_entries:[],results:[{user_id:'p0',next_handicap:17}]}]),15);
assert.equal(changeValue({handicap:2,next_handicap:0,adjustment:-3}),-2);

console.log('PASS: 1,200 independent best-five checks; 0–7 rounds; DNP; equal scores; dropped scores; ranking ties; private rounds; malformed/duplicate data; averages; handicap boundaries and carry.');
