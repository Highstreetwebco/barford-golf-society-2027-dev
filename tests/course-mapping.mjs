import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildCourseMapping, prepareCourseMapping, distanceMetres, parseOsmXml } from '../supabase/functions/baseline-services/course-mapping.ts';

const course = { place_id: 'mapping-fixture', name: 'Test Golf Club', latitude: 52, longitude: -1, tee_name: 'Yellow' };
const boundary = { id: 10, tags: { leisure: 'golf_course', name: 'Test Golf Club' }, geometry: [{ lat: 51.99, lon: -1.02 }, { lat: 52.02, lon: -1.02 }, { lat: 52.02, lon: -0.98 }, { lat: 51.99, lon: -0.98 }, { lat: 51.99, lon: -1.02 }] };
const way = (number, extras = {}) => ({ id: 100 + number, tags: { golf: 'hole', ref: String(number), par: String(3 + number % 3), handicap: String(number), ...extras }, geometry: [{ lat: 52 + number * .0002, lon: -1 }, { lat: 52 + number * .0002 + .001, lon: -.999 }] });
const all = Array.from({ length: 18 }, (_, i) => way(i + 1));
const footprint = (number, kind, lat, lon) => ({ id: 1000 + number * 2 + (kind === 'green' ? 1 : 0), tags: { golf: kind }, geometry: [{ lat: lat - .00004, lon: lon - .00004 }, { lat: lat + .00004, lon: lon - .00004 }, { lat: lat + .00004, lon: lon + .00004 }, { lat: lat - .00004, lon: lon + .00004 }, { lat: lat - .00004, lon: lon - .00004 }] });
const footprints = all.flatMap((w, i) => [footprint(i + 1, 'tee', w.geometry[0].lat, w.geometry[0].lon), footprint(i + 1, 'green', w.geometry[1].lat, w.geometry[1].lon)]);
const complete = [boundary, ...all, ...footprints];
let draft = buildCourseMapping(course, complete);
assert.equal(draft.source.coverage.mapped, 18);
assert.equal(draft.source.coverage.par, 18);
assert.equal(draft.source.coverage.stroke_index, 18);
assert.equal(draft.source.coverage.yards, 0, 'Route geometry is not official tee yardage');
assert.ok(draft.holes.every(h => !h.reviewed && h.front === null && h.back === null));
assert.equal(draft.source.attribution, '© OpenStreetMap contributors');
assert.equal(draft.source.boundary_id, 10);
assert.ok(Math.abs(distanceMetres({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) - 111195) < 2);

assert.equal(draft.source.validation.status, 'verified');
assert.equal(draft.source.validation.tee_anchors, 18);
assert.equal(draft.source.validation.green_anchors, 18);
assert.equal(draft.source.validation.tee_colour_confirmed, false);
assert.equal(draft.source.validation.evidence.length, 18);
assert.throws(() => buildCourseMapping(course, [...complete, { ...way(1), id: 900 }]), e => e.code === 'HOLE_ROUTES_AMBIGUOUS');
assert.throws(() => buildCourseMapping(course, [boundary, ...all.slice(0, 17), ...footprints]), e => e.code === 'HOLE_ROUTES_INCOMPLETE');
assert.throws(() => buildCourseMapping(course, [boundary, ...all]), e => e.code === 'HOLE_ANCHORS_UNCONFIRMED', 'Route endpoints alone are insufficient evidence');
assert.throws(() => buildCourseMapping(course, [...complete, { ...footprints[0], id: 9999 }]), e => e.code === 'HOLE_ANCHORS_UNCONFIRMED', 'Overlapping tee polygons are ambiguous');
assert.throws(() => buildCourseMapping(course, complete.filter(e => e.id !== footprints[5].id)), e => e.code === 'HOLE_ANCHORS_UNCONFIRMED');
assert.throws(() => buildCourseMapping(course, [boundary, { ...way(1), geometry: [{ lat: 0, lon: 0 }, { lat: 0.001, lon: 0 }] }]), e => e.code === 'HOLE_ROUTES_INCOMPLETE');
assert.throws(() => buildCourseMapping({ ...course, latitude: 52.03 }, complete), e => e.code === 'COURSE_BOUNDARY_UNCONFIRMED');
assert.throws(() => buildCourseMapping(course, [boundary, { ...boundary, id: 11 }, ...all, ...footprints]), e => e.code === 'COURSE_BOUNDARY_UNCONFIRMED');
assert.throws(() => buildCourseMapping(course, [...all, ...footprints]), e => e.code === 'COURSE_BOUNDARY_UNCONFIRMED');
const named = all.map(w => ({ ...w, tags: { ...w.tags, 'course:name': 'Earls' } }));
const kings = all.map(w => ({ ...w, id: w.id + 500, tags: { ...w.tags, name: `${w.tags.ref}, Kings` } }));
assert.throws(() => buildCourseMapping(course, [boundary, ...named, ...kings, ...footprints]), e => e.code === 'COURSE_CHOICE_REQUIRED');
assert.equal(buildCourseMapping({ ...course, layout_name: 'Test Golf Club Earls' }, [boundary, ...named, ...kings, ...footprints]).source.validation.course_name, 'Earls');
assert.equal(buildCourseMapping({ ...course, layout_name: 'Test Golf Club Earls' }, [boundary, ...named, ...kings, ...footprints]).name, 'Test Golf Club · Earls');
assert.throws(() => buildCourseMapping({ ...course, layout_name: 'Castle' }, [boundary, ...named, ...kings, ...footprints]), e => e.code === 'COURSE_CHOICE_REQUIRED');

const card = { tee_name: 'Yellow', source_url: 'https://example.org/scorecard', holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 3 + (i + 1) % 3, yards: 100 + i * 20, stroke_index: i + 1 })) };
const shifted = all.map((w, i) => ({ ...w, tags: { ...w.tags, ref: String((i + 9) % 18 + 1) } }));
draft = buildCourseMapping(course, [boundary, ...shifted, ...footprints], card);
assert.equal(draft.source.numbering_shift, 9, 'Strong unique scorecard evidence aligns the nines');
assert.deepEqual(draft.holes[0].tee, { lat: all[0].geometry[0].lat, lng: all[0].geometry[0].lon });
assert.equal(draft.holes[0].yards, 100);
assert.equal(draft.source.coverage.yards, 18);
assert.equal(draft.source.scorecard_url, card.source_url);
assert.ok(draft.holes.every(h => h.reviewed === false), 'Good alignment is still a draft');
assert.throws(() => buildCourseMapping(course, complete, { ...card, holes: card.holes.slice(0, 17) }), e => e.code === 'SCORECARD_INCOMPLETE');
const uniquePars = [4, 3, 4, 5, 4, 5, 4, 3, 4, 5, 3, 4, 3, 4, 4, 4, 4, 5];
const updatedSiCard = { ...card, holes: card.holes.map((h, i) => ({ ...h, par: uniquePars[i], stroke_index: (i + 3) % 18 + 1 })) };
const olderSiRoutes = all.map((w, i) => ({ ...w, tags: { ...w.tags, par: String(uniquePars[i]) } }));
const siUpdated = buildCourseMapping(course, [boundary, ...olderSiRoutes, ...footprints], updatedSiCard);
assert.equal(siUpdated.source.numbering_shift, 0, 'Updated tee stroke indexes must not falsely rotate a uniquely matching par sequence');
assert.equal(siUpdated.source.validation.order_evidence, 'unique_18_hole_par_sequence');
assert.equal(siUpdated.holes[0].stroke_index, updatedSiCard.holes[0].stroke_index);
assert.ok(siUpdated.source.warnings.some(w => w.includes('stroke indexes differ')));
const contradictoryCard = { ...updatedSiCard, holes: updatedSiCard.holes.map((h, i) => ({ ...h, par: i === 0 ? 3 : h.par })) };
assert.throws(() => buildCourseMapping(course, [boundary, ...olderSiRoutes, ...footprints], contradictoryCard), e => e.code === 'HOLE_ORDER_UNCONFIRMED');

