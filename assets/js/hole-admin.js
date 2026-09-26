import { createHoleMap } from './hole-map.js?v=2027-holes-1';
import { openHolePicker } from './hole-view.js?v=2027-event-setup-1';

const points = ['tee', 'green', 'front', 'back', 'dogleg'];
const labels = { tee: 'Tee', green: 'Green centre', front: 'Green front', back: 'Green back', dogleg: 'Dogleg / corner' };
const blankHole = number => ({ number, par: null, yards: null, stroke_index: null, tee: null, green: null, front: null, back: null, dogleg: null, reviewed: false });
async function action(b, name, payload = {}) {
  const { data, error } = await b.client.rpc('course_layout', { action: name, payload });
  if (error) throw error;
  return data;
}

function courseDetails(value) {
  if (!value) return null;
  const name = typeof value.displayName === 'string' ? value.displayName : value.displayName?.text;
  const latitude = value.location?.latitude ?? value.latitude;
  const longitude = value.location?.longitude ?? value.longitude;
  return { place_id: value.place_id || (value.displayName ? value.id : null) || null, name: name || value.course_name || value.name || '', address: value.formattedAddress || value.address || '', latitude: latitude == null || latitude === '' ? null : Number(latitude), longitude: longitude == null || longitude === '' ? null : Number(longitude) };
}
function sameCourse(a, b) {
  if (!a || !b) return false;
  if (a.place_id && b.place_id) return a.place_id === b.place_id;
  return a.name === b.name && a.latitude === b.latitude && a.longitude === b.longitude;
}
export function mergePreparedHoles(existing = [], discovered = []) {
  return Array.from({ length: 18 }, (_, i) => {
    const old = existing.find(h => Number(h.number) === i + 1), fresh = discovered.find(h => Number(h.number) === i + 1);
    if (old?.reviewed) return structuredClone(old);
    const result = { ...blankHole(i + 1), ...old, reviewed: false };
    for (const key of ['par', 'yards', 'stroke_index', ...points]) if (result[key] == null && fresh?.[key] != null) result[key] = structuredClone(fresh[key]);
    return result;
  });
}
const mappedCount = layout => (layout?.holes || []).filter(h => h.tee && h.green).length;
const checkedCount = layout => layout?.ready_count ?? (layout?.holes || []).filter(h => h.reviewed).length;
function boundedSource(source) {
  if (!source) return source;
  const result = structuredClone(source);
  // Saved provenance has a 24 KiB limit. A large list of discovered tee cards
  // must not prevent the prepared holes themselves from being saved.
  while (result.scorecards?.length && new TextEncoder().encode(JSON.stringify(result)).length > 23500) result.scorecards.pop();
  return result;
}
const layoutPayload = layout => ({ id: layout.id, revision: layout.revision, name: layout.name, tee_name: layout.tee_name, holes: layout.holes, place_id: layout.place_id, center: layout.center, address: layout.address, source: boundedSource(layout.source) });

