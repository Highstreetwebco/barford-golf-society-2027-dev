import { openHolePicker } from './hole-view.js?v=2027-auto-gps-1';

const point = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
export function completeCourseMap(layout) {
  const check = layout?.source?.validation;
  if (check?.status !== 'verified' || check.mapped !== 18 || check.tee_anchors !== 18 || check.green_anchors !== 18 || layout.holes?.length !== 18) return false;
  const gpsOnly = layout.source.setup_mode === 'gps_only';
  if (gpsOnly && (check.scorecard_order_confirmed !== false || check.order_evidence !== 'numbered_map_routes')) return false;
  const numbers = new Set(), indexes = new Set(), greens = new Set(), tees = new Set();
  for (const h of layout.holes) {
    if (!Number.isInteger(h.number) || h.number < 1 || h.number > 18 || numbers.has(h.number) || !point(h.tee) || !point(h.green)) return false;
    if (h.tee.lat === h.green.lat && h.tee.lng === h.green.lng) return false;
    if (gpsOnly) {
      if (h.par !== null || h.yards !== null || h.stroke_index !== null) return false;
    } else if (!Number.isInteger(h.par) || h.par < 3 || h.par > 6 || !Number.isInteger(h.yards) || h.yards < 30 || h.yards > 1200 || !Number.isInteger(h.stroke_index) || h.stroke_index < 1 || h.stroke_index > 18 || indexes.has(h.stroke_index)) return false;
    numbers.add(h.number); indexes.add(h.stroke_index); greens.add(`${h.green.lat},${h.green.lng}`); tees.add(`${h.tee.lat},${h.tee.lng}`);
  }
  return greens.size === 18 && tees.size === 18;
}
function courseDetails(value) {
  if (!value) return null;
  const name = typeof value.displayName === 'string' ? value.displayName : value.displayName?.text;
  return { place_id: value.place_id || (value.displayName ? value.id : null), name: name || value.course_name || '', address: value.formattedAddress || value.address || '' };
}
export function defaultScorecardKey(cards) {
  if (cards.length === 1) return cards[0].key;
  const names = new Set(cards.map(card => card.course_name.trim().toLowerCase()));
  if (names.size !== 1) return '';
  const yellow = cards.filter(card => /^yellow(?:\s*\(men\))?$/i.test(card.tee_name.trim()));
  return yellow.length === 1 ? yellow[0].key : '';
}
async function action(b, name, payload = {}) {
  const { data, error } = await b.client.rpc('course_layout', { action: name, payload });
  if (error) throw error;
  return data;
}
export function mountHoleSetup(form, b) {
  const section = document.createElement('section');
  section.className = 'full hole-setup';
  section.innerHTML = `<h3>Course hole maps</h3><p>Select a course above. Its GPS hole layout is prepared automatically and saved with the event. Scorecard details are added when available.</p><input type="hidden" name="course_layout_id"><label data-scorecard-field hidden>Course layout and tees<select data-scorecard-choice><option value="">Choose the course and tees</option></select></label><details data-scorecard-warnings hidden><summary>Some course or tee options are unavailable</summary><p class="muted"></p></details><p data-course-preparation role="status">Choose the course above to set up GPS automatically.</p><p data-layout-status role="status"></p><div class="actions"><button type="button" class="secondary" data-course-prepare hidden>Retry GPS lookup</button><button type="button" class="secondary" data-preview-layout hidden>Preview hole maps</button></div><p class="muted" data-map-source hidden></p>`;
  form.querySelector('.actions.full').before(section);
  const $ = selector => section.querySelector(selector), select = $('[data-scorecard-choice]'), hidden = $('[name=course_layout_id]'), message = $('[data-course-preparation]'), status = $('[data-layout-status]');
  let course = null, draft = null, confirmed = null, cards = [], layouts = [], key = '', layoutName = '', sequence = 0, busy = false, loadFailed = false, needsChoice = false, pending = Promise.resolve();
  const social = () => form.elements.event_type.value === 'social';
  function render() {
    section.hidden = social();
    select.disabled = busy;
    $('[data-course-prepare]').disabled = busy || !course?.place_id;
    $('[data-course-prepare]').hidden = busy || !course?.place_id || !!draft || needsChoice;
    $('[data-preview-layout]').hidden = !draft;
    $('[data-preview-layout]').disabled = busy;
    $('[data-scorecard-field]').hidden = cards.length < 2 && layouts.length < 2;
    status.textContent = draft ? `GPS ready for all 18 holes · ${draft.name} · ${draft.tee_name}. ${confirmed ? 'Linked when you save the event.' : 'Saves automatically with the event. Preview is optional.'}` : '';
    const source = $('[data-map-source]');
    source.hidden = !draft;
    source.textContent = draft ? `${draft.source.attribution || 'OpenStreetMap'} · Matched to physical tee and green areas. ${draft.source.setup_mode === 'gps_only' ? 'Hole numbers follow the mapped course; scorecard details are not verified. ' : ''}The mapped tee is a reference position; the map source does not confirm tee colours. Live GPS distances use the player’s location.` : '';
  }
  function clear() {
    draft = confirmed = null; hidden.value = ''; status.textContent = '';
  }
  function reset(value = null) {
    sequence++; busy = false; loadFailed = false; needsChoice = false; pending = Promise.resolve(); course = courseDetails(value);
    clear(); cards = []; layouts = []; key = layoutName = ''; $('[data-scorecard-warnings]').hidden = true; select.innerHTML = '<option value="">Choose the course and tees</option>';
    message.textContent = course?.place_id ? 'Preparing GPS for this course…' : 'Choose the course above to set up GPS automatically.';
    render();
  }
  function fillChoices(choices, selectedKey, mappedLayouts = [], selectedLayout = '') {
    cards = (choices || []).filter(card => typeof card.key === 'string' && card.key && card.course_name && card.tee_name);
    layouts = mappedLayouts.length ? mappedLayouts.filter(name => typeof name === 'string' && name.trim()) : selectedLayout ? layouts : [];
    select.innerHTML = '<option value="">Choose the course and tees</option>' + cards.map(card => `<option value="${b.escape(card.key)}">${b.escape(card.course_name)} · ${b.escape(card.tee_name)}</option>`).join('') + layouts.map(name => `<option value="layout:${b.escape(encodeURIComponent(name))}">${b.escape(name)} · GPS layout</option>`).join('');
    key = cards.some(card => card.key === selectedKey) ? selectedKey : '';
    layoutName = layouts.includes(selectedLayout) ? selectedLayout : '';
    select.value = key || (layoutName ? 'layout:' + encodeURIComponent(layoutName) : '');
  }
  function prepare(selectedKey = key, selectedLayout = layoutName) {
    pending = discover(selectedKey, selectedLayout);
    return pending;
  }
  async function discover(selectedKey, selectedLayout) {
    if (!course?.place_id || social()) return;
    const token = ++sequence, requested = course.place_id;
    clear(); busy = true; loadFailed = false; needsChoice = false;
    message.textContent = selectedKey ? 'Matching this course and scorecard to its tee and green areas…' : 'Finding the course and available tees…';
    render();
    try {
      let result = await b.service('prepare_course', { place_id: requested, ...(selectedKey ? { scorecard_key: selectedKey } : {}), ...(selectedLayout ? { layout_name: selectedLayout } : {}) });
      if (token !== sequence || social()) return;
      if (result.status === 'choice_required' && !selectedKey && !selectedLayout) {
        fillChoices(result.scorecards, '', result.layouts);
        const automaticKey = defaultScorecardKey(cards);
        if (automaticKey) {
          selectedKey = key = automaticKey; select.value = key;
          message.textContent = `Preparing GPS automatically for ${cards.find(card => card.key === key).tee_name}…`;
          render();
          result = await b.service('prepare_course', { place_id: requested, scorecard_key: key });
        }
      }
      if (token !== sequence || social()) return;
      fillChoices(result.scorecards, result.selected_key || selectedKey, result.layouts, result.selected_layout || selectedLayout);
      const warnings = (result.warnings || []).filter(text => /unavailable because|invalid|excluded|could not be loaded/i.test(text));
      $('[data-scorecard-warnings]').hidden = result.status === 'ready' || !warnings.length;
      $('[data-scorecard-warnings] p').textContent = warnings.join(' ');
      if (result.status === 'ready') {
        if (!completeCourseMap(result.draft) || result.draft.place_id !== requested) throw new Error('The returned course map did not pass all 18 hole checks. No map has been created.');
        draft = result.draft;
        message.textContent = draft.source.setup_mode === 'gps_only' ? 'All 18 GPS holes are ready. Scorecard details are unavailable or not selected, but live GPS distances will work.' : 'All 18 numbered holes match the selected scorecard and mapped tee and green areas.';
      } else if (result.status === 'choice_required') {
        needsChoice = true;
        message.textContent = result.message || 'Choose the course and tees below. Different courses at the same club must be matched separately.';
      } else {
        message.textContent = result.message || 'Accurate tee and green positions could not be confirmed for all 18 holes. No GPS layout has been created.';
      }
    } catch (error) {
      if (token === sequence) message.textContent = `${error.message || 'Course lookup could not finish.'} No GPS layout has been created.`;
    } finally { if (token === sequence) { busy = false; render(); } }
  }
  select.onchange = () => {
    const value = select.value;
    key = value.startsWith('layout:') ? '' : value;
    layoutName = value.startsWith('layout:') ? decodeURIComponent(value.slice(7)) : '';
    clear();
    if (key || layoutName) prepare(key, layoutName);
    else { sequence++; busy = false; needsChoice = true; pending = Promise.resolve(); message.textContent = 'Choose the course and tees to prepare GPS automatically.'; render(); }
  };
  $('[data-course-prepare]').onclick = () => prepare();
  $('[data-preview-layout]').onclick = () => {
    if (draft && !busy) openHolePicker({ name: `${draft.name} · ${draft.tee_name}` }, b, draft);
  };
  async function saveLayout() {
    if (!completeCourseMap(draft)) throw new Error('All 18 GPS holes must pass the checks before saving.');
    const token = sequence, current = structuredClone(draft);
    busy = true; message.textContent = 'Saving GPS hole positions with the event…'; render();
    try {
      const payload = { name: current.name, tee_name: current.tee_name, holes: current.holes.map(h => ({ ...h, reviewed: true })), place_id: current.place_id, center: current.center, address: current.address, source: { ...current.source, confirmed_at: new Date().toISOString(), confirmation_method: 'event_save' } };
      const saved = await action(b, 'save', payload);
      if (token !== sequence || social()) throw new Error('The course changed while GPS was saving. Save the event again.');
      if (!saved?.id || !completeCourseMap(saved) || saved.place_id !== current.place_id || !saved.holes.every(h => h.reviewed)) throw new Error('The GPS maps could not be verified after saving. Please retry.');
      confirmed = saved; draft = saved; hidden.value = saved.id;
      message.textContent = `GPS saved for ${saved.name} · ${saved.tee_name}.`;
      return saved.id;
    } catch (error) { if (token === sequence) message.textContent = error.message; throw error; }
    finally { if (token === sequence) { busy = false; render(); } }
  }
  form.elements.event_type.addEventListener('change', () => {
    if (social()) { sequence++; busy = false; clear(); message.textContent = 'Social events do not need hole maps.'; }
    else if (!draft && course?.place_id) prepare();
    render();
  });
  return {
    async layoutId() {
      if (social()) return null;
      await pending;
      if (loadFailed) throw new Error('The event’s saved maps could not load. Select the event again or find fresh hole positions before saving.');
      if (busy) throw new Error('The course holes are still being checked. Please wait for the lookup to finish.');
      if (needsChoice) throw new Error('Choose the course and tees so GPS can be prepared for the correct holes.');
      if (draft && !confirmed) return saveLayout();
      return confirmed?.id || null;
    },
    async setCourse(value) { reset(value); if (course?.place_id && !social()) await prepare(); },
    setEvent(value) {
      reset(value);
      if (social() || !course?.place_id) return Promise.resolve();
      if (!value?.course_layout_id) return prepare();
      pending = loadEvent(value);
      return pending;
    }
  };
  async function loadEvent(value) {
      const token = sequence; busy = true; message.textContent = 'Loading this event’s confirmed maps…'; render();
      try {
        const linked = await action(b, 'get', { id: value.course_layout_id });
        if (token !== sequence) return;
        if (completeCourseMap(linked) && linked.place_id === course?.place_id && linked.holes.every(h => h.reviewed)) {
          confirmed = draft = linked; hidden.value = linked.id;
          message.textContent = `GPS loaded for ${linked.name} · ${linked.tee_name}.`;
        } else await prepare();
      } catch (error) { if (token === sequence) { loadFailed = true; message.textContent = `The course maps could not load: ${error.message}`; } }
      finally { if (token === sequence) { busy = false; render(); } }
  }
}
