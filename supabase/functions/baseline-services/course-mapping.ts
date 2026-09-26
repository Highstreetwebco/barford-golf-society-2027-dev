// Draft mapping only: no database writes, guessed stroke indexes or automatic publication.
// OSM golf=hole ways run from tee to green. Every imported position still needs review.
export type Point = { lat: number; lng: number };
export type CourseInput = {
  place_id: string; name: string; latitude: number; longitude: number;
  address?: string; tee_name?: string;
};
export type Scorecard = {
  tee_name: string; source_url?: string;
  holes: Array<{ number?: number; hole?: number; hole_number?: number; par?: number; yards?: number; stroke_index?: number }>;
};
type Element = { id?: number; type?: string; tags?: Record<string, string>; geometry?: Array<{ lat: number; lon: number }> };
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
const cleanName = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/\b(the|golf|club|course|country|resort|limited|ltd)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
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
function geometry(e: Element) {
  if (!Array.isArray(e.geometry) || e.geometry.length > 2000) return [];
  const points = e.geometry.map(point);
  return points.some(p => p === null) ? [] : points as Point[];
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
  else if (scorecard) warnings.push('The scorecard source was incomplete or inconsistent, so its values were not imported.');
  const boundaries = elements.filter(e => e.tags?.leisure === 'golf_course').map(e => ({ e, g: geometry(e) })).filter(x => x.g.length >= 4 && distanceMetres(x.g[0], x.g[x.g.length - 1]) < 10);
  const containing = boundaries.filter(x => inside(center, x.g));
  const named = boundaries.filter(x => nameMatch(course.name, x.e.tags?.name || ''));
  let selected: { e: Element; g: Point[] } | undefined = containing.length === 1 ? containing[0] : containing.filter(x => nameMatch(course.name, x.e.tags?.name || ''))[0];
  if (containing.length > 1 && containing.filter(x => nameMatch(course.name, x.e.tags?.name || '')).length !== 1) selected = undefined;
  if (!selected && named.length === 1 && Math.min(...named[0].g.map(p => distanceMetres(center, p))) < 800) selected = named[0];
  let unsafeCourse = false;
  if (!selected && boundaries.length) {
    warnings.push('Nearby course boundaries could not be matched safely. Check the selected course and map the holes manually.');
    unsafeCourse = true;
  }
  if (!boundaries.length) warnings.push('No course boundary was available. Check every imported hole belongs to this course.');
  const rows: Array<{ number: number; g: Point[]; par: number | null; si: number | null; yards: number | null }> = [];
  if (!unsafeCourse) for (const e of elements) {
    if (e.tags?.golf !== 'hole') continue;
    const n = integer(e.tags.ref, 1, 18), g = geometry(e);
    if (!n || g.length < 2) continue;
    if (g.some(p => distanceMetres(center, p) > 3500)) continue;
    if (selected && (!inside(g[0], selected.g) || !inside(g[g.length - 1], selected.g))) continue;
    const length = routeLength(g);
    if (length < 25 || length > 1100) continue;
    rows.push({ number: n, g, par: integer(e.tags.par, 3, 6), si: integer(e.tags.handicap ?? e.tags.stroke_index, 1, 18), yards: integer(e.tags['length:yards'] ?? e.tags['distance:yards'], 1, 1200) });
  }
  const grouped = new Map<number, typeof rows>();
  for (const row of rows) grouped.set(row.number, [...(grouped.get(row.number) || []), row]);
  const duplicates = [...grouped.entries()].filter(([, v]) => v.length > 1).map(([n]) => n);
  if (duplicates.length) warnings.push(`More than one route was found for holes ${duplicates.join(', ')}. Those holes were left unmapped to avoid mixing courses.`);
  const unique = rows.filter(r => grouped.get(r.number)?.length === 1);
  let shift = 0;
  if (cardValid && unique.length >= 9) {
    const rankings = Array.from({ length: 18 }, (_, offset) => {
      let matches = 0, conflicts = 0, evidence = 0;
      for (const row of unique) {
        const h = official.get(((row.number + offset - 1) % 18) + 1)!;
        for (const [actual, expected, weight] of [[row.si, h.stroke_index, 3], [row.par, h.par, 1]]) if (actual && expected) { evidence += weight!; if (actual === expected) matches += weight!; else conflicts += weight!; }
      }
      return { offset, matches, conflicts, evidence, score: matches - conflicts * 2 };
    }).sort((a, b) => b.score - a.score);
    const [first, second] = rankings;
    if (first.offset !== 0 && first.evidence >= 24 && first.matches / first.evidence >= 0.9 && first.score - second.score >= 8) {
      shift = first.offset;
      warnings.push(`Map numbering was aligned by ${shift} holes using the scorecard. Check the first hole and both nines before publication.`);
    } else if (first.offset !== 0 || first.conflicts > first.matches / 4) {
      warnings.push('Map numbering does not clearly agree with the scorecard. Original map numbers were kept for review.');
    }
  }
  for (const row of unique) {
    const n = ((row.number + shift - 1) % 18) + 1, h = holes[n - 1];
    if (!cardValid) { h.par = row.par; h.stroke_index = row.si; h.yards = row.yards; }
    h.tee = row.g[0]; h.green = row.g[row.g.length - 1]; h.dogleg = corner(row.g);
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
  if (coverage.mapped < 18) warnings.push(`${coverage.mapped} of 18 hole routes found. Missing positions need manual setup.`);
  const missingCardFields = [...(coverage.yards < 18 ? ['yardages'] : []), ...(coverage.stroke_index < 18 ? ['stroke indexes'] : [])];
  if (missingCardFields.length) warnings.push(`Complete the missing ${missingCardFields.join(' and ')} from the chosen tee scorecard.`);
  warnings.push('All imported tee and green positions require an organiser check before members can use GPS.');
  return {
    name: course.name.trim().slice(0, 200), tee_name: (cardValid ? scorecard!.tee_name : course.tee_name || 'Yellow').slice(0, 80),
    place_id: course.place_id, center, address: String(course.address || '').slice(0, 500), holes,
    source: { provider: 'openstreetmap', attribution: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright', fetched_at: new Date().toISOString(), coverage, warnings, ...(selected?.e.id ? { boundary_id: selected.e.id } : {}), ...(cardValid && scorecard?.source_url ? { scorecard_url: scorecard.source_url } : {}), numbering_shift: shift },
  };
}

async function boundedText(response: Response, maximum = MAX_BYTES) {
  if (!response.ok) throw new Error('Course mapping is temporarily unavailable. Try again or set up the holes manually.');
  if (Number(response.headers.get('content-length') || 0) > maximum || !response.body) throw new Error('The map response is too large. Set up this course manually.');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; total += value.byteLength; if (total > maximum) throw new Error('The map response is too large. Set up this course manually.'); chunks.push(value); }
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
// A small parser for the fixed OSM API response format. No DOM, DTD, external
// entities or user-selected URLs are involved. Missing nodes invalidate a way.
export function parseOsmXml(input: string): Element[] {
  if (input.length > 8_000_000 || /<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(input) || !/<osm\b/.test(input) || !/<\/osm\s*>/.test(input)) throw new Error('The course map XML could not be read safely.');
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
  for (const match of xml.matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way\s*>/g)) {
    if (++wayCount > 30000) throw new Error('The course map contains too many routes.');
    const tags: Record<string, string> = {};
    let tagCount = 0;
    for (const tag of match[2].matchAll(/<tag\b([^>]*)\/\s*>/g)) {
      if (++tagCount > 100) break;
      const a = xmlAttributes(tag[1]);
      if (a.k && a.v !== undefined) tags[a.k] = a.v;
    }
    if (tags.golf !== 'hole' && tags.leisure !== 'golf_course') continue;
    const g: Array<{ lat: number; lon: number }> = []; let complete = true;
    for (const ref of match[2].matchAll(/<nd\b([^>]*)\/\s*>/g)) {
      const node = nodes.get(xmlAttributes(ref[1]).ref);
      if (!node || g.length >= 2000) { complete = false; break; }
      g.push({ lat: node.lat, lon: node.lng });
    }
    if (!complete || g.length < 2) continue;
    const id = Number(xmlAttributes(match[1]).id);
    elements.push({ ...(Number.isSafeInteger(id) ? { id } : {}), type: 'way', tags, geometry: g });
    if (elements.length > 800) throw new Error('The course map contains too many golf routes.');
  }
  return elements;
}
export async function prepareCourseMapping(course: CourseInput, options: MappingOptions = {}) {
  if (!point({ lat: course.latitude, lng: course.longitude }) || !course.place_id || course.place_id.length > 250 || !course.name?.trim()) throw new Error('Select a course with a valid map location.');
  const key = `${course.place_id}:${course.latitude.toFixed(5)}:${course.longitude.toFixed(5)}`;
  let elements = cache.get(key)?.at && Date.now() - cache.get(key)!.at < 600000 ? cache.get(key)!.elements : null;
  if (!elements) {
    const query = `[out:json][timeout:12];(way(around:2500,${course.latitude},${course.longitude})["leisure"="golf_course"];way(around:2500,${course.latitude},${course.longitude})["golf"="hole"];);out tags geom;`;
    const stop = new AbortController();
    const deadline = AbortSignal.any([stop.signal, AbortSignal.timeout(18000), ...(options.signal ? [options.signal] : [])]);
    const fetcher = options.fetcher || fetch;
    const headers = { 'User-Agent': 'BarfordGolf2027CourseSetup/1.0 (https://barfordgolf.co.uk)' };
    const overpass = async (endpoint: string, milliseconds: number) => boundedJson(await fetcher(endpoint, { method: 'POST', redirect: 'error', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: new URLSearchParams({ data: query }), signal: AbortSignal.any([deadline, AbortSignal.timeout(milliseconds)]) }));
    try {
      try { elements = await overpass(OVERPASS[0], 5000); }
      catch {
        // Fetch the independent official OSM map API alongside the second Overpass
        // instance. This keeps a working fallback inside the shared 18-second budget.
        const bbox = [Math.max(-180, course.longitude - .03), Math.max(-90, course.latitude - .018), Math.min(180, course.longitude + .03), Math.min(90, course.latitude + .018)].join(',');
        const xml = async () => parseOsmXml(await boundedText(await fetcher('https://api.openstreetmap.org/api/0.6/map?' + new URLSearchParams({ bbox }), { method: 'GET', redirect: 'error', headers, signal: AbortSignal.any([deadline, AbortSignal.timeout(13000)]) }), 8_000_000));
        try { elements = await Promise.any([overpass(OVERPASS[1], 10000), xml()]); }
        catch (error) { throw error instanceof AggregateError && error.errors[0] instanceof Error ? error.errors[0] : new Error('Course mapping timed out. Try again or set up the holes manually.'); }
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
