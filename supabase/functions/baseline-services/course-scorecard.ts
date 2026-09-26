// Read-only discovery. Course identity and complete cards are checked before
// returning choices; callers still ask the organiser which layout/tees to use.
type Course = { name: string; latitude: number; longitude: number; address?: string };
type Hole = { number: number; par: number; yards: number; stroke_index: number };
export type DiscoveredCard = { tee_name: string; holes: Hole[]; source_url: string; course_name: string; selection_key?: string };
type Result = { cards: DiscoveredCard[]; warnings: string[] };
type Options = { fetcher?: typeof fetch; signal?: AbortSignal; apiKey?: string };
type Item = Record<string, any>;

const UK_HOST = 'https://uk-golf-course-data-api.p.rapidapi.com';
const BIRDIES_HOST = 'https://18birdies.com';
const normalise = (s: unknown) => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/\b(the|golf|club|course|limited|ltd)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const idOf = (x: any) => String(typeof x === 'object' ? x?.id || '' : x || '');
const array = (x: any, keys: string[]): Item[] => {
  if (Array.isArray(x)) return x;
  for (const key of keys) if (Array.isArray(x?.[key])) return x[key];
  if (x?.data && x.data !== x) return array(x.data, keys);
  return [];
};
const locationOf = (x: Item) => {
  const p = x.geoPoint || x.location || x.coordinates || x;
  return { lat: Number(p.latitude ?? p.lat), lng: Number(p.longitude ?? p.lng ?? p.lon) };
};
const distance = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const rad = (n: number) => n * Math.PI / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
};
const nearby = (x: Item, course: Course) => {
  const point = locationOf(x);
  return Number.isFinite(point.lat) && Number.isFinite(point.lng)
    && distance(point, { lat: course.latitude, lng: course.longitude }) <= 2000;
};
const sameName = (name: unknown, course: Course) => normalise(name).length >= 3 && normalise(name) === normalise(course.name);
// Providers list a resort's separate courses as, for example, "Warwickshire |
// Earls Course". Require an exact venue stem and verified nearby coordinates;
// do not accept arbitrary prefix/name similarity (e.g. North Warwickshire).
const sameVenue = (name: unknown, course: Course) => sameName(name, course)
  || sameName(String(name || '').split(/\s*\|\s*|\s+[–—]\s+/)[0], course);
const holeCounts = (x: Item): number[] => ['holes', 'hole_count', 'holeCount', 'holesCount', 'holes_count', 'number_of_holes', 'numberOfHoles', 'num_holes', 'numHoles']
  .flatMap(key => typeof x?.[key] === 'number' ? [x[key]] : typeof x?.[key] === 'string' && /^\d{1,2}(?:\s*holes?)?$/i.test(x[key].trim()) ? [Number(x[key].match(/^\d+/)[0])] : []);
const eighteen = (x: Item, requireCount = false) => { const counts = holeCounts(x); return (!requireCount || counts.length > 0) && counts.every(n => n === 18); };
const offersEighteen = (x: Item) => Array.isArray(x.courses) && x.courses.length
  ? x.courses.some((layout: Item) => eighteen(layout, true)) : eighteen(x);
const idsMatch = (x: Item, keys: string[], expected: string) => keys.every(key => x?.[key] == null || idOf(x[key]) === expected);
export const scorecardSelectionKey = (card: DiscoveredCard) => `${card.source_url}|${card.course_name}|${card.tee_name}`;
const valid = (holes: Hole[]) => holes.length === 18
  && new Set(holes.map(h => h.number)).size === 18
  && new Set(holes.map(h => h.stroke_index)).size === 18
  && holes.every(h => Number.isInteger(h.number) && h.number >= 1 && h.number <= 18
    && Number.isInteger(h.par) && h.par >= 3 && h.par <= 6
    && Number.isInteger(h.yards) && h.yards >= 30 && h.yards <= 1200
    && Number.isInteger(h.stroke_index) && h.stroke_index >= 1 && h.stroke_index <= 18);
