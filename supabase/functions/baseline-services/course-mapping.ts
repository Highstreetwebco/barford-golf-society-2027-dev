// Draft mapping only: no database writes, guessed stroke indexes or automatic publication.
// OSM golf=hole ways run from tee to green. Every imported position still needs review.
export type Point = { lat: number; lng: number };
export type CourseInput = {
  place_id: string; name: string; latitude: number; longitude: number;
  address?: string; tee_name?: string; layout_name?: string;
};
export type Scorecard = {
  tee_name: string; source_url?: string; course_name?: string;
  holes: Array<{ number?: number; hole?: number; hole_number?: number; par?: number; yards?: number; stroke_index?: number }>;
};
type Geometry = Array<{ lat: number; lon: number }>;
type Element = { id?: number; type?: string; tags?: Record<string, string>; geometry?: Geometry;
  members?: Array<{ type?: string; ref?: number; role?: string; geometry?: Geometry }> };
type Hole = {
  number: number; par: number | null; yards: number | null; stroke_index: number | null;
  tee: Point | null; green: Point | null; front: null; back: null; dogleg: Point | null; reviewed: false;
};
type MappingOptions = { fetcher?: typeof fetch; signal?: AbortSignal; scorecard?: Scorecard | null; scorecards?: Promise<Scorecard[]> };
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const MAX_BYTES = 3_000_000;
const cache = new Map<string, { at: number; elements: Element[] }>();
const rad = (n: number) => n * Math.PI / 180;
const integer = (v: unknown, min: number, max: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const point = (p: { lat: number; lon?: number; lng?: number }): Point | null => {
  const lng = p?.lng ?? p?.lon;
  return typeof p?.lat === 'number' && typeof lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(lng) && Math.abs(p.lat) <= 90 && Math.abs(lng) <= 180 ? { lat: p.lat, lng } : null;
};
const cleanName = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/&/g, ' and ').replace(/\b(the|golf|club|course|country|resort|limited|ltd)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const nameMatch = (a: string, b: string) => {
  const aa = cleanName(a), bb = cleanName(b);
  if (!aa || !bb) return false;
  return aa === bb || aa.length >= 5 && bb.length >= 5 && (aa.includes(bb) || bb.includes(aa));
};
export function distanceMetres(a: Point, b: Point) {
  const x = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(Math.max(0, x)), Math.sqrt(Math.max(0, 1 - x)));
}
function inside(p: Point, polygon: Point[]) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.lat > p.lat) !== (b.lat > p.lat) && p.lng < (b.lng - a.lng) * (p.lat - a.lat) / (b.lat - a.lat) + a.lng) result = !result;
  }
  return result;
}
function edgeDistance(p: Point, polygon: Point[]) {
  const scale = Math.cos(rad(p.lat)); let closest = Infinity;
  for (let i = 1; i < polygon.length; i++) {
    const a = { x: (polygon[i - 1].lng - p.lng) * scale, y: polygon[i - 1].lat - p.lat };
    const b = { x: (polygon[i].lng - p.lng) * scale, y: polygon[i].lat - p.lat };
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / length)) : 0;
    closest = Math.min(closest, Math.hypot(a.x + t * dx, a.y + t * dy) * 111195);
  }
  return closest;
}
const contains = (p: Point, polygon: Point[]) => inside(p, polygon) || edgeDistance(p, polygon) <= .5;
function polygonCentre(g: Point[], fallback: Point) {
  const base = g[0]; let area = 0, x = 0, y = 0;
  for (let i = 1; i < g.length; i++) {
    const a = { x: g[i - 1].lng - base.lng, y: g[i - 1].lat - base.lat }, b = { x: g[i].lng - base.lng, y: g[i].lat - base.lat };
    const cross = a.x * b.y - b.x * a.y; area += cross; x += (a.x + b.x) * cross; y += (a.y + b.y) * cross;
  }
  if (Math.abs(area) < 1e-15) return fallback;
  const centre = { lat: base.lat + y / (3 * area), lng: base.lng + x / (3 * area) };
  return inside(centre, g) ? centre : fallback;
}
function layoutLabel(tags: Record<string, string>) {
  return tags['course:name'] || tags['golf:course'] || tags.course || String(tags.name || '').match(/^\s*\d{1,2}\s*[,–—-]\s*(.+)$/)?.[1] || '';
}
export class CourseMappingError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = 'CourseMappingError'; this.code = code; }
}
function geometry(e: Element) {
  if (!Array.isArray(e.geometry) || e.geometry.length > 2000) return [];
  const points = e.geometry.map(point);
  return points.some(p => p === null) ? [] : points as Point[];
}
// OSM areas may be relations made from several unordered, reversible ways.
// Join only exact endpoints; incomplete or branched rings are never guessed.
function boundaryRings(e: Element): { outer: Point[][]; inner: Point[][] } | null {
  if (e.type !== 'relation') {
    const g = geometry(e);
    return g.length >= 4 && distanceMetres(g[0], g[g.length - 1]) < 1 ? { outer: [g], inner: [] } : null;
  }
  if (e.tags?.type !== 'multipolygon' || !e.members?.length || e.members.length > 100) return null;
  const members = e.members.filter(m => m.type === 'way');
  if (!members.length || members.some(m => !['outer', 'inner', ''].includes(m.role || ''))) return null;
  const same = (a: Point, b: Point) => a.lat === b.lat && a.lng === b.lng;
  function join(role: 'outer' | 'inner'): Point[][] | null {
    const parts = members.filter(m => (m.role || 'outer') === role).map(m => geometry(m));
    if (parts.some(g => g.length < 2)) return null;
    const rings: Point[][] = [];
    while (parts.length) {
      const ring = [...parts.shift()!];
      while (!same(ring[0], ring[ring.length - 1])) {
        const end = ring[ring.length - 1];
        const matches = parts.map((g, i) => ({ g, i })).filter(({ g }) => same(end, g[0]) || same(end, g[g.length - 1]));
        if (matches.length !== 1) return null;
        const { g, i } = matches[0]; parts.splice(i, 1);
        ring.push(...(same(end, g[0]) ? g : [...g].reverse()).slice(1));
        if (ring.length > 2000) return null;
      }
      if (ring.length < 4) return null;
      rings.push(ring);
    }
    return rings;
  }
  const outer = join('outer'), inner = join('inner');
  return outer?.length && inner ? { outer, inner } : null;
}
function matchingBoundaries(course: CourseInput, elements: Element[]) {
  const center = { lat: course.latitude, lng: course.longitude };
  return elements.filter(e => e.tags?.leisure === 'golf_course').flatMap(e => {
    const rings = boundaryRings(e);
    if (!rings || ![e.tags?.name || '', ...(e.tags?.alt_name || '').split(';')].some(n => nameMatch(course.name, n))) return [];
    if (!rings.outer.some(g => contains(center, g) || edgeDistance(center, g) < 500)) return [];
    return [{ e, ...rings }];
  });
}
function routeLength(g: Point[]) { return g.slice(1).reduce((n, p, i) => n + distanceMetres(g[i], p), 0); }
function corner(g: Point[]): Point | null {
  if (g.length < 3) return null;
  const a = g[0], b = g[g.length - 1];
  const scale = Math.cos(rad(a.lat));
  const dx = (b.lng - a.lng) * scale, dy = b.lat - a.lat, total = dx * dx + dy * dy;
  if (!total) return null;
  let best: Point | null = null, offset = 0;
  for (const p of g.slice(1, -1)) {
    const x = (p.lng - a.lng) * scale, y = p.lat - a.lat;
    const t = Math.max(0, Math.min(1, (x * dx + y * dy) / total));
    const deviation = Math.hypot(x - t * dx, y - t * dy) * 111195;
    if (deviation > offset && distanceMetres(a, p) > 40 && distanceMetres(p, b) > 40) { best = p; offset = deviation; }
  }
  return offset >= 20 ? best : null;
}
const empty = (number: number): Hole => ({ number, par: null, yards: null, stroke_index: null, tee: null, green: null, front: null, back: null, dogleg: null, reviewed: false });

