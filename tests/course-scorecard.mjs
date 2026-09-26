import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findCourseScorecards, scorecardSelectionKey } from '../supabase/functions/baseline-services/course-scorecard.ts';

const venue = { name: 'The Warwickshire', latitude: 52.3122149, longitude: -1.580061, address: 'Leek Wootton' };
const json = value => new Response(JSON.stringify(value));
const encode = value => Array.isArray(value) ? [1, value.map(encode)] : value && typeof value === 'object'
  ? [0, Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]))] : [0, value];
const page = club => `<astro-island component-export="Scorecard" props="${JSON.stringify(encode({ profile: { club } })).replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">`;
const complete = Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, yards: 300 + i, stroke_index: i + 1 }));
const makeClub = record => ({ id: { id: record.id }, name: record.name, geoPoint: record.geoPoint, holeCount: 18,
  courses: [record.course], holeSets: record.sets, tees: [{ name: 'White', gender: 'MALE' }, { name: 'Yellow', gender: 'MALE' }],
  holes: record.rows.map(([par, si, white, yellow]) => ({ menPar: par, menHandicap: si, teeYardages: [white, yellow] })) });
function mockBirdies(clubs, onRequest = () => {}) {
  return async (url, init) => {
    onRequest(url, init);
    assert.ok(url.startsWith('https://18birdies.com/'), 'primary provider should not leak into UK API');
    assert.equal(init.redirect, 'error');
    if (url.includes('searchPlaces')) return json({ clubCards: clubs.map(clubBrief => ({ clubBrief })) });
    const club = clubs.find(c => url.includes('/' + c.id.id + '/'));
    assert.ok(club, 'only a selected, verified provider club may be fetched');
    return new Response(page(club));
  };
}
function mockUk(layouts, response, onRequest = () => {}) {
  return async (url, init) => {
    onRequest(url, init);
    if (url.startsWith('https://18birdies.com/')) { assert.equal(init.headers['X-RapidAPI-Key'], undefined); return json({ clubCards: [] }); }
    assert.equal(init.headers['X-RapidAPI-Key'], 'test-only-key');
    if (url.includes('/clubs/nearby?')) return json({ clubs: [{ id: 'warwickshire', name: 'The Warwickshire Golf Club', latitude: venue.latitude, longitude: venue.longitude }] });
    if (url.endsWith('/courses')) return json({ courses: layouts });
    return json(typeof response === 'function' ? response(url) : response);
  };
}
const ukLayout = extra => ({ id: 'earls', name: 'Earls', holeCount: 18, tee_sets: [{ id: 'yellow', name: 'Yellow', gender: 'male' }], ...extra });

test('current Warwickshire facts return valid Earls White/Yellow, excluding Castle nine and invalid Kings mens indexes', async () => {
  const castle = { id: { id: 'castle' }, name: 'Warwickshire | Castle Course', geoPoint: captured[0].geoPoint, holeCount: 9, courses: [{ name: 'Castle Course', holeCount: 9 }] };
  const north = { ...makeClub(captured[0]), id: { id: 'north' }, name: 'North Warwickshire', geoPoint: { latitude: 52.43479, longitude: -1.66361 } };
  const calls = [];
  const result = await findCourseScorecards(venue, { apiKey: 'test-only-key', fetcher: mockBirdies([...captured.map(makeClub), castle, north], url => calls.push(url)) });
  assert.equal(result.cards.length, 2);
  for (const tee of ['White (men)', 'Yellow (men)']) assert.ok(result.cards.some(c => c.course_name.includes('Earls') && c.tee_name === tee));
  assert.ok(result.warnings.some(w => w.includes('Kings') && w.includes('White (men)') && w.includes('repeated')));
  assert.ok(!calls.some(url => url.includes('/castle/')));
  assert.equal(new Set(result.cards.map(c => c.selection_key)).size, 2);
  for (const card of result.cards) { assert.equal(card.selection_key, scorecardSelectionKey(card)); assert.equal(card.holes.length, 18); }
});

test('multi-layout indexes select the correct eighteen holes rather than taking the first eighteen', async () => {
  const club = makeClub(captured[0]); club.name = 'The Warwickshire'; club.holeCount = 36;
  club.holes.push(...club.holes.map(h => ({ ...h, teeYardages: h.teeYardages.map(y => y + 10) })));
  club.holeSets.push(...club.holeSets.map(s => ({ ...s, holeIndexes: s.holeIndexes.map(i => i + 18) })));
  club.courses = [{ name: 'Earls', holeCount: 18, holeSetIndexes: [0, 1] }, { name: 'Kings', holeCount: 18, holeSetIndexes: [2, 3] }];
  const result = await findCourseScorecards(venue, { fetcher: mockBirdies([club]) });
  assert.equal(result.cards.length, 4);
  const earls = result.cards.find(c => c.course_name.endsWith('Earls') && c.tee_name === 'White (men)');
  const kings = result.cards.find(c => c.course_name.endsWith('Kings') && c.tee_name === 'White (men)');
  assert.equal(kings.holes[0].yards, earls.holes[0].yards + 10);
});

test('unknown course ordering and duplicate scorecard stroke indexes are rejected', async () => {
  for (const change of [c => c.courses[0].holeSetIndexes = [0, 0], c => c.holes[1].menHandicap = c.holes[0].menHandicap]) {
    const club = makeClub(structuredClone(captured[0])); change(club);
    const result = await findCourseScorecards(venue, { fetcher: mockBirdies([club]) }); assert.equal(result.cards.length, 0);
  }
});

