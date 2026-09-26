import assert from 'node:assert/strict';
import { buildCourseMapping, prepareCourseMapping, distanceMetres, parseOsmXml } from '../supabase/functions/baseline-services/course-mapping.ts';

const course = { place_id: 'mapping-fixture', name: 'Test Golf Club', latitude: 52, longitude: -1, tee_name: 'Yellow' };
const boundary = { id: 10, tags: { leisure: 'golf_course', name: 'Test Golf Club' }, geometry: [{ lat: 51.99, lon: -1.02 }, { lat: 52.02, lon: -1.02 }, { lat: 52.02, lon: -0.98 }, { lat: 51.99, lon: -0.98 }, { lat: 51.99, lon: -1.02 }] };
const way = (number, extras = {}) => ({ id: 100 + number, tags: { golf: 'hole', ref: String(number), par: String(3 + number % 3), handicap: String(number), ...extras }, geometry: [{ lat: 52 + number * .0002, lon: -1 }, { lat: 52 + number * .0002 + .001, lon: -.999 }] });
const all = Array.from({ length: 18 }, (_, i) => way(i + 1));
let draft = buildCourseMapping(course, [boundary, ...all]);
assert.equal(draft.source.coverage.mapped, 18);
assert.equal(draft.source.coverage.par, 18);
assert.equal(draft.source.coverage.stroke_index, 18);
assert.equal(draft.source.coverage.yards, 0, 'Route geometry is not official tee yardage');
assert.ok(draft.holes.every(h => !h.reviewed && h.front === null && h.back === null));
assert.equal(draft.source.attribution, '© OpenStreetMap contributors');
assert.equal(draft.source.boundary_id, 10);
assert.ok(Math.abs(distanceMetres({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) - 111195) < 2);

draft = buildCourseMapping(course, [boundary, ...all, { ...way(1), id: 900 }]);
assert.equal(draft.source.coverage.mapped, 17);
assert.equal(draft.holes[0].tee, null, 'Duplicate numbering must not silently choose another course');
assert.ok(draft.source.warnings.some(w => w.includes('More than one route')));
draft = buildCourseMapping(course, [boundary, way(1, { ref: '1;10' }), way(2, { ref: '19' }), way(3, { handicap: '1' }), way(4, { handicap: '1' })]);
assert.equal(draft.source.coverage.mapped, 2);
assert.equal(draft.source.coverage.stroke_index, 0, 'Conflicting SI values stay unknown');
assert.equal(draft.holes[0].tee, null);
draft = buildCourseMapping(course, [boundary, { ...way(1), geometry: [{ lat: 0, lon: 0 }, { lat: 0.001, lon: 0 }] }]);
assert.equal(draft.source.coverage.mapped, 0, 'Far-away geometry must not be imported');
draft = buildCourseMapping({ ...course, latitude: 52.03 }, [boundary, ...all]);
assert.equal(draft.source.coverage.mapped, 0, 'Unmatched nearby boundary is not guessed');
draft = buildCourseMapping(course, [boundary, { ...boundary, id: 11, tags: { leisure: 'golf_course', name: 'Test Golf Club' } }, ...all]);
assert.equal(draft.source.coverage.mapped, 0, 'Ambiguous course boundaries must block automatic mapping');

const card = { tee_name: 'Yellow', source_url: 'https://example.org/scorecard', holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 3 + (i + 1) % 3, yards: 100 + i * 20, stroke_index: i + 1 })) };
const shifted = all.map((w, i) => ({ ...w, tags: { ...w.tags, ref: String((i + 9) % 18 + 1) } }));
draft = buildCourseMapping(course, [boundary, ...shifted], card);
assert.equal(draft.source.numbering_shift, 9, 'Strong unique scorecard evidence aligns the nines');
assert.deepEqual(draft.holes[0].tee, { lat: all[0].geometry[0].lat, lng: all[0].geometry[0].lon });
assert.equal(draft.holes[0].yards, 100);
assert.equal(draft.source.coverage.yards, 18);
assert.equal(draft.source.scorecard_url, card.source_url);
assert.ok(draft.holes.every(h => h.reviewed === false), 'Good alignment is still a draft');
draft = buildCourseMapping(course, [boundary, ...all], { ...card, holes: card.holes.slice(0, 17) });
assert.equal(draft.source.coverage.yards, 0);
assert.ok(draft.source.warnings.some(w => w.includes('incomplete or inconsistent')));