// Exported pure function so course boundaries, duplicate numbering and alignment are tested.
export function buildCourseMapping(course: CourseInput, elements: Element[], scorecard?: Scorecard | null) {
  const center = point({ lat: course.latitude, lng: course.longitude });
  if (!center || !course.place_id || !course.name?.trim()) throw new Error('Select a course with a valid map location.');
  const warnings: string[] = [];
  const holes = Array.from({ length: 18 }, (_, i) => empty(i + 1));
  const official = new Map<number, Hole>();
  let cardValid = !!scorecard && scorecard.holes.length === 18;
  for (const h of scorecard?.holes || []) {
    const n = integer(h.number ?? h.hole ?? h.hole_number, 1, 18);
    if (!n || official.has(n)) { cardValid = false; continue; }
    official.set(n, { ...empty(n), par: integer(h.par, 3, 6), yards: integer(h.yards, 1, 1200), stroke_index: integer(h.stroke_index, 1, 18) });
  }
  if (official.size !== 18 || [...official.values()].some(h => !h.par || !h.yards || !h.stroke_index) || new Set([...official.values()].map(h => h.stroke_index)).size !== 18) cardValid = false;
  if (cardValid) for (const [n, h] of official) holes[n - 1] = h;
  else if (scorecard) throw new CourseMappingError('SCORECARD_INCOMPLETE', 'The selected scorecard is incomplete or inconsistent. The hole map has not been produced.');
  const matching = matchingBoundaries(course, elements);
  if (matching.length !== 1) throw new CourseMappingError('COURSE_BOUNDARY_UNCONFIRMED', matching.length ? 'More than one course boundary matches this venue. The hole map has not been produced.' : 'The selected course boundary could not be confirmed. The hole map has not been produced.');
  const selected = matching[0];
  const inCourse = (p: Point) => selected.outer.some(g => contains(p, g)) && !selected.inner.some(g => contains(p, g));
  const rows: Array<{ id?: number; number: number; label: string; g: Point[]; par: number | null; si: number | null; yards: number | null }> = [];
  for (const e of elements) {
    if (e.tags?.golf !== 'hole') continue;
    const n = integer(e.tags.ref, 1, 18), g = geometry(e);
    if (!n || g.length < 2) continue;
    if (g.some(p => distanceMetres(center, p) > 3500)) continue;
    if (g.some(p => !inCourse(p))) continue;
    const length = routeLength(g);
    if (length < 25 || length > 1100) continue;
    rows.push({ id: e.id, number: n, label: layoutLabel(e.tags), g, par: integer(e.tags.par, 3, 6), si: integer(e.tags.handicap ?? e.tags.stroke_index, 1, 18), yards: integer(e.tags['length:yards'] ?? e.tags['distance:yards'], 1, 1200) });
  }
  const labels = [...new Set(rows.map(r => r.label).filter(Boolean))];
  const requestedLayout = course.layout_name || scorecard?.course_name || '';
  const matchingLabels = labels.filter(label => nameMatch(label, requestedLayout));
  if (labels.length > 1 && matchingLabels.length !== 1) throw new CourseMappingError('COURSE_CHOICE_REQUIRED', `This venue contains ${labels.join(' and ')}. Choose the exact course before producing its hole map.`);
  if (labels.length && requestedLayout && matchingLabels.length !== 1) throw new CourseMappingError('COURSE_LAYOUT_UNCONFIRMED', 'The selected course layout could not be matched to the numbered map routes. No hole map has been produced.');
  const chosenLabel = matchingLabels[0] || (labels.length === 1 ? labels[0] : '');
  const courseRows = chosenLabel ? rows.filter(r => r.label === chosenLabel) : rows;
  const grouped = new Map<number, typeof rows>();
  for (const row of courseRows) grouped.set(row.number, [...(grouped.get(row.number) || []), row]);
  const duplicates = [...grouped.entries()].filter(([, v]) => v.length > 1).map(([n]) => n);
  if (duplicates.length) throw new CourseMappingError('HOLE_ROUTES_AMBIGUOUS', `Multiple routes match holes ${duplicates.join(', ')}. The hole map has not been produced.`);
  const unique = courseRows.filter(r => grouped.get(r.number)?.length === 1);
  if (unique.length !== 18) throw new CourseMappingError('HOLE_ROUTES_INCOMPLETE', `Only ${unique.length} of 18 numbered holes could be confirmed for this course. The hole map has not been produced.`);
  const footprints = elements.filter(e => ['tee', 'green'].includes(e.tags?.golf || '') && !/practice|putting/i.test(e.tags?.name || '')).map(e => ({ e, g: geometry(e) })).filter(f => f.g.length >= 4 && distanceMetres(f.g[0], f.g[f.g.length - 1]) < 1 && f.g.every(inCourse));
  const anchors = new Map<typeof unique[number], { tee: typeof footprints[number]; green: typeof footprints[number] }>();
  const failures: string[] = [];
  for (const row of unique) {
    const tees = footprints.filter(f => f.e.tags?.golf === 'tee' && contains(row.g[0], f.g));
    const greens = footprints.filter(f => f.e.tags?.golf === 'green' && contains(row.g[row.g.length - 1], f.g));
    if (tees.length !== 1 || greens.length !== 1) failures.push(`${row.number} (${tees.length !== 1 ? 'tee' : ''}${tees.length !== 1 && greens.length !== 1 ? ' and ' : ''}${greens.length !== 1 ? 'green' : ''})`);
    else anchors.set(row, { tee: tees[0], green: greens[0] });
  }
  if (failures.length) throw new CourseMappingError('HOLE_ANCHORS_UNCONFIRMED', `Mapped tee or green areas could not be uniquely confirmed for holes ${failures.join(', ')}. No hole map has been produced.`);
  if (new Set([...anchors.values()].map(a => a.tee.e)).size !== 18 || new Set([...anchors.values()].map(a => a.green.e)).size !== 18) throw new CourseMappingError('HOLE_ANCHORS_SHARED', 'Two holes point to the same mapped tee or green area. The hole map has not been produced.');
  let shift = 0, orderEvidence = 'numbered_map_routes';
  if (cardValid) {
    const rankings = Array.from({ length: 18 }, (_, offset) => {
      let parMatches = 0, parEvidence = 0, siMatches = 0, siEvidence = 0;
      for (const row of unique) {
        const h = official.get(((row.number + offset - 1) % 18) + 1)!;
        if (row.par) { parEvidence++; if (row.par === h.par) parMatches++; }
        if (row.si) { siEvidence++; if (row.si === h.stroke_index) siMatches++; }
      }
      return { offset, parMatches, parEvidence, siMatches, siEvidence };
    });
    const parMatches = rankings.filter(r => r.parEvidence === 18 && r.parMatches === 18);
    const combinedMatches = rankings.filter(r => r.siEvidence >= 15 && r.siMatches === r.siEvidence && r.parEvidence >= 9 && r.parMatches === r.parEvidence);
    const chosen = parMatches.length === 1 ? parMatches[0] : combinedMatches.length === 1 ? combinedMatches[0] : null;
    if (!chosen) throw new CourseMappingError('HOLE_ORDER_UNCONFIRMED', 'The numbered map routes do not uniquely match the selected scorecard. The hole map has not been produced.');
    shift = chosen.offset;
    orderEvidence = parMatches.length === 1 ? 'unique_18_hole_par_sequence' : 'matching_par_and_stroke_index_sequence';
    if (shift) warnings.push(`Map numbering was aligned by ${shift} holes against the selected scorecard. Check the first hole and both nines in the preview.`);
    if (chosen.siMatches < chosen.siEvidence) warnings.push('Map stroke indexes differ from the selected tee scorecard. The scorecard stroke indexes are used; hole order was confirmed by its unique 18-hole par sequence.');
  }
  const evidence: Array<Record<string, unknown>> = [];
  for (const row of unique) {
    const n = ((row.number + shift - 1) % 18) + 1, h = holes[n - 1];
    if (cardValid && row.par && row.par !== h.par) throw new CourseMappingError('SCORECARD_CONFLICT', `Hole ${n} map data conflicts with the selected scorecard. The hole map has not been produced.`);
    if (!cardValid) { h.par = row.par; h.stroke_index = row.si; h.yards = row.yards; }
    const anchor = anchors.get(row)!;
    h.tee = row.g[0]; h.green = polygonCentre(anchor.green.g, row.g[row.g.length - 1]); h.dogleg = corner(row.g);
    evidence.push({ number: n, osm_number: row.number, route_id: row.id, tee_feature_id: anchor.tee.e.id, green_feature_id: anchor.green.e.id });
  }
  // Conflicting OSM SI values are unknown, not guessed into a 1–18 permutation.
  if (!cardValid) {
    const counts = new Map<number, number>();
    for (const h of holes) if (h.stroke_index) counts.set(h.stroke_index, (counts.get(h.stroke_index) || 0) + 1);
    if ([...counts.values()].some(n => n > 1)) {
      warnings.push('Conflicting stroke indexes were omitted. Enter them from the course scorecard.');
      for (const h of holes) if (h.stroke_index && counts.get(h.stroke_index)! > 1) h.stroke_index = null;
    }
  }
  const coverage = { mapped: holes.filter(h => h.tee && h.green).length, par: holes.filter(h => h.par).length, yards: holes.filter(h => h.yards).length, stroke_index: holes.filter(h => h.stroke_index).length };
  if (coverage.mapped !== 18) throw new CourseMappingError('MAPPING_VALIDATION_FAILED', 'All 18 tee and green positions could not be confirmed. No hole map has been produced.');
  const missingCardFields = [...(coverage.yards < 18 ? ['yardages'] : []), ...(coverage.stroke_index < 18 ? ['stroke indexes'] : [])];
  if (missingCardFields.length) warnings.push(`Complete the missing ${missingCardFields.join(' and ')} from the chosen tee scorecard.`);
  warnings.push('The numbered routes match mapped tee and green areas. Confirm the course preview before making it available to members. Tee colours are not verified by this map source.');
  return {
    name: `${course.name.trim()}${chosenLabel && !cleanName(course.name).includes(cleanName(chosenLabel)) ? ` · ${chosenLabel}` : ''}`.slice(0, 200), tee_name: (cardValid ? scorecard!.tee_name : course.tee_name || 'Yellow').slice(0, 80),
    place_id: course.place_id, center, address: String(course.address || '').slice(0, 500), holes,
    source: { provider: 'openstreetmap', attribution: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright', fetched_at: new Date().toISOString(), coverage, warnings, boundary_id: selected.e.id, boundary_type: selected.e.type || 'way', ...(cardValid && scorecard?.source_url ? { scorecard_url: scorecard.source_url } : {}), numbering_shift: shift, validation: { status: 'verified', method: 'numbered_routes_inside_tee_green_footprints', mapped: 18, tee_anchors: 18, green_anchors: 18, course_name: chosenLabel || requestedLayout || course.name, tee_colour_confirmed: false, scorecard_order_confirmed: cardValid, order_evidence: orderEvidence, ...(scorecard?.source_url ? { scorecard_url: scorecard.source_url } : {}), evidence } },
  };
}

async function boundedText(response: Response, maximum = MAX_BYTES) {
  if (!response.ok) throw new Error('Course mapping is temporarily unavailable. No hole map has been created. Please try again.');
  if (Number(response.headers.get('content-length') || 0) > maximum || !response.body) throw new Error('The map response is too large. No hole map has been created.');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; total += value.byteLength; if (total > maximum) throw new Error('The map response is too large. No hole map has been created.'); chunks.push(value); }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const data = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(data);
}
async function boundedJson(response: Response) {
  const parsed = JSON.parse(await boundedText(response));
  if (!Array.isArray(parsed.elements) || parsed.elements.length > 800) throw new Error('The course map response could not be read safely.');
  if (parsed.remark) throw new Error('The map provider could not finish this course lookup. Try again shortly.');
  return parsed.elements as Element[];
}