let requests = 0;
const fetcher = async (url, options) => {
  requests++;
  assert.equal(url, 'https://overpass-api.de/api/interpreter');
  assert.equal(options.redirect, 'error');
  assert.ok(options.body.get('data').includes('[timeout:12]'));
  assert.ok(options.body.get('data').includes('out body geom;'), 'Relation roles and member geometry must be requested');
  return Response.json({ elements: complete });
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
const fallback = await prepareCourseMapping({ ...course, place_id: 'fallback' }, { fetcher: async url => { endpoints.push(url); return endpoints.length === 1 ? new Response('', { status: 503 }) : Response.json({ elements: complete }); } });
assert.equal(fallback.source.coverage.mapped, 18);
assert.deepEqual(endpoints.slice(0, 2), ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']);
assert.ok(endpoints[2].startsWith('https://api.openstreetmap.org/api/0.6/map?bbox='));

const xmlParts = ['<?xml version="1.0"?><osm version="0.6">'];
let nodeId = 1;
for (const element of complete) {
  const refs = element.geometry.map(p => { const id = nodeId++; xmlParts.push(`<node id="${id}" lat="${p.lat}" lon="${p.lon}"/>`); return id; });
  xmlParts.push(`<way id="${element.id}">${refs.map(id => `<nd ref="${id}"/>`).join('')}${Object.entries(element.tags).map(([k, v]) => `<tag k="${k}" v="${v}"/>`).join('')}</way>`);
}
xmlParts.push('<way id="9000"><nd ref="1"/><nd ref="999999"/><tag k="golf" v="hole"/><tag k="ref" v="2"/></way>');
xmlParts.push('</osm>');
const actualXml = xmlParts.join('');
const parsedXml = parseOsmXml(actualXml);
assert.equal(parsedXml.length, complete.length, 'Missing-node ways must be discarded');
assert.equal(parsedXml.filter(e => e.tags.golf === 'tee').length, 18);
assert.equal(parsedXml.filter(e => e.tags.golf === 'green').length, 18);
const xmlEndpoints = [];
const xmlDraft = await prepareCourseMapping({ ...course, place_id: 'xml-rescue' }, { fetcher: async (url, options) => {
  xmlEndpoints.push(url);
  if (url.startsWith('https://api.openstreetmap.org/api/0.6/map?')) { assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); return new Response(actualXml); }
  return new Response('', { status: 406 });
} });
assert.equal(xmlEndpoints.length, 4, 'The XML fallback fetches a small discovery area, then the exact course extent');
assert.equal(xmlDraft.source.coverage.mapped, 18, 'Official XML fallback must return all confirmed holes');
assert.equal(xmlDraft.source.validation.status, 'verified');
assert.equal(xmlDraft.holes[0].reviewed, false);
assert.throws(() => parseOsmXml('<!DOCTYPE osm [<!ENTITY x SYSTEM "file:///etc/passwd">]><osm></osm>'), /safely/);
assert.throws(() => parseOsmXml('<osm><node id="1" lat="52" lon="-1"/>'), /safely/, 'Truncated XML cannot be accepted');

const relation = { id: 99, type: 'relation', tags: { ...boundary.tags, type: 'multipolygon' }, members: [
  { type: 'way', ref: 2, role: 'outer', geometry: boundary.geometry.slice(2).reverse() },
  { type: 'way', ref: 1, role: 'outer', geometry: boundary.geometry.slice(0, 3) },
] };
const relationMap = buildCourseMapping(course, [relation, ...all, ...footprints], card);
assert.equal(relationMap.source.coverage.mapped, 18, 'Unordered and reversed relation members form a complete course boundary');
assert.equal(relationMap.source.boundary_type, 'relation');
assert.throws(() => buildCourseMapping(course, [{ ...relation, members: relation.members.slice(0, 1) }, ...all, ...footprints]), e => e.code === 'COURSE_BOUNDARY_UNCONFIRMED', 'Missing boundary members are not guessed');
assert.throws(() => buildCourseMapping(course, [{ ...relation, members: [...relation.members, relation.members[1]] }, ...all, ...footprints]), e => e.code === 'COURSE_BOUNDARY_UNCONFIRMED', 'Branched boundary members are rejected');
const exclusion = { type: 'way', ref: 3, role: 'inner', geometry: footprint(0, 'green', all[0].geometry[0].lat, all[0].geometry[0].lon).geometry };
assert.throws(() => buildCourseMapping(course, [{ ...relation, members: [...relation.members, exclusion] }, ...all, ...footprints]), e => e.code === 'HOLE_ROUTES_INCOMPLETE', 'Inner boundary exclusions cannot be treated as part of the course');

const leamington = JSON.parse(await readFile(new URL('./fixtures/leamington-course-source.json', import.meta.url), 'utf8'));
function fixtureXml(elements) {
  const parts = ['<osm version="0.6">']; let id = 1;
  const escape = s => String(s).replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  const tags = value => Object.entries(value || {}).map(([k, v]) => `<tag k="${escape(k)}" v="${escape(v)}"/>`).join('');
  const writeWay = (ref, geometry, values) => {
    const nodes = geometry.map(p => { const node = id++; parts.push(`<node id="${node}" lat="${p.lat}" lon="${p.lon}"/>`); return node; });
    parts.push(`<way id="${ref}">${nodes.map(n => `<nd ref="${n}"/>`).join('')}${tags(values)}</way>`);
  };
  for (const e of elements) {
    if (e.type !== 'relation') writeWay(e.id, e.geometry, e.tags);
    else {
      for (const m of e.members) writeWay(m.ref, m.geometry, {});
      parts.push(`<relation id="${e.id}">${e.members.map(m => `<member type="way" ref="${m.ref}" role="${m.role}"/>`).join('')}${tags(e.tags)}</relation>`);
    }
  }
  return parts.join('') + '</osm>';
}
const leamingtonXml = fixtureXml(leamington.elements);
assert.equal(buildCourseMapping(leamington.course, parseOsmXml(leamingtonXml), leamington.scorecard).source.coverage.mapped, 18, 'XML relation members retain the real Leamington geometry');
const realMap = buildCourseMapping(leamington.course, leamington.elements, leamington.scorecard);
assert.equal(realMap.source.coverage.mapped, 18);
assert.equal(realMap.source.validation.scorecard_order_confirmed, true);
assert.equal(realMap.source.boundary_type, 'relation');
assert.ok(realMap.holes.every(h => !h.reviewed), 'Discovered positions still require organiser confirmation');

// Exact live regression: both Overpass providers fail, the former wide XML
// request exceeds 50,000 nodes, and the compact request must recover the course.
const requestsForLeamington = [];
const fallbackLeamington = await prepareCourseMapping({ ...leamington.course, place_id: 'leamington-fallback-regression' }, {
  scorecard: leamington.scorecard,
  fetcher: async (url, init) => {
    requestsForLeamington.push(url);
    if (!url.startsWith('https://api.openstreetmap.org/')) return new Response('', { status: 503 });
    assert.equal(init.redirect, 'error');
    const [west, south, east, north] = new URL(url).searchParams.get('bbox').split(',').map(Number);
    if (east - west > .025 || north - south > .015) return new Response('You requested too many nodes (limit is 50000).', { status: 400 });
    return new Response(leamingtonXml);
  },
});
assert.equal(fallbackLeamington.source.coverage.mapped, 18);
assert.equal(requestsForLeamington.length, 4);
for (const failPrimary of [false, true]) {
  const recovered = await prepareCourseMapping({ ...leamington.course, place_id: `leamington-incomplete-provider-${failPrimary}` }, {
    scorecard: leamington.scorecard,
    fetcher: async url => {
      if (url.startsWith('https://api.openstreetmap.org/')) return new Response(leamingtonXml);
      if (failPrimary && url.startsWith('https://overpass-api.de/')) return new Response('', { status: 503 });
      return Response.json({ elements: leamington.elements.filter(e => e.type !== 'relation') });
    },
  });
  assert.equal(recovered.source.coverage.mapped, 18, 'Incomplete primary and alternate responses must not cancel the usable XML fallback');
}
await assert.rejects(() => prepareCourseMapping({ ...course, place_id: 'all-incomplete' }, {
  fetcher: async url => url.startsWith('https://api.openstreetmap.org/') ? new Response('<osm></osm>') : Response.json({ elements: [] }),
}), e => e.code === 'COURSE_BOUNDARY_UNCONFIRMED', 'Preserve specific validation errors when no provider has a usable map');
console.log('Course mapping boundary, coverage, ambiguity, SI, alignment, tee selection, URL and response-bound checks passed');
