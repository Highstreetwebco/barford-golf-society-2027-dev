import assert from 'node:assert/strict';
import { test } from 'node:test';
import { distanceToHole, holeGpsState, HOLE_GPS_RANGE_METRES, MAX_FIX_AGE } from '../assets/js/hole-gps.js';
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