function xmlAttributes(input: string) {
  const values: Record<string, string> = {};
  for (const match of input.matchAll(/([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(["'])(.*?)\2/g)) {
    if (match[3].length > 2048) continue;
    values[match[1]] = match[3].replace(/&(?:amp|lt|gt|quot|apos);/g, s => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[s]!);
  }
  return values;
}
function xmlTags(input: string) {
  const tags: Record<string, string> = {};
  let count = 0;
  for (const tag of input.matchAll(/<tag\b([^>]*)\/\s*>/g)) {
    if (++count > 100) break;
    const a = xmlAttributes(tag[1]);
    if (a.k && a.v !== undefined) tags[a.k] = a.v;
  }
  return tags;
}
// A small parser for the fixed OSM API response format. No DOM, DTD, external
// entities or user-selected URLs are involved. Missing nodes invalidate a way.
export function parseOsmXml(input: string): Element[] {
  if (input.length > 16_000_000 || /<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(input) || !/<osm\b/.test(input) || !/<\/osm\s*>/.test(input)) throw new Error('The course map XML could not be read safely.');
  const xml = input.replace(/<!--[\s\S]*?-->/g, '');
  const nodes = new Map<string, Point>();
  let nodeCount = 0, wayCount = 0;
  for (const match of xml.matchAll(/<node\b([^>]*)\/?\s*>/g)) {
    if (++nodeCount > 100000) throw new Error('The course map contains too many points.');
    const a = xmlAttributes(match[1]);
    if (!/^\d{1,20}$/.test(a.id || '') || !/^-?\d+(?:\.\d+)?$/.test(a.lat || '') || !/^-?\d+(?:\.\d+)?$/.test(a.lon || '')) continue;
    const p = point({ lat: Number(a.lat), lng: Number(a.lon) });
    if (p) nodes.set(a.id, p);
  }
  const elements: Element[] = [];
  const relations: Element[] = [], memberIds = new Set<number>(), memberWays = new Map<number, Geometry>();
  for (const match of xml.matchAll(/<relation\b([^>]*)>([\s\S]*?)<\/relation\s*>/g)) {
    const tags = xmlTags(match[2]);
    if (tags.leisure !== 'golf_course' || tags.type !== 'multipolygon') continue;
    const members = [...match[2].matchAll(/<member\b([^>]*)\/\s*>/g)].map(m => {
      const a = xmlAttributes(m[1]); return { type: a.type, ref: Number(a.ref), role: a.role || '' };
    });
    if (members.length > 100 || members.some(m => !Number.isSafeInteger(m.ref) || m.ref <= 0)) continue;
    const id = Number(xmlAttributes(match[1]).id);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    relations.push({ id, type: 'relation', tags, members });
    if (relations.length > 100) throw new Error('The course map contains too many boundaries.');
    for (const m of members) if (m.type === 'way') memberIds.add(m.ref);
  }
  for (const match of xml.matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way\s*>/g)) {
    if (++wayCount > 30000) throw new Error('The course map contains too many routes.');
    const tags = xmlTags(match[2]), id = Number(xmlAttributes(match[1]).id);
    const golf = ['hole', 'tee', 'green'].includes(tags.golf) || tags.leisure === 'golf_course';
    if (!golf && !memberIds.has(id)) continue;
    const g: Array<{ lat: number; lon: number }> = []; let complete = true;
    for (const ref of match[2].matchAll(/<nd\b([^>]*)\/\s*>/g)) {
      const node = nodes.get(xmlAttributes(ref[1]).ref);
      if (!node || g.length >= 2000) { complete = false; break; }
      g.push({ lat: node.lat, lon: node.lng });
    }
    if (!complete || g.length < 2) continue;
    if (memberIds.has(id)) memberWays.set(id, g);
    if (golf) elements.push({ ...(Number.isSafeInteger(id) ? { id } : {}), type: 'way', tags, geometry: g });
    if (elements.length > 800) throw new Error('The course map contains too many golf routes.');
  }
  for (const relation of relations) {
    relation.members = relation.members!.map(m => ({ ...m, geometry: memberWays.get(m.ref!) }));
    elements.push(relation);
  }
  if (elements.length > 800) throw new Error('The course map contains too many golf routes.');
  return elements;
}
export async function prepareCourseMapping(course: CourseInput, options: MappingOptions = {}) {
  if (!point({ lat: course.latitude, lng: course.longitude }) || !course.place_id || course.place_id.length > 250 || !course.name?.trim()) throw new Error('Select a course with a valid map location.');
  const key = `${course.place_id}:${course.latitude.toFixed(5)}:${course.longitude.toFixed(5)}`;
  let elements = cache.get(key)?.at && Date.now() - cache.get(key)!.at < 600000 ? cache.get(key)!.elements : null;
  if (!elements) {
    const query = `[out:json][timeout:12];(way(around:2500,${course.latitude},${course.longitude})["leisure"="golf_course"];relation(around:2500,${course.latitude},${course.longitude})["leisure"="golf_course"];way(around:2500,${course.latitude},${course.longitude})["golf"~"^(hole|tee|green)$"];);out body geom;`;
    const stop = new AbortController();
    const deadline = AbortSignal.any([stop.signal, AbortSignal.timeout(35000), ...(options.signal ? [options.signal] : [])]);
    const fetcher = options.fetcher || fetch;
    const headers = { 'User-Agent': 'BarfordGolf2027CourseSetup/1.0 (https://barfordgolf.co.uk)' };
    const overpass = async (endpoint: string, milliseconds: number) => boundedJson(await fetcher(endpoint, { method: 'POST', redirect: 'error', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: new URLSearchParams({ data: query }), signal: AbortSignal.any([deadline, AbortSignal.timeout(milliseconds)]) }));
    const validated = async (request: Promise<Element[]>) => {
      const result = await request;
      // An HTTP 200 with incomplete geometry must not cancel a usable fallback.
      buildCourseMapping(course, result, options.scorecard);
      return result;
    };
    try {
      try { elements = await validated(overpass(OVERPASS[0], 5000)); }
      catch (primaryError) {
        // A town-wide OSM export exceeds the API's 50,000-node limit. Discover
        // the boundary near the clubhouse, then request only the course extent.
        const xml = async () => {
          const read = async (box: number[]) => parseOsmXml(await boundedText(await fetcher('https://api.openstreetmap.org/api/0.6/map?' + new URLSearchParams({ bbox: box.join(',') }), { method: 'GET', redirect: 'error', headers, signal: AbortSignal.any([deadline, AbortSignal.timeout(20000)]) }), 16_000_000));
          const box = [Math.max(-180, course.longitude - .012), Math.max(-90, course.latitude - .007), Math.min(180, course.longitude + .012), Math.min(90, course.latitude + .007)];
          const seed = await read(box), boundaries = matchingBoundaries(course, seed);
          if (boundaries.length !== 1) return seed; // Validation reports the exact boundary problem.
          const points = boundaries[0].outer.flat();
          if (points.some(p => distanceMetres(p, { lat: course.latitude, lng: course.longitude }) > 3500)) throw new Error('The course boundary extends beyond the supported map area. No hole map has been created.');
          const extent = [Math.max(-180, Math.min(...points.map(p => p.lng)) - .0002), Math.max(-90, Math.min(...points.map(p => p.lat)) - .0002), Math.min(180, Math.max(...points.map(p => p.lng)) + .0002), Math.min(90, Math.max(...points.map(p => p.lat)) + .0002)];
          if (extent[0] >= box[0] && extent[1] >= box[1] && extent[2] <= box[2] && extent[3] <= box[3]) return seed;
          return read(extent);
        };
        try { elements = await Promise.any([validated(overpass(OVERPASS[1], 10000)), validated(xml())]); }
        catch (error) {
          const failures = [primaryError, ...(error instanceof AggregateError ? error.errors : [error])];
          throw failures.find(e => e instanceof CourseMappingError) || failures.find(e => e instanceof Error) || new Error('Course mapping timed out. No hole map has been created. Please try again.');
        }
      }
    } finally { stop.abort(); }
    if (cache.size >= 32) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: Date.now(), elements });
  }
  let card = options.scorecard;
  if (!card && options.scorecards) {
    // The caller starts scorecard discovery before entering this function, so providers
    // run in parallel. Only an exact, unique tee name may fill the initial draft.
    const choices = await options.scorecards.catch(() => []);
    const wanted = (course.tee_name || 'Yellow').trim().toLowerCase();
    const matches = choices.filter(c => c.tee_name.trim().toLowerCase() === wanted);
    if (matches.length === 1) card = matches[0];
  }
  return buildCourseMapping(course, elements, card);
}
