import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { prepareCourseGps } from '../supabase/functions/baseline-services/course-preparation.ts';
import { buildCourseMapping, CourseMappingError } from '../supabase/functions/baseline-services/course-mapping.ts';
import { completeCourseMap } from '../assets/js/hole-admin.js';

const f = JSON.parse(await readFile(new URL('./fixtures/leamington-course-source.json', import.meta.url)));
const mapping = async (course, options) => buildCourseMapping(course, f.elements, options?.scorecard);
const discovery = cards => ({ cards, warnings: [] });

test('An unavailable scorecard still produces usable GPS from real mapped geometry', async () => {
  const result = await prepareCourseGps(f.course, discovery([]), {}, mapping);
  assert.equal(result.status, 'ready');
  assert.equal(result.draft.source.setup_mode, 'gps_only');
  assert.equal(result.draft.source.validation.scorecard_order_confirmed, false);
  assert.equal(result.draft.source.validation.order_evidence, 'numbered_map_routes');
  assert.equal(result.draft.holes.length, 18);
  assert.ok(result.draft.holes.every(h => h.tee && h.green && h.par === null && h.yards === null && h.stroke_index === null));
  assert.equal(result.draft.tee_name, 'Mapped tee positions');
  assert.equal(completeCourseMap(result.draft), true, 'The frontend must accept independently verified GPS without a scorecard');
});

test('A unique Yellow mens scorecard is selected by the service in the first request', async () => {
  const cards = ['White (men)', 'Yellow (men)', 'Yellow (women)'].map(tee_name => ({ ...f.scorecard, tee_name }));
  const result = await prepareCourseGps(f.course, discovery(cards), {}, mapping);
  assert.equal(result.status, 'ready');
  assert.equal(result.draft.source.setup_mode, 'scorecard_and_gps');
  assert.equal(result.draft.tee_name, 'Yellow (men)');
  assert.equal(result.draft.source.validation.scorecard_order_confirmed, true);
  assert.ok(result.selected_key);
  const white = result.scorecards.find(c => c.tee_name === 'White (men)');
  const explicit = await prepareCourseGps(f.course, discovery(cards), { scorecard_key: white.key }, mapping);
  assert.equal(explicit.draft.tee_name, 'White (men)', 'The automatic default must never override an explicit choice');
});

test('A single course without a unique default tee still gets GPS automatically', async () => {
  const result = await prepareCourseGps(f.course, discovery(['Blue', 'Black'].map(tee_name => ({ ...f.scorecard, tee_name }))), {}, mapping);
  assert.equal(result.status, 'ready');
  assert.equal(result.draft.source.setup_mode, 'gps_only');
  assert.equal(result.draft.source.scorecard_status, 'not_selected');
  assert.equal(result.scorecards.length, 2, 'Tee choices remain available to add scorecard facts');
});

test('Different courses require a choice instead of silently picking the wrong 18 holes', async () => {
  let calls = 0;
  const result = await prepareCourseGps(f.course, discovery(['North', 'South'].map(course_name => ({ ...f.scorecard, course_name }))), {}, async () => { calls++; });
  assert.equal(result.status, 'choice_required');
  assert.equal(calls, 0);
});

test('Mapped course choices remain available even without any scorecards', async () => {
  const map = async (course, options) => {
    if (!course.layout_name) throw new CourseMappingError('COURSE_CHOICE_REQUIRED', 'Choose a layout', ['North', 'South']);
    assert.equal(course.layout_name, 'South');
    return mapping({ ...course, layout_name: '' }, options);
  };
  const initial = await prepareCourseGps(f.course, discovery([]), {}, map);
  assert.equal(initial.status, 'choice_required');
  assert.deepEqual(initial.layouts, ['North', 'South']);
  const selected = await prepareCourseGps(f.course, discovery([]), { layout_name: 'South' }, map);
  assert.equal(selected.status, 'ready');
  assert.equal(selected.selected_layout, 'South');
});

test('A known scorecard conflict cannot be hidden by dropping the scorecard', async () => {
  let calls = 0;
  const result = await prepareCourseGps(f.course, discovery([f.scorecard]), {}, async () => {
    calls++; throw new CourseMappingError('HOLE_ORDER_UNCONFIRMED', 'Hole order conflicts with the scorecard.');
  });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.error_code, 'HOLE_ORDER_UNCONFIRMED');
  assert.equal(result.draft, null);
  assert.equal(calls, 1);
});

test('A stale explicit tee is not replaced with a different layout', async () => {
  const result = await prepareCourseGps(f.course, discovery([]), { scorecard_key: 'no-longer-available' }, () => { throw new Error('Must not guess'); });
  assert.equal(result.status, 'choice_required');
  assert.equal(result.draft, null);
});

test('Missing real geometry remains unavailable with its specific error', async () => {
  const result = await prepareCourseGps(f.course, discovery([]), {}, async course => buildCourseMapping(course, []));
  assert.equal(result.status, 'unavailable');
  assert.equal(result.error_code, 'COURSE_BOUNDARY_UNCONFIRMED');
  assert.equal(result.draft, null);
});

// Real provider response reproducing Welcombe's missing tee-area evidence.
test('Welcombe prepares all 18 greens with explicit route references for holes 4, 12 and 18', async () => {
  const w = JSON.parse(await readFile(new URL('./fixtures/welcombe-course-source.json', import.meta.url)));
  const result = await prepareCourseGps(w.course, discovery([]), {}, async course => buildCourseMapping(course, w.elements));
  assert.equal(result.status, 'ready');
  assert.equal(result.draft.holes.length, 18);
  const validation = result.draft.source.validation;
  assert.equal(validation.tee_anchors, 15);
  assert.equal(validation.route_starts, 18);
  assert.equal(validation.green_anchors, 18);
  assert.deepEqual(validation.evidence.filter(e => e.start_evidence === 'numbered_route_start').map(e => e.number).sort((a,b)=>a-b), [4,12,18]);
  assert.ok(validation.evidence.every(e => e.green_feature_id));
  assert.ok(completeCourseMap(result.draft));
  const missingGreen = structuredClone(result.draft);
  missingGreen.source.validation.green_anchors = 17;
  assert.equal(completeCourseMap(missingGreen), false);
  const missingStart = structuredClone(result.draft);
  missingStart.source.validation.route_starts = 17;
  assert.equal(completeCourseMap(missingStart), false);
});
