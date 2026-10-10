import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { mountHoleSetup, defaultScorecardKey } from '../assets/js/hole-admin.js';
import { buildCourseMapping } from '../supabase/functions/baseline-services/course-mapping.ts';
import { prepareCourseGps } from '../supabase/functions/baseline-services/course-preparation.ts';

const fixture = JSON.parse(await readFile(new URL('./fixtures/leamington-course-source.json', import.meta.url)));
const mapped = buildCourseMapping(fixture.course, fixture.elements, fixture.scorecard);
const course = { ...fixture.course, course_name: fixture.course.name };
const cards = ['White (men)', 'White (women)', 'Yellow (men)', 'Yellow (women)', 'Red (men)', 'Red (women)'].map((tee_name, i) => ({ key: String(i), course_name: course.name, tee_name }));
const ready = (value = mapped, choices = cards, key = '2') => ({ status: 'ready', draft: structuredClone(value), scorecards: choices, selected_key: key });
const choices = { status: 'choice_required', scorecards: cards };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

// Exercise async setup state without a browser or a real account/database.
function mount({ service = async (_, body) => body.scorecard_key ? ready() : choices, rpc, type = 'league' } = {}) {
  const nodes = new Map();
  for (const selector of ['[data-scorecard-choice]', '[name=course_layout_id]', '[data-course-preparation]', '[data-layout-status]', '[data-course-prepare]', '[data-preview-layout]', '[data-scorecard-field]', '[data-scorecard-warnings]', '[data-scorecard-warnings] p', '[data-map-source]']) nodes.set(selector, { value: '', textContent: '', hidden: false });
  const section = { querySelector: selector => { assert.ok(nodes.has(selector), selector); return nodes.get(selector); } };
  globalThis.document = { createElement: name => { assert.equal(name, 'section'); return section; } };
  const events = {};
  const form = { elements: { event_type: { value: type, addEventListener: (name, fn) => { events[name] = fn; } } }, querySelector: selector => { assert.equal(selector, '.actions.full'); return { before: value => assert.equal(value, section) }; } };
  const requests = [], saves = [];
  const b = {
    escape: value => value,
    service: async (action, body) => { requests.push({ action, ...body }); return service(action, body); },
    client: { rpc: async (name, { action, payload }) => {
      assert.equal(name, 'course_layout');
      if (rpc) return rpc(action, payload, saves);
      assert.equal(action, 'save');
      const saved = { ...payload, id: 'saved-' + (saves.length + 1) }; saves.push(saved);
      return { data: saved, error: null };
    } },
  };
  const setup = mountHoleSetup(form, b);
  return { setup, nodes, requests, saves, changeType(value) { form.elements.event_type.value = value; events.change(); } };
}

test('Yellow mens tees default only for a unique single-course match', () => {
  assert.equal(defaultScorecardKey(cards), '2');
  assert.equal(defaultScorecardKey([{ ...cards[0], tee_name: 'Yellow' }, cards[4]]), '0');
  assert.equal(defaultScorecardKey([cards[4]]), '4');
  assert.equal(defaultScorecardKey(cards.filter(c => c.tee_name !== 'Yellow (men)')), '');
  assert.equal(defaultScorecardKey([...cards, { ...cards[2], key: 'duplicate' }]), '');
  assert.equal(defaultScorecardKey([...cards, { ...cards[2], key: 'south', course_name: 'South course' }]), '');
  assert.equal(defaultScorecardKey([]), '');
});

test('Selecting a course prepares all 18 GPS holes and event save persists them once', async () => {
  const f = mount();
  await f.setup.setCourse(course);
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].scorecard_key, '2');
  assert.ok(f.requests.every(r => r.map_format === 3), 'Every map request identifies the supported response format');
  assert.equal(f.nodes.get('[data-scorecard-choice]').value, '2');
  assert.equal(f.nodes.get('[data-course-prepare]').hidden, true);
  assert.equal(f.saves.length, 0, 'Discovery alone must not persist a layout');
  assert.equal(await f.setup.layoutId(), 'saved-1');
  assert.equal(f.saves[0].holes.length, 18);
  assert.ok(f.saves[0].holes.every(h => h.reviewed));
  assert.equal(f.saves[0].source.confirmation_method, 'event_save');
  assert.equal(await f.setup.layoutId(), 'saved-1');
  assert.equal(f.saves.length, 1, 'Retrying the event write reuses its saved GPS');
});

test('Saving an event waits for its in-flight GPS lookup', async () => {
  const held = deferred(), f = mount({ service: () => held.promise });
  const lookup = f.setup.setCourse(course);
  let finished = false;
  const saving = f.setup.layoutId().then(id => { finished = true; return id; });
  await Promise.resolve();
  assert.equal(finished, false);
  assert.equal(f.saves.length, 0);
  held.resolve(ready());
  await lookup;
  assert.equal(await saving, 'saved-1');
});

test('Existing events without GPS prepare automatically', async () => {
  const f = mount();
  await f.setup.setEvent({ ...course, course_layout_id: null });
  assert.equal(f.requests.length, 2);
  assert.equal(await f.setup.layoutId(), 'saved-1');
});

test('Valid linked maps load without another provider lookup or map write', async () => {
  const linked = { ...mapped, id: 'existing', holes: mapped.holes.map(h => ({ ...h, reviewed: true })) };
  const f = mount({ rpc: async action => { assert.equal(action, 'get'); return { data: linked }; } });
  await f.setup.setEvent({ ...course, course_layout_id: 'existing' });
  assert.equal(await f.setup.layoutId(), 'existing');
  assert.equal(f.requests.length, 0);
});

