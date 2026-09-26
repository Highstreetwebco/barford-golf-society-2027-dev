import { createHoleMap } from './hole-map.js?v=2027-holes-1';
import { openHolePicker } from './hole-view.js?v=2027-holes-1';

const points = ['tee', 'green', 'front', 'back', 'dogleg'];
const labels = { tee: 'Tee', green: 'Green centre', front: 'Green front', back: 'Green back', dogleg: 'Dogleg / corner' };
const blankHole = number => ({ number, par: null, yards: null, stroke_index: null, tee: null, green: null, front: null, back: null, dogleg: null, reviewed: false });
async function action(b, name, payload = {}) {
  const { data, error } = await b.client.rpc('course_layout', { action: name, payload });
  if (error) throw error;
  return data;
}

export function mountHoleSetup(form, b) {
  const section = document.createElement('section');
  section.className = 'full hole-setup panel';
  section.innerHTML = `<p class="eyebrow">ON-COURSE GPS</p><h3>Set up the hole view</h3><p>Choose the course and tees for this event. Saved layouts can be reused for future visits.</p><label>Course layout<select name="course_layout_id"><option value="">Set up later</option></select></label><p data-layout-status role="status"></p><div class="actions"><button type="button" data-new-layout>Set up a course</button><button type="button" class="secondary" data-edit-layout>Review / edit holes</button><button type="button" class="secondary" data-preview-layout>Preview hole view</button></div><details class="section"><summary>Restore a layout from the old 2027 site</summary><label>Saved course<select data-legacy-layout><option value="">Choose a course</option></select></label><button type="button" class="secondary" data-import-layout>Restore for review</button><p class="muted">Each hole needs a check before its GPS positions are available to members.</p></details>`;
  form.querySelector('.actions.full').before(section);
  const select = section.querySelector('[name=course_layout_id]'), status = section.querySelector('[data-layout-status]');
  let layouts = [], event = null, loadToken = 0, loading = false;
  function describe() {
    const layout = layouts.find(x => x.id === select.value);
    status.textContent = layout ? `${layout.ready_count || 0} of 18 holes checked · ${layout.tee_name}. Save the event to use this layout.` : 'The event-day View hole button will show the hole picker. GPS positions become available as holes are checked.';
    section.querySelector('[data-edit-layout]').disabled = !layout;
    section.querySelector('[data-preview-layout]').disabled = !event || event.course_layout_id !== select.value || !select.value;
  }
  async function refresh(value = select.value) {
    const token = ++loadToken;
    loading = true;
    select.disabled = true;
    if (value && ![...select.options].some(x => x.value === value)) {
      select.add(new Option('Linked course layout', value));
    }
    select.value = value || '';
    section.querySelectorAll('button').forEach(x => x.disabled = true);
    status.textContent = 'Loading saved courses…';
    try {
      const data = await action(b, 'list');
      if (token !== loadToken) return;
      layouts = data.layouts || [];
      select.innerHTML = '<option value="">Set up later</option>' + layouts.map(x => `<option value="${b.escape(x.id)}">${b.escape(x.name)} · ${b.escape(x.tee_name)} · ${x.ready_count || 0}/18 checked</option>`).join('');
      select.value = value || '';
      section.querySelector('[data-legacy-layout]').innerHTML = '<option value="">Choose a course</option>' + (data.legacy || []).map(x => `<option value="${b.escape(x.id)}">${b.escape(x.name)} · ${b.escape(x.tee_name || 'Saved tees')} · ${x.mapped_count || 0} mapped</option>`).join('');
      describe();
    } catch (error) { if (token === loadToken) status.textContent = `${error.message} Your existing course selection is kept.`; }
    finally {
      if (token === loadToken) {
        loading = false; select.disabled = false;
        section.querySelector('[data-new-layout]').disabled = false;
        section.querySelector('[data-import-layout]').disabled = false;
        section.querySelector('[data-edit-layout]').disabled = !layouts.some(x => x.id === select.value);
        section.querySelector('[data-preview-layout]').disabled = !event || event.course_layout_id !== select.value || !select.value;
      }
    }
  }
  async function edit(layout = null) {
    await editLayout(b, layout, {
      name: form.elements.course_name.value || form.elements.location.value,
      center: form.elements.latitude.value !== '' && form.elements.longitude.value !== '' ? { lat: Number(form.elements.latitude.value), lng: Number(form.elements.longitude.value) } : null,
      saved: async result => refresh(result.id),
    });
  }
  select.onchange = describe;
  section.querySelector('[data-new-layout]').onclick = () => edit();
  section.querySelector('[data-edit-layout]').onclick = async () => {
    try { await edit(await action(b, 'get', { id: select.value })); }
    catch (error) { status.textContent = error.message; }
  };
  section.querySelector('[data-preview-layout]').onclick = () => openHolePicker(event, b);
  section.querySelector('[data-import-layout]').onclick = async e => {
    const id = section.querySelector('[data-legacy-layout]').value;
    if (!id) { status.textContent = 'Choose a saved course first.'; return; }
    e.currentTarget.disabled = true;
    try {
      const layout = await action(b, 'import', { legacy_id: id });
      await refresh(layout.id);
      await edit(layout);
    } catch (error) { status.textContent = error.message; }
    finally { section.querySelector('[data-import-layout]').disabled = false; }
  };
  function visibility() { section.hidden = form.elements.event_type.value === 'social'; }
  form.elements.event_type.addEventListener('change', visibility);
  return {
    layoutId() { if (loading) throw new Error('Saved courses are still loading. Please try saving in a moment.'); return select.value || null; },
    async setEvent(ev) { event = ev; visibility(); await refresh(ev?.course_layout_id); }
  };
}

