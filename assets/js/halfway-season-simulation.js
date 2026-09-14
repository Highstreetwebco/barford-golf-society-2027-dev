const names = [
  'Alex Carter','Ben Foster','Callum Reed','Dan Walker','Elliot Hayes','Freddie Cole',
  'George Turner','Harry Mason','Isaac Wood','James Cooper','Kyle Bennett','Liam Brooks',
  'Matt Evans','Nathan Price','Oliver Shaw','Peter Hall','Ryan Clarke','Sam Morris',
  'Tom Bailey','Will Parker','Adam Lewis','Charlie King','Jamie Scott','Luke Harris'
];

const players = names.map((name, index) => {
  const number = index + 1;
  const handicap = 8 + ((number * 7) % 29);
  return {
    id: `sim-player-${String(number).padStart(2, '0')}`,
    name,
    photoUrl: null,
    startingHandicap: handicap,
    currentHandicap: handicap,
    fromRound: 1
  };
});

const handicaps = new Map(players.map(player => [player.id, player.startingHandicap]));
const dates = ['2027-03-20','2027-04-17','2027-05-15','2027-06-12'];
const rounds = dates.map((date, roundIndex) => {
  const roundNumber = roundIndex + 1;
  const results = players.map((player, playerIndex) => {
    const number = playerIndex + 1;
    const points = 25 + ((number * 11 + roundNumber * 7 + number * roundNumber * 3) % 18);
    const adjustment = points >= 40 ? -2 : points >= 36 ? -1 : points >= 30 ? 0 : 1;
    const handicapUsed = handicaps.get(player.id);
    const nextHandicap = Math.max(0, handicapUsed + adjustment);
    handicaps.set(player.id, nextHandicap);
    return { playerId: player.id, handicapUsed, points, adjustment, nextHandicap, dnp: false };
  });
  return { id: `sim-round-${roundNumber}`, number: roundNumber, name: `Round ${roundNumber}`, date, locked: true, results };
});

players.forEach(player => { player.currentHandicap = handicaps.get(player.id); });

export const HALFWAY_SEASON_SIMULATION = Object.freeze({
  season: 2027,
  players,
  rounds,
  achievements: [],
  nextEvent: {
    id: 'sim-event-5',
    name: 'Round 5',
    venue: 'Brandon Wood',
    event_date: '2027-07-10',
    first_tee_time: '09:00:00',
    price: 45
  }
});
