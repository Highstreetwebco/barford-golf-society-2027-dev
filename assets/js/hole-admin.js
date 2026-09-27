import { openHolePicker } from './hole-view.js?v=2027-green-finder-test-2';

const point = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
export function completeCourseMap(layout) {
  const check = layout?.source?.validation;
  if (check?.status !== 'verified' || check.mapped !== 18 || check.tee_anchors !== 18 || check.green_anchors !== 18 || layout.holes?.length !== 18) return false;
  const numbers = new Set(), indexes = new Set(), greens = new Set();
  for (const h of layout.holes) {
    if (!Number.isInteger(h.number) || h.number < 1 || h.number > 18 || numbers.has(h.number) || !point(h.tee) || !point(h.green)) return false;
    if (h.tee.lat === h.green.lat && h.tee.lng === h.green.lng) return false;
    if (!Number.isInteger(h.par) || h.par < 3 || h.par > 6 || !Number.isInteger(h.yards) || h.yards < 30 || h.yards > 1200 || !Number.isInteger(h.stroke_index) || h.stroke_index < 1 || h.stroke_index > 18 || indexes.has(h.stroke_index)) return false;
    numbers.add(h.number); indexes.add(h.stroke_index); greens.add(`${h.green.lat},${h.green.lng}`);
  }
  return greens.size === 18;
}
function courseDetails(value) {
  if (!value) return null;
  const name = typeof value.displayName === 'string' ? value.displayName : value.displayName?.text;
  return { place_id: value.place_id || (value.displayName ? value.id : null), name: name || value.course_name || '', address: value.formattedAddress || value.address || '' };
}
async function action(b, name, payload = {}) {
  const { data, error } = await b.client.rpc('course_layout', { action: name, payload });
  if (error) throw error;
  return data;
}
export function mountHoleSetup(form, b) {
  const section = document.createElement('section');
  section.className = 'full hole-setup';
  section.innerHTML = `<h3>Course hole maps</h3><p>Course search finds the available scorecards and matches numbered holes to mapped tee and green areas. A map is offered only when all 18 holes pass the checks.</p><input type="hidden" name="course_layout_id"><label data-scorecard-field hidden>Course and tees<select data-scorecard-choice><option value="">Choose the course and tees</option></select></label><details data-scorecard-warnings hidden><summary>Some course or tee options are unavailable</summary><p class="muted"></p></details><p data-course-preparation role="status">Choose the course above to find its hole maps.</p><p data-layout-status role="status"></p><div class="actions"><button type="button" class="secondary" data-course-prepare disabled>Find hole positions</button><button type="button" class="secondary" data-preview-layout hidden>Preview hole maps</button><button type="button" data-confirm-maps hidden>Confirm hole maps</button></div><p class="muted" data-map-source hidden></p>`;
  form.querySelector('.actions.full').before(section);
  const $ = selector => section.querySelector(selector), select = $('[data-scorecard-choice]'), hidden = $('[name=course_layout_id]'), message = $('[data-course-preparation]'), status = $('[data-layout-status]');
  let course = null, draft = null, confirmed = null, cards = [], key = '', sequence = 0, busy = false, loadFailed = false;
  const social = () => form.elements.event_type.value === 'social';
  function render() {
    section.hidden = social();
    select.disabled = busy;
    $('[data-course-prepare]').disabled = busy || !course?.place_id;
    $('[data-course-prepare]').textContent = busy ? 'Finding hole positions…' : 'Find hole positions';
    $('[data-preview-layout]').hidden = !draft;
    $('[data-preview-layout]').disabled = busy;
    $('[data-confirm-maps]').hidden = !draft || !!confirmed;
    $('[data-confirm-maps]').disabled = busy;
    $('[data-scorecard-field]').hidden = cards.length < 2;
    status.textContent = confirmed ? 'All 18 hole maps confirmed. Save the event to use them.' : draft ? 'All 18 tee and green positions matched. Preview the maps, then confirm them for this event.' : '';
    const source = $('[data-map-source]');
    source.hidden = !draft;
    source.textContent = draft ? `${draft.source.attribution || 'OpenStreetMap'} · Matched to physical tee and green areas. The mapped tee is a reference position; the map source does not confirm tee colours. Live GPS distances use the player’s location.` : '';
  }
  function clear() {
    draft = confirmed = null; hidden.value = ''; status.textContent = '';
  }
  function reset(value = null) {
    sequence++; busy = false; loadFailed = false; course = courseDetails(value);
    clear(); cards = []; key = ''; $('[data-scorecard-warnings]').hidden = true; select.innerHTML = '<option value="">Choose the course and tees</option>';
    message.textContent = course?.place_id ? 'Find fresh hole positions for this course. Earlier incomplete layouts will not be reused.' : 'Choose the course above to find its hole maps.';
    render();
  }
  function fillChoices(choices, selectedKey) {
    cards = (choices || []).filter(card => typeof card.key === 'string' && card.key && card.course_name && card.tee_name);
    select.innerHTML = '<option value="">Choose the course and tees</option>' + cards.map(card => `<option value="${b.escape(card.key)}">${b.escape(card.course_name)} · ${b.escape(card.tee_name)}</option>`).join('');
    key = cards.some(card => card.key === selectedKey) ? selectedKey : '';
    select.value = key;
  }
  async function prepare(selectedKey = key) {
    if (!course?.place_id || social()) return;
    const token = ++sequence, requested = course.place_id;
    clear(); busy = true; loadFailed = false;
    message.textContent = selectedKey ? 'Matching this course and scorecard to its tee and green areas…' : 'Finding the course and available tees…';
    render();
    try {
      const result = await b.service('prepare_course', { place_id: requested, ...(selectedKey ? { scorecard_key: selectedKey } : {}) });
      if (token !== sequence || social()) return;
      fillChoices(result.scorecards, result.selected_key || selectedKey);
      const warnings = (result.warnings || []).filter(text => /unavailable because|invalid|excluded|could not be loaded/i.test(text));
      $('[data-scorecard-warnings]').hidden = result.status === 'ready' || !warnings.length;
      $('[data-scorecard-warnings] p').textContent = warnings.join(' ');
      if (result.status === 'ready') {
        if (!completeCourseMap(result.draft) || result.draft.place_id !== requested) throw new Error('The returned course map did not pass all 18 hole checks. No map has been created.');
        draft = result.draft;
        message.textContent = result.message || `Found all 18 holes for ${draft.name} · ${draft.tee_name}.`;
      } else if (result.status === 'choice_required') {
        message.textContent = result.message || 'Choose the course and tees below. Different courses at the same club must be matched separately.';
      } else {
        message.textContent = result.message || 'Accurate tee and green positions could not be confirmed for all 18 holes. No GPS layout has been created.';
      }
    } catch (error) {
      if (token === sequence) message.textContent = `${error.message || 'Course lookup could not finish.'} No GPS layout has been created.`;
    } finally { if (token === sequence) { busy = false; render(); } }
  }
  select.onchange = () => { key = select.value; clear(); if (key) prepare(key); else { sequence++; busy = false; message.textContent = 'Choose the course and tees to find its hole positions.'; render(); } };
  $('[data-course-prepare]').onclick = () => prepare();
  $('[data-preview-layout]').onclick = () => {
    if (draft && !busy) openHolePicker({ name: `${draft.name} · ${draft.tee_name}` }, b, draft);
  };
  $('[data-confirm-maps]').onclick = async () => {
    if (busy || social() || !completeCourseMap(draft)) return;
    const token = sequence, current = structuredClone(draft);
    busy = true; message.textContent = 'Saving the confirmed hole maps…'; render();
    try {
      const payload = { name: current.name, tee_name: current.tee_name, holes: current.holes.map(h => ({ ...h, reviewed: true })), place_id: current.place_id, center: current.center, address: current.address, source: { ...current.source, confirmed_at: new Date().toISOString() } };
      const saved = await action(b, 'save', payload);
      if (token !== sequence || social()) return;
      if (!saved?.id || !completeCourseMap(saved)) throw new Error('The confirmed maps could not be verified after saving. Please retry.');
      confirmed = saved; draft = saved; hidden.value = saved.id;
      message.textContent = `Confirmed ${saved.name} · ${saved.tee_name}.`;
    } catch (error) { if (token === sequence) message.textContent = error.message; }
    finally { if (token === sequence) { busy = false; render(); } }
  };
  form.elements.event_type.addEventListener('change', () => {
    if (social()) { sequence++; busy = false; clear(); message.textContent = 'Social events do not need hole maps.'; }
    else if (!draft) message.textContent = course?.place_id ? 'Find hole positions for the selected course.' : 'Choose the course above to find its hole maps.';
    render();
  });
  return {
    layoutId() {
      if (social()) return null;
      if (loadFailed) throw new Error('The event’s saved maps could not load. Select the event again or find fresh hole positions before saving.');
      if (busy) throw new Error('The course holes are still being checked. Please wait for the lookup to finish.');
      if (draft && !confirmed) throw new Error('Confirm the hole maps before saving this event. You can preview all 18 holes first.');
      return confirmed?.id || null;
    },
    async setCourse(value) { reset(value); if (course?.place_id && !social()) await prepare(); },
    async setEvent(value) {
      reset(value);
      if (!value?.course_layout_id || social()) return;
      const token = sequence; busy = true; message.textContent = 'Loading this event’s confirmed maps…'; render();
      try {
        const linked = await action(b, 'get', { id: value.course_layout_id });
        if (token !== sequence) return;
        if (completeCourseMap(linked) && linked.place_id === course?.place_id && linked.holes.every(h => h.reviewed)) {
          confirmed = draft = linked; hidden.value = linked.id;
          message.textContent = `Confirmed ${linked.name} · ${linked.tee_name}.`;
        } else message.textContent = 'This event’s previous map was incomplete or unverified. Find fresh hole positions before adding GPS.';
      } catch (error) { if (token === sequence) { loadFailed = true; message.textContent = `The course maps could not load: ${error.message}`; } }
      finally { if (token === sequence) { busy = false; render(); } }
    }
  };
}