test('same-name far-away clubs and indistinguishable nearby clubs are rejected', async () => {
  const club = makeClub(captured[0]);
  const far = { ...club, geoPoint: { latitude: 51, longitude: 0 } };
  const duplicate = { ...club, id: { id: 'another-nearby-club' } };
  for (const candidates of [[far], [club, duplicate]]) {
    let requests = 0; const result = await findCourseScorecards(venue, { fetcher: mockBirdies(candidates, () => requests++) });
    assert.equal(result.cards.length, 0); assert.equal(requests, 1);
  }
});

test('provider page must match searched course identity', async () => {
  const club = makeClub(captured[0]); const fetcher = mockBirdies([club]);
  const result = await findCourseScorecards(venue, { fetcher: async (url, init) => url.includes('searchPlaces') ? fetcher(url, init) : new Response(page({ ...club, id: { id: 'different-club' } })) });
  assert.equal(result.cards.length, 0);
});

test('UK fallback requires known eighteen-hole metadata and rejects every nine-hole alias', async () => {
  for (const field of ['holes', 'hole_count', 'holeCount', 'holesCount', 'holes_count', 'number_of_holes', 'numberOfHoles', 'num_holes', 'numHoles']) {
    let scorecardRequests = 0; const result = await findCourseScorecards(venue, { apiKey: 'test-only-key', fetcher: mockUk([ukLayout({ [field]: 9 })], { holes: complete }, url => { if (url.includes('/scorecard?')) scorecardRequests++; }) });
    assert.equal(result.cards.length, 0, field); assert.equal(scorecardRequests, 0, field);
  }
  const layout = ukLayout({}); delete layout.holeCount;
  const result = await findCourseScorecards(venue, { apiKey: 'test-only-key', fetcher: mockUk([layout], { holes: complete }) }); assert.equal(result.cards.length, 0);
});

test('UK fallback validates returned tee and course IDs, not merely eighteen rows', async () => {
  const badResponses = [
    { course_id: 'castle', holes: complete }, { tee_id: 'white', holes: complete },
    { tee_set: { id: 'white', course_id: 'earls', holes: complete } },
    { tee_set: { id: 'yellow', course_id: 'kings', holes: complete } },
    { course: { id: 'castle' }, tee_set: { id: 'yellow', holes: complete } },
    { id: 'white', holes: complete }, { number_of_holes: 9, holes: complete },
  ];
  for (const payload of badResponses) {
    const result = await findCourseScorecards(venue, { apiKey: 'test-only-key', fetcher: mockUk([ukLayout({})], payload) }); assert.equal(result.cards.length, 0);
  }
  const result = await findCourseScorecards(venue, { apiKey: 'test-only-key', fetcher: mockUk([ukLayout({})], { course_id: 'earls', tee_set: { id: 'yellow', name: 'Yellow', gender: 'male', holes: complete } }) });
  assert.equal(result.cards.length, 1); assert.equal(result.cards[0].tee_name, 'Yellow (men)');
  assert.ok(!JSON.stringify(result).includes('test-only-key'));
});

test('redirects and malformed source responses become warnings', async () => {
  const result = await findCourseScorecards(venue, { fetcher: async (_url, init) => { assert.equal(init.redirect, 'error'); return new Response('', { status: 302, headers: { Location: 'https://example.com' } }); } });
  assert.equal(result.cards.length, 0); assert.ok(result.warnings.length);
});

test('hard cancellation returns even when an injected fetcher ignores its signal', async () => {
  const controller = new AbortController(); const started = Date.now();
  setTimeout(() => controller.abort(), 20);
  const result = await findCourseScorecards(venue, { signal: controller.signal, fetcher: () => new Promise(() => {}) });
  assert.ok(Date.now() - started < 1000); assert.equal(result.cards.length, 0);
});
// Public numeric scorecard facts captured on 2026-09-26; no provider HTML/assets.
const captured = [{"id":"c64c65f0-86ac-11e4-8c28-020000005b00","name":"Warwickshire | Earls Course","geoPoint":{"longitude":-1.5903294291,"latitude":52.3107101032},"course":{"id":{"id":"cd8858b0-86f2-11e4-8f92-020000005b00"},"name":"Warwickshire (Earls)","holeCount":18,"holeSetIndexes":[0,1]},"sets":[{"holeIndexes":[0,1,2,3,4,5,6,7,8],"teeIndexes":[0,1]},{"holeIndexes":[9,10,11,12,13,14,15,16,17],"teeIndexes":[0,1]}],"rows":[[4,6,434,423],[3,12,199,187],[4,16,396,383],[5,4,630,607],[4,10,443,413],[5,14,534,507],[4,2,419,397],[3,18,156,135],[4,8,432,404],[5,7,582,568],[3,13,161,154],[4,5,410,402],[3,17,151,147],[4,3,412,370],[4,9,392,357],[4,1,446,432],[4,15,365,351],[5,11,571,534]]},{"id":"c6436540-86ac-11e4-8c28-020000005b00","name":"Warwickshire | Kings Course","geoPoint":{"longitude":-1.5888923203,"latitude":52.3106826209},"course":{"id":{"id":"c215e560-86f2-11e4-8f92-020000005b00"},"name":"Warwickshire (Kings)","holeCount":18,"holeSetIndexes":[0,1]},"sets":[{"holeIndexes":[0,1,2,3,4,5,6,7,8],"teeIndexes":[0,1]},{"holeIndexes":[9,10,11,12,13,14,15,16,17],"teeIndexes":[0,1]}],"rows":[[4,14,386,360],[4,4,431,421],[4,16,372,362],[3,18,147,131],[4,2,446,422],[5,10,550,523],[5,12,565,540],[3,6,190,179],[4,8,375,367],[4,10,367,357],[4,12,409,400],[3,6,233,209],[4,2,431,402],[4,14,365,342],[4,16,339,309],[5,4,571,537],[3,18,135,108],[5,8,563,536]]}];