async function editLayout(b, original, options) {
  let layout = original ? structuredClone(original) : { name: options.name || '', tee_name: 'Yellow', holes: [], revision: null };
  layout.holes = Array.from({ length: 18 }, (_, i) => ({ ...blankHole(i + 1), ...layout.holes.find(h => h.number === i + 1) }));
  let number = 1, dirty = false, busy = false, map = null, closed = false;
  const dialog = document.createElement('dialog');
  dialog.className = 'hole-admin-dialog';
  dialog.setAttribute('aria-labelledby', 'holeSetupTitle');
  dialog.innerHTML = `<div class="hole-dialog-head"><div><p class="eyebrow">COURSE SETUP</p><h2 id="holeSetupTitle">Map the course</h2></div><button type="button" class="secondary" data-close>Close</button></div><p>Tap a hole, choose a point, then tap its position on the satellite map. Check against the course scorecard. Green front and back are optional; no estimates are invented.</p><p class="notice">Changes to a saved layout apply to every event using it. Use “Set up a course” for a different course or set of tees.</p><form class="form-stack" data-layout-form><div class="form-grid"><label>Course / layout name<input name="layout_name" required maxlength="160" value="${b.escape(layout.name)}"></label><label>Tees<input name="tee_name" required maxlength="80" value="${b.escape(layout.tee_name)}"></label></div><div class="hole-grid" aria-label="Choose a hole to set up" data-admin-holes></div><div class="section-heading"><h3 data-hole-title></h3><span data-review-count></span></div><div class="form-grid"><label>Par<input name="par" type="number" min="3" max="6" step="1"></label><label>Scorecard yards<input name="yards" type="number" min="1" max="1200" step="1"></label><label>Stroke index<input name="stroke_index" type="number" min="1" max="18" step="1"></label></div><label>Point to place<select name="map_point">${points.map(x => `<option value="${x}">${labels[x]}</option>`).join('')}</select></label><p data-map-hint class="muted">Place the tee, then the centre of the green.</p><div class="hole-map" data-admin-map aria-label="Course satellite map"></div><p data-map-error role="status"></p><details><summary>Coordinates & optional points</summary><div class="hole-coordinates">${points.map(x => `<fieldset><legend>${labels[x]}</legend><div class="form-grid"><label>Latitude<input type="number" step="any" min="-90" max="90" name="${x}_lat"></label><label>Longitude<input type="number" step="any" min="-180" max="180" name="${x}_lng"></label></div><button type="button" class="secondary" data-clear-point="${x}">Clear ${labels[x].toLowerCase()}</button></fieldset>`).join('')}</div></details><label class="check"><input type="checkbox" name="reviewed"> I’ve checked this hole’s tee and green positions</label><p data-save-status role="status"></p><div class="actions"><button type="submit" data-save-next>Save hole & next</button><button type="button" class="secondary" data-save-close>Save & close</button></div></form>`;
  document.body.append(dialog); dialog.showModal();
  const form = dialog.querySelector('form'), grid = dialog.querySelector('[data-admin-holes]'), status = dialog.querySelector('[data-save-status]');
  const current = () => layout.holes[number - 1];
  function updateGrid() {
    grid.innerHTML = layout.holes.map(h => `<button type="button" class="secondary ${h.number === number ? 'active' : ''}" data-hole="${h.number}" aria-label="Hole ${h.number}${h.reviewed ? ', checked' : ', needs review'}" aria-pressed="${h.number === number}">${h.number}<small>${h.reviewed ? 'Checked' : 'Set up'}</small></button>`).join('');
    dialog.querySelector('[data-review-count]').textContent = `${layout.holes.filter(x => x.reviewed).length} / 18 checked`;
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
    layout.name = form.elements.layout_name.value.trim(); layout.tee_name = form.elements.tee_name.value.trim();
  }
  function show() {
    const h = current();
    dialog.querySelector('[data-hole-title]').textContent = `Hole ${number}`;
    for (const key of ['par', 'yards', 'stroke_index']) form.elements[key].value = h[key] ?? '';
    for (const key of points) { form.elements[`${key}_lat`].value = h[key]?.lat ?? ''; form.elements[`${key}_lng`].value = h[key]?.lng ?? ''; }
    form.elements.reviewed.checked = h.reviewed;
    form.elements.map_point.value = !h.tee ? 'tee' : 'green';
    map?.setHole(h); updateGrid();
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
    try { read(); map?.setHole(current(), { fit: false }); } catch (error) { status.textContent = error.message; }
  });
  async function save(andClose) {
    if (busy || !form.reportValidity()) return;
    try {
      read(); busy = true;
      dialog.querySelectorAll('button,input,select').forEach(x => x.disabled = true);
      status.textContent = 'Saving course layout…';
      layout = await action(b, 'save', { id: layout.id, revision: layout.revision, name: layout.name, tee_name: layout.tee_name, holes: layout.holes });
      dirty = false; await options.saved(layout);
      status.textContent = 'Hole saved. Save the event to confirm its course layout.';
      if (andClose) { busy = false; close(); return; }
      if (number < 18) number++; show();
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; dialog.querySelectorAll('button,input,select').forEach(x => x.disabled = false); }
  }
  form.onsubmit = e => { e.preventDefault(); save(false); };
  dialog.querySelector('[data-save-close]').onclick = () => save(true);
  show();
  try {
    map = await createHoleMap(dialog.querySelector('[data-admin-map]'), {
      center: current().tee || layout.holes.find(h => h.tee)?.tee || options.center || { lat: 52.218, lng: -1.599 },
      onClick(point) {
        if (busy) return;
        const key = form.elements.map_point.value;
        form.elements[`${key}_lat`].value = point.lat.toFixed(7); form.elements[`${key}_lng`].value = point.lng.toFixed(7);
        form.elements.reviewed.checked = false; dirty = true;
        try { read(); map.setHole(current(), { fit: false }); }
        catch (error) { status.textContent = error.message; }
        if (key === 'tee') form.elements.map_point.value = 'green';
        dialog.querySelector('[data-map-hint]').textContent = `${labels[key]} placed. ${key === 'tee' ? 'Now tap the green centre.' : 'Check the positions, then tick the review box and save.'}`;
      },
      onError(error) { dialog.querySelector('[data-map-error]').textContent = error.message; },
    });
    if (closed) { map.destroy(); return; }
    map.setHole(current());
  } catch (error) { dialog.querySelector('[data-map-error]').textContent = `${error.message} You can still enter exact coordinates below.`; }
}