export function mountHoleSetup(form, b) {
  const section = document.createElement('section');
  section.className = 'full hole-setup panel';
  section.innerHTML = `<p class="eyebrow">ON-COURSE GPS</p><h3>Prepare the hole view</h3><p>Choose the course above. We’ll look for saved holes first, then find available hole data for a new course.</p><p class="hole-course-match" data-course-matches role="status"></p><label>Course layout<select name="course_layout_id"><option value="">Choose a saved layout</option></select></label><p data-layout-status role="status"></p><div class="hole-prepare-box"><label>Tees for this event<input type="text" maxlength="80" data-prepare-tee value="Yellow" placeholder="For example, Yellow"></label><p class="muted" data-prepare-help>Choose a course to find its holes. The course map must be checked before members use its GPS positions.</p><button type="button" data-course-prepare>Find &amp; prepare holes</button><p data-course-preparation role="status"></p></div><div class="actions"><button type="button" class="secondary" data-edit-layout>Review / edit holes</button><button type="button" class="secondary" data-preview-layout>Preview hole view</button></div><details class="section" data-legacy-section><summary>Use holes saved on the old 2027 site</summary><label>Saved course and tees<select data-legacy-layout><option value="">Choose a saved course</option></select></label><button type="button" class="secondary" data-import-layout>Restore saved holes</button><p class="muted">Existing scorecard details and mapped positions are kept. Each restored hole needs a quick check.</p></details><details class="section"><summary>Set up a different layout</summary><p class="muted">Use this for another set of tees or a course with no available hole data.</p><button type="button" class="secondary" data-new-layout>Create a separate layout</button></details>`;
  form.querySelector('.actions.full').before(section);
  const $ = selector => section.querySelector(selector), select = $('[name=course_layout_id]'), status = $('[data-layout-status]'), preparation = $('[data-course-preparation]'), legacySelect = $('[data-legacy-layout]'), tee = $('[data-prepare-tee]');
  let layouts = [], legacy = [], course = null, event = null, sequence = 0, busy = false, pendingMatch = false;
  let matchedLayouts = null, matchedLegacy = null;
  const selectedLayout = () => layouts.find(x => x.id === select.value);
  const listLayouts = () => matchedLayouts || layouts;
  const listLegacy = () => (matchedLegacy || legacy).filter(x => !x.imported_layout_id || !listLayouts().some(l => l.id === x.imported_layout_id));
  function lock(value) {
    busy = value;
    select.disabled = value;
    section.querySelectorAll('button,input,select').forEach(x => x.disabled = value);
    if (!value) describe();
  }
  function renderOptions(value = select.value) {
    const available = listLayouts();
    select.innerHTML = '<option value="">Choose a saved layout</option>' + available.map(x => `<option value="${b.escape(x.id)}">${b.escape(x.name)} · ${b.escape(x.tee_name)} · ${checkedCount(x)}/18 checked</option>`).join('');
    if (value && !available.some(x => x.id === value)) {
      const linked = layouts.find(x => x.id === value);
      select.add(new Option(linked ? `${linked.name} · ${linked.tee_name}` : 'Linked course layout', value));
    }
    select.value = value || '';
    const oldLegacy = legacySelect.value;
    const prior = listLegacy();
    legacySelect.innerHTML = '<option value="">Choose a saved course</option>' + prior.map(x => `<option value="${b.escape(x.id)}">${b.escape(x.name)} · ${b.escape(x.tee_name || 'Saved tees')} · ${x.mapped_count || 0} mapped</option>`).join('');
    legacySelect.value = prior.some(x => x.id === oldLegacy) ? oldLegacy : prior.length === 1 ? prior[0].id : '';
    $('[data-legacy-section]').hidden = !prior.length;
    describe();
  }
  function describe() {
    const layout = selectedLayout(), prior = listLegacy(), saved = prior.find(x => x.id === legacySelect.value);
    const hasLocation = course && Number.isFinite(course.latitude) && Number.isFinite(course.longitude);
    status.textContent = layout ? `${mappedCount(layout)} of 18 holes mapped · ${checkedCount(layout)} checked · ${layout.tee_name}. Save the event to use this layout.` : pendingMatch ? 'Checking saved course layouts…' : 'No layout selected. Members can use each hole once its positions have been checked.';
    $('[data-edit-layout]').disabled = busy || !layout;
    $('[data-preview-layout]').disabled = busy || !event || event.course_layout_id !== select.value || !select.value;
    $('[data-import-layout]').disabled = busy || !legacySelect.value;
    $('[data-course-prepare]').disabled = busy || (!hasLocation && !saved) || (!layout && prior.length > 1 && !saved);
    $('[data-course-prepare]').textContent = !layout && saved ? 'Restore saved holes' : layout ? 'Find missing hole data' : 'Find & prepare holes';
    $('[data-prepare-help]').textContent = !layout && saved ? `Found ${saved.hole_count || 0} scorecard holes and ${saved.mapped_count || 0} mapped holes for ${saved.tee_name || 'these tees'} on the old site.` : layout ? 'Find missing information while keeping every saved position and every checked hole.' : 'Available tee and green positions will be prepared for you. Check the course and tees before approving them for GPS.';
    tee.disabled = busy || !!layout || !!saved;
    if (layout) tee.value = layout.tee_name;
    else if (saved) tee.value = saved.tee_name || 'Yellow';
  }
  async function refresh(value = select.value, token = sequence) {
    const data = await action(b, 'list');
    if (token !== sequence) return false;
    layouts = data.layouts || []; legacy = data.legacy || [];
    if (matchedLayouts) matchedLayouts = layouts.filter(l => matchedLayouts.some(x => x.id === l.id) || l.id === value);
    if (matchedLegacy) matchedLegacy = legacy.filter(l => matchedLegacy.some(x => x.id === l.id));
    renderOptions(value);
    return true;
  }
  async function edit(layout = null) {
    await editLayout(b, layout, {
      name: course?.name || form.elements.course_name.value || form.elements.location.value,
      center: course && Number.isFinite(course.latitude) && Number.isFinite(course.longitude) ? { lat: course.latitude, lng: course.longitude } : null,
      metadata: course ? { place_id: course.place_id, address: course.address, center: Number.isFinite(course.latitude) && Number.isFinite(course.longitude) ? { lat: course.latitude, lng: course.longitude } : null } : {},
      saved: async result => refresh(result.id),
    });
  }
  async function restore(id = legacySelect.value) {
    if (!id || busy) return;
    const token = sequence;
    lock(true); preparation.textContent = 'Restoring the saved scorecard and hole map…';
    try {
      let layout = await action(b, 'import', { legacy_id: id });
      if (token !== sequence) return;
      // An imported layout can safely acquire the selected course identity without altering its holes.
      if (course?.place_id && !layout.place_id && matchedLegacy?.some(x => x.id === id)) {
        layout = await action(b, 'save', { ...layoutPayload(layout), place_id: course.place_id, address: course.address, center: { lat: course.latitude, lng: course.longitude } });
        if (token !== sequence) return;
      }
      await refresh(layout.id, token);
      if (token !== sequence) return;
      preparation.textContent = `${mappedCount(layout)} holes restored, ${checkedCount(layout)} checked. Open “Review / edit holes” to check the course map.`;
    } catch (error) { if (token === sequence) preparation.textContent = error.message; }
    finally { if (token === sequence) lock(false); }
  }
  async function prepare() {
    if (busy) return;
    if (!selectedLayout() && legacySelect.value) { await restore(); return; }
    if (!course || !Number.isFinite(course.latitude) || !Number.isFinite(course.longitude)) { preparation.textContent = 'Choose the course from the search results first.'; return; }
    const token = sequence, selectedId = select.value, desiredTee = tee.value.trim() || 'Yellow';
    lock(true); preparation.textContent = 'Finding hole data and preparing the course map…';
    try {
      const original = selectedId ? await action(b, 'get', { id: selectedId }) : null;
      if (token !== sequence) return;
      if (original?.place_id && original.place_id !== course.place_id) throw new Error('This saved layout belongs to a different course. Choose the matching course before finding its holes.');
      const result = await b.service('prepare_course', { place_id: course.place_id, name: course.name, latitude: course.latitude, longitude: course.longitude, tee_name: original?.tee_name || desiredTee });
      if (token !== sequence) return;
      const draft = result?.draft || result;
      if (result.scorecards?.length) draft.source = { ...draft.source, scorecards: result.scorecards.slice(0, 12), scorecard_warnings: result.warnings || [] };
      if (!Array.isArray(draft?.holes)) throw new Error('No usable hole data was returned. Your saved layout has not changed.');
      const merged = { ...draft, ...original, name: original?.name || draft.name || course.name, tee_name: original?.tee_name || draft.tee_name || desiredTee, place_id: original?.place_id || course.place_id, address: original?.address || course.address || draft.address, center: original?.center || { lat: course.latitude, lng: course.longitude }, source: { ...original?.source, ...draft.source, scorecards: draft.source?.scorecards || original?.source?.scorecards, selected_scorecard: original?.source?.selected_scorecard }, holes: mergePreparedHoles(original?.holes, draft.holes) };
      const saved = await action(b, 'save', layoutPayload(merged));
      if (token !== sequence) return;
      await refresh(saved.id, token);
      if (token !== sequence) return;
      const count = mappedCount(saved), warnings = [...(draft.source?.warnings || []), ...(result.warnings || [])];
      preparation.textContent = `${count} of 18 holes mapped. ${count ? 'Open “Review / edit holes” to check the course and tees before members use GPS.' : 'No reliable tee-to-green positions were found. The layout is saved, but GPS holes are not ready.'}${result.scorecards?.length ? ' Scorecards were found: choose the correct course and tees in the review window.' : ''}${original ? ' Your saved positions and checked holes were kept.' : ''}${warnings.length ? ' ' + warnings.join(' ') : ''}`;
    } catch (error) { if (token === sequence) preparation.textContent = `${error.message} Existing saved holes have been kept.`; }
    finally { if (token === sequence) lock(false); }
  }
  async function setCourse(value) {
    const next = courseDetails(value), previous = course;
    const retain = sameCourse(next, previous) ? select.value : null;
    const token = ++sequence;
    let matchedSuccessfully = false;
    course = next; matchedLayouts = []; matchedLegacy = []; pendingMatch = true;
    select.value = retain || ''; preparation.textContent = ''; legacySelect.value = '';
    lock(true); renderOptions(retain);
    $('[data-course-matches]').textContent = course ? `Finding saved holes for ${course.name}…` : 'Choose the course above to find its saved holes.';
    if (!course) { pendingMatch = false; matchedLayouts = null; matchedLegacy = null; renderOptions(); lock(false); return; }
    try {
      const matches = await action(b, 'match', { place_id: course.place_id, name: course.name, latitude: course.latitude, longitude: course.longitude });
      if (token !== sequence) return;
      matchedSuccessfully = true;
      matchedLayouts = matches.layouts || []; matchedLegacy = matches.legacy || [];
      for (const item of matchedLayouts) if (!layouts.some(l => l.id === item.id)) layouts.push(item);
      for (const item of matchedLegacy) if (!legacy.some(l => l.id === item.id)) legacy.push(item);
      const selected = retain && matchedLayouts.some(l => l.id === retain) ? retain : matchedLayouts.length === 1 ? matchedLayouts[0].id : '';
      renderOptions(selected);
      $('[data-course-matches]').textContent = matchedLayouts.length === 1 ? `Saved holes found for ${course.name}. The existing layout is selected.` : matchedLayouts.length > 1 ? `Several layouts were found for ${course.name}. Choose the correct course and tees.` : matchedLegacy.length === 1 ? `Found saved holes for ${course.name} on the old 2027 site.` : matchedLegacy.length > 1 ? `Several old layouts were found. Choose the correct course and tees below before restoring.` : `No saved holes matched ${course.name}. Prepare the available hole data below.`;
      if (matchedLegacy.length > 1) $('[data-legacy-section]').open = true;
    } catch (error) {
      if (token === sequence) { renderOptions(retain); $('[data-course-matches]').textContent = `Saved course matching could not finish: ${error.message}`; }
    } finally { if (token === sequence) { pendingMatch = false; lock(false); } }
    if (token === sequence && matchedSuccessfully && matchedLayouts?.length === 0) {
      if (matchedLegacy?.length === 1) await restore(matchedLegacy[0].id);
      else if (matchedLegacy?.length === 0 && course.place_id && Number.isFinite(course.latitude) && Number.isFinite(course.longitude)) await prepare();
    }
  }
  select.onchange = () => { preparation.textContent = ''; describe(); };
  legacySelect.onchange = describe;
  $('[data-course-prepare]').onclick = prepare;
  $('[data-new-layout]').onclick = () => edit();
  $('[data-edit-layout]').onclick = async () => { try { await edit(await action(b, 'get', { id: select.value })); } catch (error) { status.textContent = error.message; } };
  $('[data-preview-layout]').onclick = () => openHolePicker(event, b);
  $('[data-import-layout]').onclick = () => restore();
  function visibility() { section.hidden = form.elements.event_type.value === 'social'; }
  form.elements.event_type.addEventListener('change', visibility);
  return {
    layoutId() { if (busy || pendingMatch) throw new Error('The course holes are still being prepared. Please save the event when this finishes.'); return select.value || null; },
    setCourse,
    async setEvent(ev) {
      const token = ++sequence;
      let loadError = '';
      event = ev; course = ev?.course_name ? courseDetails(ev) : null;
      matchedLayouts = null; matchedLegacy = null; pendingMatch = false;
      preparation.textContent = ''; $('[data-course-matches]').textContent = '';
      visibility(); lock(true);
      if (ev?.course_layout_id && ![...select.options].some(o => o.value === ev.course_layout_id)) select.add(new Option('Linked course layout', ev.course_layout_id));
      select.value = ev?.course_layout_id || '';
      status.textContent = 'Loading saved courses…';
      try { await refresh(ev?.course_layout_id, token); }
      catch (error) { if (token === sequence) loadError = `${error.message} Your existing course selection is kept.`; }
      finally { if (token === sequence) { lock(false); if (loadError) status.textContent = loadError; } }
    }
  };
}

