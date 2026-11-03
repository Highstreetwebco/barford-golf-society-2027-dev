import assert from 'node:assert/strict';
import { test } from 'node:test';
import { distanceToHole, holeGpsState, holeMeasurements, HOLE_GPS_RANGE_METRES, MAX_FIX_AGE } from '../assets/js/hole-gps.js';
import { yardsBetween } from '../assets/js/hole-map.js';

const now = 1800000000000;
const hole = { tee: { lat: 0, lng: 0 }, green: { lat: .004, lng: 0 } };
const fix = (point = { lat: .002, lng: 0 }, extras = {}) => ({ point, accuracy: 6, timestamp: now, ...extras });
const east = metres => ({ lat: .002, lng: metres / (6371008.8 * Math.cos(.002 * Math.PI / 180)) * 180 / Math.PI });

test('Only positions within the unrounded 1,000-yard boundary show live distances', () => {
  assert.equal(holeGpsState(fix(east(HOLE_GPS_RANGE_METRES - .1)), hole, now), 'live');
  assert.equal(holeGpsState(fix(east(HOLE_GPS_RANGE_METRES + .1)), hole, now), 'away');
  assert.equal(holeGpsState(fix({ lat: 52, lng: -1.5 }), hole, now), 'away');
});

test('The proximity check covers the whole route, including a dogleg and behind the tee', () => {
  const behind = { lat: -.008, lng: 0 };
  assert.ok(yardsBetween(behind, hole.green) > 1000);
  assert.equal(holeGpsState(fix(behind), hole, now), 'live');
  const bent = { ...hole, dogleg: { lat: .002, lng: .012 } };
  assert.equal(holeGpsState(fix(bent.dogleg), bent, now), 'live');
  assert.equal(holeGpsState(fix(bent.dogleg), hole, now), 'away');
  assert.ok(distanceToHole({ lat: .002, lng: 0 }, hole) < .001);
});

test('Stale or inaccurate GPS never becomes a live yardage', () => {
  assert.equal(holeGpsState(fix(undefined, { timestamp: now - MAX_FIX_AGE }), hole, now), 'live');
  assert.equal(holeGpsState(fix(undefined, { timestamp: now - MAX_FIX_AGE - 1 }), hole, now), 'stale');
  assert.equal(holeGpsState(fix(undefined, { accuracy: 20 }), hole, now), 'live');
  assert.equal(holeGpsState(fix(undefined, { accuracy: 20.1 }), hole, now), 'inaccurate');
});

test('Invalid, unavailable and future location readings are rejected', () => {
  for (const bad of [{ accuracy: null }, { accuracy: NaN }, { accuracy: -1 }, { timestamp: NaN }, { timestamp: now + 5001 }, { point: { lat: 91, lng: 0 } }]) {
    assert.equal(holeGpsState(fix(undefined, bad), hole, now), 'invalid');
  }
  assert.equal(holeGpsState(null, hole, now), 'unavailable');
  assert.equal(holeGpsState(fix(), { green: hole.green }, now), 'unavailable');
});

test('Yardage changes with the player and is reevaluated for each selected hole', () => {
  const near = fix();
  assert.equal(holeGpsState(near, hole, now), 'live');
  assert.ok(yardsBetween({ lat: .003, lng: 0 }, hole.green) < yardsBetween(near.point, hole.green));
  assert.equal(holeGpsState(near, { tee: { lat: 1, lng: 1 }, green: { lat: 1.004, lng: 1 } }, now), 'away');
});

test('Aim-point measurements use GPS nearby and the mapped tee when away', () => {
  const aim = { lat: .002, lng: 0 };
  const nearby = holeMeasurements(fix({ lat: .001, lng: 0 }), hole, aim, now);
  assert.deepEqual([nearby.green, nearby.aim, nearby.remaining], [365, 122, 243]);
  assert.equal(nearby.live, true);
  const away = holeMeasurements(fix({ lat: 52, lng: -1.5 }), hole, aim, now);
  assert.deepEqual([away.green, away.aim, away.remaining], [486, 243, 243]);
  assert.deepEqual(away.origin, hole.tee);
  const moved = holeMeasurements(fix({ lat: .0015, lng: 0 }), hole, aim, now);
  assert.ok(moved.aim < nearby.aim);
  assert.equal(moved.remaining, nearby.remaining, 'The second shot does not change when the player moves');
});

test('Missing, stale and poor GPS use the tee for both planning distances', () => {
  const aim = { lat: .003, lng: 0 };
  for (const reading of [null, fix(undefined, { accuracy: 80 }), fix(undefined, { timestamp: now - 16000 })]) {
    const result = holeMeasurements(reading, hole, aim, now);
    assert.equal(result.live, false);
    assert.deepEqual([result.green, result.aim, result.remaining], [486, 365, 122]);
  }
});

test('Clearing or moving an aim point never retains the previous shot distances', () => {
  const reading = fix({ lat: .001, lng: 0 });
  const first = holeMeasurements(reading, hole, { lat: .002, lng: 0 }, now);
  const next = holeMeasurements(reading, hole, { lat: .003, lng: 0 }, now);
  assert.ok(next.aim > first.aim && next.remaining < first.remaining);
  const cleared = holeMeasurements(reading, hole, null, now);
  assert.equal(cleared.aim, null); assert.equal(cleared.remaining, null);
  assert.equal(cleared.green, first.green);
});
