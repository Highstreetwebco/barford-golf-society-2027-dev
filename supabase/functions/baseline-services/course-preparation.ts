import { CourseMappingError, prepareCourseMapping } from './course-mapping.ts';
import type { CourseInput } from './course-mapping.ts';
import type { DiscoveredCard } from './course-scorecard.ts';

type Discovery = { cards: DiscoveredCard[]; warnings: string[] };
type Selection = { scorecard_key?: string; layout_name?: string };
const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
  .map(n => n.toString(16).padStart(2, '0')).join('');

// The same preparation path is used for every venue. Scorecard availability
// enriches GPS; it must not prevent discovery of independently verified geometry.
export async function prepareCourseGps(course: CourseInput, discovery: Discovery, selection: Selection = {}, mapping = prepareCourseMapping) {
  const candidates = await Promise.all(discovery.cards.map(async card => ({
    key: await digest(JSON.stringify([card.source_url, card.course_name, card.tee_name])), card,
  })));
  const scorecards = candidates.map(({ key, card }) => ({ key, course_name: card.course_name, tee_name: card.tee_name }));
  const base = { scorecards, warnings: discovery.warnings, draft: null, layouts: [] as string[] };
  const courseNames = new Set(candidates.map(c => c.card.course_name.trim().toLowerCase()));
  let chosen = selection.scorecard_key ? candidates.find(c => c.key === selection.scorecard_key) : undefined;
  if (selection.scorecard_key && !chosen) {
    return { ...base, status: 'choice_required', message: 'The selected scorecard is no longer available. Choose the course and tees again, or select the course again to prepare GPS without it.' };
  }
  if (!chosen && !selection.layout_name) {
    if (candidates.length === 1) chosen = candidates[0];
    else if (courseNames.size === 1) {
      const yellow = candidates.filter(c => /^yellow(?:\s*\(men\))?$/i.test(c.card.tee_name.trim()));
      if (yellow.length === 1) chosen = yellow[0];
    } else if (courseNames.size > 1) {
      return { ...base, status: 'choice_required', message: 'This venue has more than one course. Choose the course and tees; GPS setup will continue automatically.' };
    }
  }
  const layoutName = chosen?.card.course_name || selection.layout_name || (courseNames.size === 1 ? candidates[0].card.course_name : '');
  try {
    const draft = await mapping({ ...course, tee_name: chosen?.card.tee_name || 'Mapped tee positions', layout_name: layoutName }, { scorecard: chosen?.card });
    if (draft.source.validation?.status !== 'verified' || draft.source.coverage.mapped !== 18) throw new Error('All 18 GPS holes must pass the position checks.');
    if (chosen) return {
      ...base, status: 'ready', selected_key: chosen.key,
      draft: { ...draft, source: { ...draft.source, setup_mode: 'scorecard_and_gps', selected_scorecard: { course_name: chosen.card.course_name, tee_name: chosen.card.tee_name, source_url: chosen.card.source_url } } },
      message: 'GPS is ready for all 18 holes and matched to the selected scorecard. Save the event to use it.',
    };
    return {
      ...base, status: 'ready', selected_layout: selection.layout_name || '',
      draft: { ...draft,
        // No tee-specific scorecard facts are invented from route lengths or
        // another tee. Hole View computes distances from the actual coordinates.
        holes: draft.holes.map(h => ({ ...h, par: null, yards: null, stroke_index: null })),
        source: { ...draft.source, setup_mode: 'gps_only', scorecard_status: candidates.length ? 'not_selected' : 'unavailable',
          coverage: { ...draft.source.coverage, par: 0, yards: 0, stroke_index: 0 } },
      },
      message: 'GPS is ready for all 18 numbered holes. Scorecard details are unavailable or not selected; live GPS distances still work. Save the event to use the layout.',
    };
  } catch (error) {
    if (error instanceof CourseMappingError && error.layouts.length) return {
      ...base, status: 'choice_required', layouts: error.layouts,
      message: 'This venue has more than one mapped course. Choose the layout below; GPS setup will continue automatically.',
    };
    return { ...base, status: 'unavailable', ...(chosen ? { selected_key: chosen.key } : {}),
      error_code: error instanceof CourseMappingError ? error.code : 'MAP_PROVIDER_UNAVAILABLE',
      message: error instanceof Error ? error.message : 'The GPS hole positions could not be verified for this course.',
    };
  }
}