const teeLabel = (tee: Item) => {
  const name = String(tee.name || tee.tee_name || tee.colour || tee.color || '').trim();
  const gender = String(tee.gender || tee.sex || tee.category || '').toLowerCase();
  return name + (/^(male|men|m)$/.test(gender) ? ' (men)' : /^(female|women|f)$/.test(gender) ? ' (women)' : '');
};
const mapHoles = (root: any): Hole[] => array(root, ['holes', 'scorecard', 'hole_data']).map(h => ({
  number: Number(h.hole ?? h.hole_number ?? h.number), par: Number(h.par ?? h.par_value),
  yards: Number(h.yards ?? h.yardage ?? h.length_yards),
  stroke_index: Number(h.stroke_index ?? h.si ?? h.handicap ?? h.hcp),
})).sort((a, b) => a.number - b.number);
const decodeEntities = (text: string) => text.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const decodeAstro = (x: any): any => Array.isArray(x)
  ? x[0] === 0 ? decodeAstro(x[1]) : x[0] === 1 ? (x[1] || []).map(decodeAstro) : x.map(decodeAstro)
  : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, decodeAstro(v)])) : x;

export async function findCourseScorecards(course: Course, options: Options = {}): Promise<Result> {
  const result: Result = { cards: [], warnings: [] };
  if (!normalise(course.name) || !Number.isFinite(course.latitude) || !Number.isFinite(course.longitude)
    || Math.abs(course.latitude) > 90 || Math.abs(course.longitude) > 180) {
    return { cards: [], warnings: ['Choose a course with a confirmed map location before finding its scorecard.'] };
  }
  const fetcher = options.fetcher || fetch;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), 11500);
  const abort = () => deadline.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) deadline.abort();
  const started = Date.now();
  async function request(url: string, init: RequestInit = {}, timeout = 5000): Promise<Response> {
    if (deadline.signal.aborted) throw new Error('Course lookup stopped');
    const target = new URL(url);
    if (!['uk-golf-course-data-api.p.rapidapi.com', '18birdies.com'].includes(target.hostname) || target.protocol !== 'https:') throw new Error('Unsupported course provider');
    const controller = new AbortController();
    const cancel = () => controller.abort();
    deadline.signal.addEventListener('abort', cancel, { once: true });
    if (deadline.signal.aborted) controller.abort();
    const clock = setTimeout(cancel, Math.min(timeout, Math.max(1, 11500 - (Date.now() - started))));
    let timedOut: (() => void) | undefined;
    try {
      const stopped = new Promise<never>((_, reject) => {
        timedOut = () => reject(new Error('Course provider timed out'));
        controller.signal.addEventListener('abort', timedOut, { once: true });
        if (controller.signal.aborted) timedOut();
      });
      return await Promise.race([stopped, (async () => {
        const response = await fetcher(url, { ...init, signal: controller.signal, redirect: 'error' });
        if (!response.ok) throw new Error(`Provider returned ${response.status}`);
        // Read the body while the timeout is still active, including slow streams.
        const reader = response.body?.getReader(), chunks: Uint8Array[] = [];
        let size = 0;
        if (reader) for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 3000000) { await reader.cancel(); throw new Error('Course response was too large'); }
          chunks.push(value);
        }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return new Response(bytes, { status: response.status, headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/json' } });
      })()]);
    } finally {
      clearTimeout(clock); deadline.signal.removeEventListener('abort', cancel);
      if (timedOut) controller.signal.removeEventListener('abort', timedOut);
    }
  }
  async function ukCards(): Promise<DiscoveredCard[]> {
    // A missing configured provider falls back to the public scorecard source.
    const key = options.apiKey || (typeof Deno !== 'undefined' ? Deno.env.get('UK_GOLF_API_KEY') : undefined);
    if (!key) return [];
    const headers = { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'uk-golf-course-data-api.p.rapidapi.com' };
    const get = async (path: string) => (await request(UK_HOST + path, { headers }, 2500)).json();
    const data = await get(`/clubs/nearby?lat=${encodeURIComponent(course.latitude)}&lng=${encodeURIComponent(course.longitude)}&radius_km=2`);
    // The nearby endpoint supplies the location constraint if a result omits
    // coordinates. If coordinates are present, check them independently.
    const clubs = array(data, ['clubs', 'results', 'data']).filter(c => {
      const p = locationOf(c);
      const noCoordinates = !Number.isFinite(p.lat) && !Number.isFinite(p.lng);
      return sameName(c.name || c.club_name, course) && (noCoordinates || nearby(c, course));
    });
    if (clubs.length !== 1) {
      if (clubs.length > 1) result.warnings.push('The scoring provider found more than one matching club; no club was selected automatically.');
      return [];
    }
    const club = clubs[0], clubId = idOf(club.id || club.club_id);
    if (!clubId) return [];
    const layouts = array(await get(`/clubs/${encodeURIComponent(clubId)}/courses`), ['courses', 'results', 'data'])
      .filter(c => eighteen(c, true));
    if (layouts.length > 4) {
      result.warnings.push('This club has several course layouts. Select the course explicitly before importing a scorecard.');
      return [];
    }
    const jobs: Array<() => Promise<DiscoveredCard | null>> = [];
    for (const layout of layouts) {
      const courseId = idOf(layout.id || layout.course_id);
      const tees = array(layout, ['tee_sets', 'tees', 'teeboxes', 'tee_boxes']);
      for (const tee of tees.slice(0, 12)) {
        const teeId = idOf(tee.id || tee.tee_id || tee.tee_set_id);
        if (!courseId || !teeId || !teeLabel(tee)) continue;
        jobs.push(async () => {
          const path = `/courses/${encodeURIComponent(courseId)}/scorecard?tee_id=${encodeURIComponent(teeId)}`;
          try {
            const payload = await get(path), root = payload?.data || payload;
            const card = root?.tee_set || root?.tee || root;
            if (!eighteen(root) || !eighteen(card) || !eighteen(root.course || {})) return null;
            if (!idsMatch(root, ['course_id', 'courseId', 'layout_id', 'layoutId'], courseId)
              || !idsMatch(card, ['course_id', 'courseId', 'layout_id', 'layoutId'], courseId)
              || !idsMatch(root.course || {}, ['id', 'course_id', 'courseId'], courseId)
              || !idsMatch(root, ['tee_id', 'teeId', 'tee_set_id', 'teeSetId'], teeId)
              || !idsMatch(card, ['tee_id', 'teeId', 'tee_set_id', 'teeSetId'], teeId)
              || !idsMatch(card, ['id'], teeId)) return null;
            const holes = mapHoles({ ...card, holes: root?.holes || card?.holes });
            if (!valid(holes)) return null;
            return { tee_name: teeLabel({ ...tee, ...card }), holes, source_url: UK_HOST + path,
              course_name: `${club.name || club.club_name}${layout.name || layout.course_name ? ' · ' + (layout.name || layout.course_name) : ''}` };
          } catch { return null; }
        });
      }
    }
    if (jobs.length > 16) {
      result.warnings.push('This venue has many course and tee combinations. Choose the exact course before importing.');
      return [];
    }
    // Tee requests are parallel, with a shared overall deadline.
    const cards = (await Promise.all(jobs.map(job => job()))).filter((c): c is DiscoveredCard => !!c);
    if (!cards.length) result.warnings.push('The UK scoring provider did not return a complete 18-hole card.');
    return cards;
  }
  async function birdiesCards(): Promise<DiscoveredCard[]> {
    const search = await request(BIRDIES_HOST + '/usercentral/api/course/searchPlaces', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; BarfordGolfScorecard/1.0)' },
      body: JSON.stringify({ key: normalise(course.name) }),
    });
    const seen = new Set<string>();
    const matches = array(await search.json(), ['clubCards']).map(c => c.clubBrief)
      .filter(c => c && sameVenue(c.name, course) && nearby(c, course) && offersEighteen(c))
      .filter(c => { const id = idOf(c.id); if (!id || seen.has(id)) return false; seen.add(id); return true; });
    if (!matches.length || matches.length > 4 || new Set(matches.map(c => normalise(c.name))).size !== matches.length) {
      result.warnings.push(matches.length ? 'Several indistinguishable nearby clubs match this course; choose the exact course before importing.' : 'No exact nearby 18-hole scorecard match was found. Hole positions can still be prepared separately.');
      return [];
    }
    async function readClub(match: Item): Promise<DiscoveredCard[]> {
    const clubId = idOf(match.id);
    if (!/^[a-zA-Z0-9-]+$/.test(clubId)) return [];
    const slug = String(match.name).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const url = `${BIRDIES_HOST}/golf-courses/club/${encodeURIComponent(clubId)}/${slug}`;
    const html = await (await request(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BarfordGolfScorecard/1.0)' } })).text();
    const encoded = html.match(/<astro-island[^>]*component-export="Scorecard"[^>]*props="([^"]+)"/);
    if (!encoded) throw new Error('Scorecard page format unavailable');
    const club = decodeAstro(JSON.parse(decodeEntities(encoded[1])))?.profile?.club;
    if (!club || !sameVenue(club.name, course) || normalise(club.name) !== normalise(match.name)
      || (club.id && idOf(club.id) !== clubId) || !offersEighteen(club)) throw new Error('Course identity could not be verified');
    const holes = Array.isArray(club.holes) ? club.holes : [], tees = Array.isArray(club.tees) ? club.tees : [];
    const layouts: Item[] = Array.isArray(club.courses) ? club.courses : [];
    const holeSets: Item[] = Array.isArray(club.holeSets) ? club.holeSets : [];
    // Explicit provider indexes preserve course ordering at multi-course venues.
    // Never assume that the first 18 holes belong to a selected layout.
    const choices: Array<{ name: string; indexes: number[]; tees: number[] }> = [];
    for (const layout of layouts) {
      if (!eighteen(layout, true) || !Array.isArray(layout.holeSetIndexes)) continue;
      const sets = layout.holeSetIndexes.map((i: number) => Number.isInteger(i) && i >= 0 ? holeSets[i] : null);
      if (!sets.length || sets.some((s: Item) => !s || !Array.isArray(s.holeIndexes) || !Array.isArray(s.teeIndexes))) continue;
      const indexes = sets.flatMap((s: Item) => s.holeIndexes);
      if (indexes.length !== 18 || new Set(indexes).size !== 18 || indexes.some((i: number) => !Number.isInteger(i) || i < 0 || i >= holes.length)) continue;
      choices.push({ name: layout.name || club.name, indexes, tees: tees.map((_: unknown, i: number) => i).filter((i: number) => sets.every((s: Item) => s.teeIndexes.includes(i))) });
    }
    if (!layouts.length && holes.length === 18) choices.push({ name: club.name, indexes: holes.map((_: unknown, i: number) => i), tees: tees.map((_: unknown, i: number) => i) });
    if (!choices.length) {
      result.warnings.push('The provider did not identify a complete 18-hole layout; no hole ordering was assumed.');
      return [];
    }
    const cards: DiscoveredCard[] = [];
    const excluded = new Map<string, string[]>();
    for (const choice of choices) for (const index of choice.tees) {
      const tee = tees[index];
      if (!['MALE', 'FEMALE'].includes(String(tee.gender).toUpperCase()) || !teeLabel(tee)) continue;
      const female = String(tee.gender).toUpperCase() === 'FEMALE';
      const mapped = choice.indexes.map((holeIndex: number, i: number) => { const h = holes[holeIndex]; return { number: i + 1, yards: Number(h.teeYardages?.[index]),
        par: Number(female ? h.ladiesPar : h.menPar), stroke_index: Number(female ? h.ladiesHandicap : h.menHandicap) }; });
      if (valid(mapped)) cards.push({ tee_name: teeLabel(tee), holes: mapped, source_url: url,
        course_name: club.name + (choice.name && normalise(choice.name) !== normalise(club.name) ? ' · ' + choice.name : '') });
      else excluded.set(choice.name, [...excluded.get(choice.name) || [], teeLabel(tee)]);
    }
    for (const [name, labels] of excluded) result.warnings.push(`${name}: ${labels.join(', ')} unavailable because the source scorecards contain missing, invalid or repeated values.`);
    if (!cards.length) result.warnings.push('The scorecard source did not contain valid par, yardage and stroke indexes for all 18 holes.');
    return cards;
    }
    const found = await Promise.allSettled(matches.map(readClub));
    if (found.some(x => x.status === 'rejected')) result.warnings.push('A course layout could not be loaded. Retry to check all layouts before choosing your tees.');
    return found.flatMap(x => x.status === 'fulfilled' ? x.value : []);
  }
  try {
    try { result.cards = await birdiesCards(); }
    catch { result.warnings.push('The primary scorecard service was unavailable; trying the UK scoring provider.'); }
    if (!result.cards.length && !deadline.signal.aborted) {
      try { result.cards = await ukCards(); }
      catch { result.warnings.push('Automatic scorecard lookup is temporarily unavailable. You can retry without losing the course map.'); }
    }
    const unique = new Map<string, DiscoveredCard[]>();
    for (const card of result.cards) { const key = scorecardSelectionKey(card); unique.set(key, [...unique.get(key) || [], card]); }
    result.cards = [...unique].flatMap(([key, group]) => {
      if (group.some(card => JSON.stringify(card.holes) !== JSON.stringify(group[0].holes))) {
        result.warnings.push('Conflicting scorecards were returned for the same course and tees; that choice was excluded.'); return [];
      }
      return [{ ...group[0], selection_key: key }];
    });
    if (result.cards.length > 1) result.warnings.push('Choose the course layout and tees being played before using this scorecard.');
    return result;
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}