test('An incomplete linked map triggers fresh preparation', async () => {
  const f = mount({ rpc: async () => ({ data: { ...mapped, holes: [] } }) });
  await f.setup.setEvent({ ...course, course_layout_id: 'old' });
  assert.equal(f.requests.length, 2);
  assert.equal(f.nodes.get('[data-preview-layout]').hidden, false);
});

test('A linked map read failure blocks saving instead of deleting the GPS link', async () => {
  const f = mount({ rpc: async () => ({ error: new Error('Read failed') }) });
  await f.setup.setEvent({ ...course, course_layout_id: 'existing' });
  await assert.rejects(f.setup.layoutId(), /saved maps could not load/);
  assert.equal(f.requests.length, 0);
});

test('A late result from another course cannot replace the current map', async () => {
  const held = deferred();
  const f = mount({ service: (_, body) => body.place_id === 'old-course' ? held.promise : ready() });
  const oldLookup = f.setup.setCourse({ ...course, place_id: 'old-course' });
  await f.setup.setCourse(course);
  held.resolve(ready({ ...mapped, place_id: 'old-course' })); await oldLookup;
  await f.setup.layoutId();
  assert.equal(f.saves[0].place_id, course.place_id);
});

test('Social events ignore pending GPS and restart preparation when changed back to golf', async () => {
  const held = deferred(); let requests = 0;
  const f = mount({ service: () => ++requests === 1 ? held.promise : ready() });
  const lookup = f.setup.setCourse(course);
  f.changeType('social');
  held.resolve(ready()); await lookup;
  assert.equal(await f.setup.layoutId(), null);
  assert.equal(f.saves.length, 0);
  f.changeType('league');
  assert.equal(await f.setup.layoutId(), 'saved-1');
  assert.equal(requests, 2);
});

test('Ambiguous courses require selection and respect an explicit non-default tee', async () => {
  const multi = [...cards, { key: 'south-white', course_name: 'South course', tee_name: 'White' }];
  const f = mount({ service: (_, body) => body.scorecard_key ? ready({ ...mapped, tee_name: 'White' }, multi, body.scorecard_key) : { status: 'choice_required', scorecards: multi } });
  await f.setup.setCourse(course);
  assert.equal(f.requests.length, 1);
  await assert.rejects(f.setup.layoutId(), /Choose the course and tees/);
  const select = f.nodes.get('[data-scorecard-choice]');
  select.value = 'south-white'; select.onchange();
  await f.setup.layoutId();
  assert.equal(f.requests[1].scorecard_key, 'south-white');
  assert.equal(f.saves[0].tee_name, 'White');
});

test('Map save failure reaches event save; a retry preserves and saves the prepared map', async () => {
  let attempts = 0;
  const f = mount({ rpc: async (_, payload, saves) => {
    if (++attempts === 1) return { error: new Error('Write failed') };
    const saved = { ...payload, id: 'retried' }; saves.push(saved); return { data: saved };
  } });
  await f.setup.setCourse(course);
  await assert.rejects(f.setup.layoutId(), /Write failed/);
  assert.equal(await f.setup.layoutId(), 'retried');
  assert.equal(f.saves.length, 1);
});

test('Unavailable and malformed maps never save partial GPS', async () => {
  for (const reply of [{ status: 'unavailable' }, ready({ ...mapped, holes: mapped.holes.slice(0, 17) })]) {
    const f = mount({ service: async () => reply });
    await f.setup.setCourse(course);
    assert.equal(await f.setup.layoutId(), null);
    assert.equal(f.saves.length, 0);
    assert.equal(f.nodes.get('[data-course-prepare]').hidden, false);
  }
});

test('GPS without a scorecard saves and reloads for a new event', async () => {
  const reply = await prepareCourseGps(fixture.course, { cards: [], warnings: [] }, {}, async course => buildCourseMapping(course, fixture.elements));
  const f = mount({ service: async () => reply });
  await f.setup.setCourse(course);
  assert.equal(await f.setup.layoutId(), 'saved-1');
  assert.ok(f.saves[0].holes.every(h => h.reviewed && h.yards === null && h.stroke_index === null));
  const loaded = mount({ rpc: async () => ({ data: f.saves[0] }) });
  await loaded.setup.setEvent({ ...course, course_layout_id: 'saved-1' });
  assert.equal(await loaded.setup.layoutId(), 'saved-1');
  assert.equal(loaded.requests.length, 0);
});

test('Choosing an OSM course layout automatically resumes GPS without a scorecard', async () => {
  const reply = await prepareCourseGps(fixture.course, { cards: [], warnings: [] }, {}, async course => buildCourseMapping(course, fixture.elements));
  const f = mount({ service: async (_, body) => body.layout_name ? { ...reply, selected_layout: body.layout_name } : { status: 'choice_required', scorecards: [], layouts: ['North', 'South'] } });
  await f.setup.setCourse(course);
  await assert.rejects(f.setup.layoutId(), /Choose the course/);
  const select = f.nodes.get('[data-scorecard-choice]');
  select.value = 'layout:South'; select.onchange();
  assert.equal(await f.setup.layoutId(), 'saved-1');
  assert.equal(f.requests[1].layout_name, 'South');
  assert.equal(f.requests[1].scorecard_key, undefined);
});