async function editLayout(b, original, options) {
  let layout = original ? structuredClone(original) : { ...options.metadata, name: options.name || '', tee_name: 'Yellow', holes: [], revision: null };
  const scorecards = layout.source?.scorecards || [];
  const sourceLink = raw => { try { const url = new URL(raw); return url.protocol === 'https:' ? b.escape(url.href) : ''; } catch { return ''; } };
  const sourceUrl = sourceLink(layout.source?.url);
  layout.holes = Array.from({ length: 18 }, (_, i) => ({ ...blankHole(i + 1), ...layout.holes.find(h => h.number === i + 1) }));
  let number = 1, dirty = false, busy = false, map = null, closed = false;
  const dialog = document.createElement('dialog');
  dialog.className = 'hole-admin-dialog';
  dialog.setAttribute('aria-labelledby', 'holeSetupTitle');
  dialog.innerHTML = `<div class="hole-dialog-head"><div><p class="eyebrow">COURSE SETUP</p><h2 id="holeSetupTitle">Review the course holes</h2></div><button type="button" class="secondary" data-close>Close</button></div><p>The available hole data is ready to check. Choose a hole and confirm its tee and green on the map. To correct a point, choose it below and tap the correct position. Unmapped holes stay unavailable to members.</p><p class="notice">Changes to a saved layout apply to every event using it. Create a separate layout for a different course or set of tees.</p><form class="form-stack" data-layout-form>${scorecards.length ? `<section class="hole-scorecard-choice"><h3>Choose the correct scorecard</h3><p>The same club can have several courses and tee colours. Choose yours before checking the holes.</p><label>Course and tees<select data-scorecard-choice><option value="">Choose a scorecard</option>${scorecards.map((card, i) => `<option value="${i}">${b.escape(card.course_name || layout.name)} · ${b.escape(card.tee_name)}</option>`).join('')}</select></label><button type="button" class="secondary" data-use-scorecard>Use this scorecard</button><p data-scorecard-status role="status"></p></section>` : ''}<div class="form-grid"><label>Course / layout name<input name="layout_name" required maxlength="160" value="${b.escape(layout.name)}"></label><label>Tees<input name="tee_name" required maxlength="80" value="${b.escape(layout.tee_name)}"></label></div><div class="hole-grid" aria-label="Choose a hole to set up" data-admin-holes></div><div class="section-heading"><h3 data-hole-title></h3><span data-review-count></span></div><div class="form-grid"><label>Par<input name="par" type="number" min="3" max="6" step="1"></label><label>Scorecard yards<input name="yards" type="number" min="1" max="1200" step="1"></label><label>Stroke index<input name="stroke_index" type="number" min="1" max="18" step="1"></label></div><label>Point to place<select name="map_point">${points.map(x => `<option value="${x}">${labels[x]}</option>`).join('')}</select></label><p data-map-hint class="muted">Check the tee and green centre. Choose a point above to move it on the map.</p><div class="hole-map" data-admin-map aria-label="Course satellite map"></div><p data-map-error role="status"></p><div class="hole-point-summary" data-point-summary></div>${points.map(x => `<input type="hidden" name="${x}_lat"><input type="hidden" name="${x}_lng">`).join('')}<details><summary>Remove a mapped point</summary><p class="muted">Front, back and dogleg points are optional. Removing a tee or green will make the hole unavailable until it is mapped again.</p><div class="hole-point-clear">${points.map(x => `<button type="button" class="secondary" data-clear-point="${x}">Clear ${labels[x].toLowerCase()}</button>`).join('')}</div></details>${layout.source?.attribution ? `<p class="hole-map-attribution">${b.escape(layout.source.attribution)}${sourceUrl ? ` · <a href="${sourceUrl}" target="_blank" rel="noopener noreferrer">View data source</a>` : ''}</p>` : ''}<label class="check"><input type="checkbox" name="reviewed"> I’ve checked this hole’s tee and green positions</label><p data-save-status role="status"></p><div class="actions"><button type="submit" data-save-next>Save hole & next</button><button type="button" class="secondary" data-save-close>Save & close</button></div></form>`;
  document.body.append(dialog); dialog.showModal();
  const form = dialog.querySelector('form'), grid = dialog.querySelector('[data-admin-holes]'), status = dialog.querySelector('[data-save-status]');
  const current = () => layout.holes[number - 1];
  function updateGrid() {
    grid.innerHTML = layout.holes.map(h => `<button type="button" class="secondary ${h.number === number ? 'active' : ''}" data-hole="${h.number}" aria-label="Hole ${h.number}${h.reviewed ? ', checked' : ', needs review'}" aria-pressed="${h.number === number}">${h.number}<small>${h.reviewed ? 'Checked' : h.tee && h.green ? 'Review' : 'Missing'}</small></button>`).join('');
    dialog.querySelector('[data-review-count]').textContent = `${mappedCount(layout)} mapped · ${layout.holes.filter(x => x.reviewed).length} / 18 checked`;
    dialog.querySelector('[data-point-summary]').innerHTML = points.map(key => `<span class="${current()[key] ? 'is-mapped' : ''}">${b.escape(labels[key])} · ${current()[key] ? 'Mapped' : 'Not mapped'}</span>`).join('');
  }
  function read() {
    const h = current();
    for (const key of ['par', 'yards', 'stroke_index']) h[key] = form.elements[key].value === '' ? null : Number(form.elements[key].value);
    for (const key of points) {
      const lat = form.elements[`${key}_lat`].value, lng = form.elements[`${key}_lng`].value;
      if ((lat === '') !== (lng === '')) throw new Error(`Enter both coordinates for ${labels[key].toLowerCase()}, or clear both.`);
      h[key] = lat === '' ? null : { lat: Number(lat), lng: Number(lng) };
    }
    h.reviewed = form.elements.reviewed.checked;
    if (h.reviewed && (!h.tee || !h.green)) throw new Error('Place both the tee and green before checking this hole.');
    layout.name = form.elements.layout_name.value.trim();
    const nextTees = form.elements.tee_name.value.trim();
    if (nextTees.toLowerCase() !== layout.tee_name.toLowerCase()) {
      layout.holes.forEach(hole => hole.reviewed = false);
      form.elements.reviewed.checked = false;
    }
    layout.tee_name = nextTees;
  }
  function show() {
    const h = current();
    dialog.querySelector('[data-hole-title]').textContent = `Hole ${number}`;
    for (const key of ['par', 'yards', 'stroke_index']) form.elements[key].value = h[key] ?? '';
    for (const key of points) { form.elements[`${key}_lat`].value = h[key]?.lat ?? ''; form.elements[`${key}_lng`].value = h[key]?.lng ?? ''; }
    form.elements.reviewed.checked = h.reviewed;
    form.elements.map_point.value = !h.tee ? 'tee' : 'green';
    map?.setHole(h); updateGrid();
    dialog.querySelector('[data-map-hint]').textContent = h.tee && h.green ? 'Check the tee and green against the selected scorecard, then mark this hole as checked.' : 'Some positions were not found. Choose a point, then tap its position on the map.';
  }
  function close() {
    if (busy || (dirty && !confirm('Close without saving your latest hole changes?'))) return;
    closed = true; map?.destroy(); dialog.close(); dialog.remove();
  }
  dialog.querySelector('[data-close]').onclick = close;
  dialog.oncancel = e => { e.preventDefault(); close(); };
  grid.onclick = e => {
    const button = e.target.closest('[data-hole]'); if (!button || busy) return;
    try { if (!form.reportValidity()) return; read(); number = Number(button.dataset.hole); status.textContent = ''; show(); }
    catch (error) { status.textContent = error.message; }
  };
  form.addEventListener('input', e => {
    dirty = true;
    if (points.some(x => e.target.name.startsWith(`${x}_`))) form.elements.reviewed.checked = false;
  });
  form.addEventListener('change', e => {
    if (points.some(x => e.target.name.startsWith(`${x}_`))) {
      try { read(); map?.setHole(current(), { fit: false }); } catch {}
    }
  });
  dialog.querySelectorAll('[data-clear-point]').forEach(button => button.onclick = () => {
    const key = button.dataset.clearPoint;
    form.elements[`${key}_lat`].value = ''; form.elements[`${key}_lng`].value = '';
    form.elements.reviewed.checked = false; dirty = true;
    try { read(); map?.setHole(current(), { fit: false }); updateGrid(); } catch (error) { status.textContent = error.message; }
  });
  async function save(andClose) {
    if (busy || !form.reportValidity()) return;
    try {
      read(); busy = true;
      dialog.querySelectorAll('button,input,select').forEach(x => x.disabled = true);
      status.textContent = 'Saving course layout…';
      layout = await action(b, 'save', layoutPayload(layout));
      dirty = false; await options.saved(layout);
      status.textContent = 'Hole saved. Save the event to confirm its course layout.';
      if (andClose) { busy = false; close(); return; }
      if (number < 18) number++; show();
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; dialog.querySelectorAll('button,input,select').forEach(x => x.disabled = false); }
  }
  form.onsubmit = e => { e.preventDefault(); save(false); };
  dialog.querySelector('[data-save-close]').onclick = () => save(true);
  function appendScorecardLink(card) {
    const url = sourceLink(card?.source_url);
    if (!url) return;
    const link = document.createElement('a');
    link.href = card.source_url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.textContent = ' View scorecard source';
    dialog.querySelector('[data-scorecard-status]').append(link);
  }
  dialog.querySelector('[data-scorecard-choice]')?.addEventListener('change', e => {
    const card = scorecards[Number(e.target.value)];
    dialog.querySelector('[data-scorecard-status]').textContent = e.target.value === '' ? '' : 'Check that this is the course and set of tees you are playing.';
    if (e.target.value !== '') appendScorecardLink(card);
  });
  dialog.querySelector('[data-use-scorecard]')?.addEventListener('click', () => {
    const choice = dialog.querySelector('[data-scorecard-choice]').value;
    if (choice === '') { dialog.querySelector('[data-scorecard-status]').textContent = 'Choose the course and tees first.'; return; }
    try {
      read();
      const card = scorecards[Number(choice)], newTees = card.tee_name || layout.tee_name;
      const prior = layout.source?.selected_scorecard;
      const normal = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
      const teesChanged = normal(newTees) !== normal(layout.tee_name);
      const identityChanged = !!prior && (
        ['course_name', 'tee_name'].some(key => normal(prior[key]) !== normal(card[key])) ||
        String(prior.source_url || '').trim() !== String(card.source_url || '').trim()
      );
      const hasCheckedHoles = layout.holes.some(h => h.reviewed);
      const checkedFactsChanged = layout.holes.some(h => {
        const data = card.holes?.find(x => Number(x.number) === h.number);
        return h.reviewed && data && ['par', 'stroke_index'].some(key => data[key] != null && Number(data[key]) !== Number(h[key]));
      });
      const reviewRequired = teesChanged || identityChanged || (hasCheckedHoles && !prior) || checkedFactsChanged;
      layout.holes = layout.holes.map(h => {
        const data = card.holes?.find(x => Number(x.number) === h.number);
        if (!data) return reviewRequired ? { ...h, reviewed: false } : h;
        return { ...h, par: data.par ?? h.par, yards: data.yards ?? h.yards, stroke_index: data.stroke_index ?? h.stroke_index, reviewed: reviewRequired ? false : h.reviewed };
      });
      layout.tee_name = newTees; form.elements.tee_name.value = newTees;
      layout.source = { ...layout.source, selected_scorecard: { course_name: card.course_name, tee_name: card.tee_name, source_url: card.source_url } };
      dirty = true; show();
      dialog.querySelector('[data-scorecard-status]').textContent = `Scorecard details applied for ${card.course_name || layout.name} · ${newTees}. GPS positions have not moved.${reviewRequired ? ' This course or scorecard needs checking: confirm the hole order and every tee and green before approving GPS again.' : ''} Save to keep these details.`;
      appendScorecardLink(card);
    } catch (error) { status.textContent = error.message; }
  });
  show();
  try {
    map = await createHoleMap(dialog.querySelector('[data-admin-map]'), {
      center: current().tee || layout.holes.find(h => h.tee)?.tee || options.center || { lat: 52.218, lng: -1.599 },
      onClick(point) {
        if (busy) return;
        const key = form.elements.map_point.value;
        form.elements[`${key}_lat`].value = point.lat.toFixed(7); form.elements[`${key}_lng`].value = point.lng.toFixed(7);
        form.elements.reviewed.checked = false; dirty = true;
        try { read(); map.setHole(current(), { fit: false }); updateGrid(); }
        catch (error) { status.textContent = error.message; }
        if (key === 'tee') form.elements.map_point.value = 'green';
        dialog.querySelector('[data-map-hint]').textContent = `${labels[key]} placed. ${key === 'tee' ? 'Now tap the green centre.' : 'Check the positions, then tick the review box and save.'}`;
      },
      onError(error) { dialog.querySelector('[data-map-error]').textContent = error.message; },
    });
    if (closed) { map.destroy(); return; }
    map.setHole(current());
  } catch (error) { dialog.querySelector('[data-map-error]').textContent = `${error.message} Saved positions are kept. Reopen this window when the satellite map is available to check or change them.`; }
}