let requests = 0;
const fetcher = async (url, options) => {
  requests++;
  assert.equal(url, 'https://overpass-api.de/api/interpreter');
  assert.equal(options.redirect, 'error');
  assert.ok(options.body.get('data').includes('[timeout:12]'));
  return Response.json({ elements: [boundary, ...all] });
};
const fetched = await prepareCourseMapping(course, { fetcher, scorecards: Promise.resolve([card]) });
assert.equal(fetched.source.coverage.yards, 18);
await prepareCourseMapping(course, { fetcher });
assert.equal(requests, 1, 'Cache avoids repeated external requests');
await assert.rejects(() => prepareCourseMapping({ ...course, latitude: '52);out body;' }, { fetcher }), /valid map location/);
await assert.rejects(() => prepareCourseMapping({ ...course, place_id: 'oversized' }, { fetcher: async () => new Response('{}', { headers: { 'content-length': '3000001' } }) }), /too large/);
await assert.rejects(() => prepareCourseMapping({ ...course, place_id: 'partial-response' }, { fetcher: async () => Response.json({ elements: [], remark: 'runtime error: timeout' }) }), /could not finish/);
await assert.rejects(() => prepareCourseMapping({ ...course, place_id: 'bad-http' }, { fetcher: async () => new Response('', { status: 503 }) }), /temporarily unavailable/);
const noExactTee = await prepareCourseMapping({ ...course, place_id: 'red-choice', tee_name: 'Red' }, { fetcher, scorecards: Promise.resolve([card]) });
assert.equal(noExactTee.source.coverage.yards, 0, 'A different tee card must never be applied automatically');
const endpoints = [];
const fallback = await prepareCourseMapping({ ...course, place_id: 'fallback' }, { fetcher: async url => { endpoints.push(url); return endpoints.length === 1 ? new Response('', { status: 503 }) : Response.json({ elements: [boundary, ...all] }); } });
assert.equal(fallback.source.coverage.mapped, 18);
assert.deepEqual(endpoints.slice(0, 2), ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']);
assert.ok(endpoints[2].startsWith('https://api.openstreetmap.org/api/0.6/map?bbox='));

const xmlFixture = `<?xml version="1.0"?><osm version="0.6">
 <node id="1" lat="52.0002" lon="-1"/><node id="2" lat="52.0012" lon="-.999"/>
 <node id="3" lat="52.0005" lon="-.9995"/>
 <way id="100"><nd ref="1"/><nd ref="3"/><nd ref="2"/><tag k="golf" v="hole"/><tag k="ref" v="1"/><tag k="par" v="4"/><tag k="handicap" v="3"/></way>
 <way id="101"><nd ref="1"/><nd ref="999"/><tag k="golf" v="hole"/><tag k="ref" v="2"/></way>
 <way id="102"><nd ref="1"/><nd ref="2"/><tag k="highway" v="path"/></way>
 </osm>`;
// OSM normally writes leading zeroes; use the real wire representation here.
const actualXml = xmlFixture.replaceAll('lon="-.', 'lon="-0.');
const parsedXml = parseOsmXml(actualXml);
assert.equal(parsedXml.length, 1, 'Missing-node ways and unrelated paths must be discarded');
assert.equal(parsedXml[0].tags.ref, '1');
assert.equal(parsedXml[0].geometry.length, 3);
const xmlEndpoints = [];
const xmlDraft = await prepareCourseMapping({ ...course, place_id: 'xml-rescue' }, { fetcher: async (url, options) => {
  xmlEndpoints.push(url);
  if (url.startsWith('https://api.openstreetmap.org/api/0.6/map?')) { assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); return new Response(actualXml); }
  return new Response('', { status: 406 });
} });
assert.equal(xmlEndpoints.length, 3);
assert.equal(xmlDraft.source.coverage.mapped, 1, 'Official XML fallback rescues a failed Overpass lookup');
assert.equal(xmlDraft.holes[0].par, 4);
assert.equal(xmlDraft.holes[0].stroke_index, 3);
assert.equal(xmlDraft.holes[0].reviewed, false);
assert.throws(() => parseOsmXml('<!DOCTYPE osm [<!ENTITY x SYSTEM "file:///etc/passwd">]><osm></osm>'), /safely/);
assert.throws(() => parseOsmXml('<osm><node id="1" lat="52" lon="-1"/>'), /safely/, 'Truncated XML cannot be accepted');
console.log('Course mapping boundary, coverage, ambiguity, SI, alignment, tee selection, URL and response-bound checks passed');
