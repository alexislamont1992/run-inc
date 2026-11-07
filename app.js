(() => {
  'use strict';

  const CFG = window.RUN_CONFIG || {};
  const RUNNERS = CFG.RUNNERS || ['Alexis', 'Ryan', 'Justin'];
  const RACE_NAME = CFG.RACE_NAME || 'Half Marathon';
  const TYPES = ['Easy', 'Long', 'Tempo', 'Intervals', 'Recovery', 'Race', 'Cross-training', 'Rest'];
  const STATUSES = ['planned', 'done', 'swapped', 'missed'];
  const STATUS_ICON = { planned: '', done: '✓', swapped: '⇄', missed: '✕' };
  const KM_PER_MILE = 1.609344;

  // ---------- Small helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => (v === null || v === undefined || v === '' || isNaN(+v) ? null : +v);
  const typeClass = (t) => 't-' + String(t || 'Easy').toLowerCase();
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    }));

  // ---------- Dates (all local, no UTC surprises) ----------
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
  const mondayOf = (d) => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7));
  const daysBetween = (a, b) => Math.round((b - a) / 86400000);
  const fmtDay = (d) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const RACE_DATE = parseISO(CFG.RACE_DATE || '2027-05-02');

  // ---------- Time, pace, speed ----------
  // "45" → 45 min (or 45 s when plainUnit = 's'), "45:30" → mm:ss, "1:05:00" → h:mm:ss, "1h05" also ok.
  function parseDuration(str, plainUnit = 'min') {
    if (str === null || str === undefined) return null;
    const s = String(str).trim().toLowerCase().replace(',', '.');
    if (!s) return null;
    const h = s.match(/^(\d+(?:\.\d+)?)\s*h\s*(\d+)?\s*(?:m(?:in)?)?$/);
    if (h) return Math.round(+h[1] * 3600 + (+(h[2] || 0)) * 60);
    if (/^\d+(\.\d+)?$/.test(s)) return Math.round(+s * (plainUnit === 's' ? 1 : 60));
    const parts = s.split(':');
    if (parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
    if (parts.length === 2) return Math.round(+parts[0] * 60 + +parts[1]);
    if (parts.length === 3) return Math.round(+parts[0] * 3600 + +parts[1] * 60 + +parts[2]);
    return null;
  }
  function fmtDuration(sec) {
    if (sec === null || sec === undefined) return '';
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }
  function fmtTotal(sec) {
    if (!sec) return '0m';
    const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    return h ? `${h}h${pad(m)}` : `${m}m`;
  }
  const fmtKm = (km) => (km === null || km === undefined ? '' : (Math.round(km * 10) / 10).toString());
  const paceOf = (km, sec) => (km > 0 && sec > 0 ? sec / km : null);
  const fmtPace = (secPerKm) => (secPerKm ? `${fmtDuration(secPerKm)}/km` : '–');
  const kmh = (km, sec) => (km > 0 && sec > 0 ? km / (sec / 3600) : null);
  const fmtSpeed = (v) => (v ? v.toFixed(1) : '–');
  function speedLine(km, sec) {
    const p = paceOf(km, sec);
    if (!p) return '';
    const v = kmh(km, sec);
    return `<b>${fmtPace(p)}</b> · ${fmtSpeed(v)} km/h · ${fmtSpeed(v / KM_PER_MILE)} mph`;
  }

  // What was actually done (null if nothing yet / missed)
  function actualOf(r) {
    if (r.status === 'done') {
      return {
        type: r.type,
        km: num(r.actual_distance_km) ?? num(r.planned_distance_km),
        sec: num(r.actual_duration_s) ?? num(r.planned_duration_s),
      };
    }
    if (r.status === 'swapped') {
      return { type: r.actual_type || r.type, km: num(r.actual_distance_km), sec: num(r.actual_duration_s) };
    }
    return null;
  }
  const intervalsSummary = (blocks) => (blocks || [])
    .filter((b) => b.reps && b.distance_m)
    .map((b) => `${b.reps}×${b.distance_m >= 1000 && b.distance_m % 1000 === 0 ? b.distance_m / 1000 + 'k' : b.distance_m}`)
    .join(' + ');

  // ---------- Data store (Supabase, or localStorage demo mode) ----------
  const runs = new Map();
  let sb = null;
  let connState = CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY ? 'connecting' : 'demo';
  const DEMO_KEY = 'runinc-demo-runs';
  const COLUMNS = ['id', 'runner', 'run_date', 'type', 'planned_distance_km', 'planned_duration_s', 'notes', 'status',
    'actual_type', 'actual_distance_km', 'actual_duration_s', 'intervals'];
  const clean = (r) => Object.fromEntries(COLUMNS.map((k) => [k, r[k] ?? (k === 'intervals' ? [] : null)]));

  const Store = {
    async init() {
      if (CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase) {
        sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
        await this.reload();
        this.subscribe();
      } else {
        connState = 'demo';
        this.loadDemo();
        window.addEventListener('storage', (e) => { if (e.key === DEMO_KEY) { this.loadDemo(); render(); } });
      }
    },
    loadDemo() {
      runs.clear();
      let list = [];
      try { list = JSON.parse(localStorage.getItem(DEMO_KEY) || '[]'); } catch { list = []; }
      list.forEach((r) => runs.set(r.id, r));
    },
    saveDemo() {
      try { localStorage.setItem(DEMO_KEY, JSON.stringify([...runs.values()])); } catch { /* private mode */ }
    },
    async reload() {
      if (!sb) return;
      const all = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from('runs').select('*').order('run_date').range(from, from + 999);
        if (error) throw error;
        all.push(...data);
        if (data.length < 1000) break;
      }
      runs.clear();
      all.forEach((r) => runs.set(r.id, r));
    },
    subscribe() {
      sb.channel('runs-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'runs' }, (p) => {
          if (p.eventType === 'DELETE') runs.delete(p.old.id);
          else runs.set(p.new.id, p.new);
          render();
        })
        .subscribe((status) => {
          connState = status === 'SUBSCRIBED' ? 'live' : (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') ? 'off' : connState;
          renderCountdown();
        });
    },
    async save(run) {
      const row = clean(run);
      if (!row.id) row.id = uuid();
      if (sb) {
        const { data, error } = await sb.from('runs').upsert(row).select().single();
        if (error) throw error;
        runs.set(data.id, data);
      } else {
        runs.set(row.id, row);
        this.saveDemo();
      }
    },
    async insertMany(rows) {
      rows = rows.map(clean);
      if (sb) {
        const { data, error } = await sb.from('runs').insert(rows).select();
        if (error) throw error;
        data.forEach((r) => runs.set(r.id, r));
      } else {
        rows.forEach((r) => runs.set(r.id, r));
        this.saveDemo();
      }
    },
    async remove(id) {
      if (sb) {
        const { error } = await sb.from('runs').delete().eq('id', id);
        if (error) throw error;
      }
      runs.delete(id);
      if (!sb) this.saveDemo();
    },
  };

  function runsFor(runner, fromDate, toDate) {
    const a = iso(fromDate), b = iso(toDate);
    return [...runs.values()]
      .filter((r) => r.runner === runner && r.run_date >= a && r.run_date <= b)
      .sort((x, y) => (x.run_date < y.run_date ? -1 : x.run_date > y.run_date ? 1 : String(x.created_at || '').localeCompare(String(y.created_at || ''))));
  }

  // ---------- State ----------
  let weekStart = mondayOf(today());
  const hashDate = location.hash.slice(1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(hashDate)) weekStart = mondayOf(parseISO(hashDate));

  function setWeek(d) {
    weekStart = mondayOf(d);
    history.replaceState(null, '', '#' + iso(weekStart));
    render();
    window.scrollTo({ top: 0 });
  }

  // ---------- Rendering ----------
  function renderCountdown() {
    const days = daysBetween(today(), RACE_DATE);
    let big, sub;
    if (days > 0) {
      const w = Math.floor(days / 7), d = days % 7;
      big = `${days} days`;
      sub = `${w} wk${w === 1 ? '' : 's'}${d ? ` ${d} d` : ''} to go`;
    } else if (days === 0) { big = 'Race day!'; sub = 'Go get it 🏁'; } else { big = 'Done 🏅'; sub = `${-days} days ago`; }
    const connLabel = { live: 'Live', demo: 'Demo mode', off: 'Offline' }[connState] || 'Connecting…';
    $('#countdown').innerHTML = `
      <div class="race">${esc(RACE_NAME)}
        <small>${RACE_DATE.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}
        · <span class="conn ${connState}"></span>${connLabel}</small></div>
      <div class="big">${big}<small>${sub}</small></div>`;
  }

  function renderWeekLabel() {
    const end = addDays(weekStart, 6);
    const sameMonth = weekStart.getMonth() === end.getMonth();
    const a = weekStart.toLocaleDateString('en-GB', sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' });
    const b = end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const out = Math.round(daysBetween(weekStart, mondayOf(RACE_DATE)) / 7);
    const tag = out > 0 ? `${out} wk${out === 1 ? '' : 's'} to race week` : out === 0 ? 'Race week 🏁' : 'After the race';
    $('#weekLabel').innerHTML = `${a} – ${b}<small>${tag}</small>`;
    $('#datePicker').value = iso(weekStart);
  }

  function renderColheads() {
    $('#colheads').innerHTML = RUNNERS.map((r) => `
      <div class="colhead">
        <span class="name">${esc(r)}</span>
        <button class="copy" data-copy="${esc(r)}" title="Copy last week's plan into this week">⧉ Copy last wk</button>
      </div>`).join('');
  }

  function cardHTML(r) {
    const act = actualOf(r);
    const pk = num(r.planned_distance_km), ps = num(r.planned_duration_s);
    let typeLine = esc(r.type);
    if (r.status === 'swapped' && r.actual_type && r.actual_type !== r.type) typeLine = `${esc(r.type)} ⇄ ${esc(r.actual_type)}`;

    let dist = '', meta = '';
    if (r.type === 'Rest' && !act) {
      dist = '—';
    } else if (act) {
      const ak = act.km;
      dist = pk !== null && ak !== null && Math.abs(pk - ak) >= 0.05 ? `${fmtKm(pk)}→${fmtKm(ak)} km` : ak !== null ? `${fmtKm(ak)} km` : (pk !== null ? `${fmtKm(pk)} km` : '');
      const p = paceOf(act.km, act.sec);
      meta = p ? fmtPace(p) : act.sec ? fmtDuration(act.sec) : '';
    } else {
      dist = pk !== null ? `${fmtKm(pk)} km` : ps ? fmtDuration(ps) : '';
      meta = pk !== null && ps ? fmtDuration(ps) : '';
    }
    const iv = (r.type === 'Intervals' || r.actual_type === 'Intervals') ? intervalsSummary(r.intervals) : '';
    if (iv) meta = meta ? `${iv} · ${meta}` : iv;
    const showType = r.status === 'swapped' ? (r.actual_type || r.type) : r.type;
    return `<button class="card ${typeClass(showType)} s-${r.status}" data-id="${esc(r.id)}">
      <span class="ctype">${typeLine}</span>
      ${dist ? `<span class="cdist">${dist}</span>` : ''}
      ${meta ? `<span class="cmeta">${esc(meta)}</span>` : ''}
      <span class="cstat">${STATUS_ICON[r.status] || ''}</span>
    </button>`;
  }

  function renderGrid() {
    const t = iso(today());
    let html = '';
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i), ds = iso(d);
      html += `<section class="day${ds === t ? ' is-today' : ''}"><h3 class="dayhead">${fmtDay(d)}${ds === t ? ' · Today' : ''}${ds === iso(RACE_DATE) ? ' · 🏁 RACE' : ''}</h3><div class="cells">`;
      for (const runner of RUNNERS) {
        const list = runsFor(runner, d, d);
        html += `<div class="cell">${list.map(cardHTML).join('')}<button class="add" data-add="${esc(runner)}" data-date="${ds}" aria-label="Add run for ${esc(runner)} on ${fmtDay(d)}">+</button></div>`;
      }
      html += '</div></section>';
    }
    $('#grid').innerHTML = html;
  }

  function weekTotals(runner) {
    const list = runsFor(runner, weekStart, addDays(weekStart, 6));
    let plannedKm = 0, doneKm = 0, plannedSec = 0, doneSec = 0, plannedRuns = 0, doneRuns = 0;
    for (const r of list) {
      if (r.type !== 'Rest') {
        plannedKm += num(r.planned_distance_km) || 0;
        plannedSec += num(r.planned_duration_s) || 0;
        plannedRuns++;
      }
      const a = actualOf(r);
      if (a && a.type !== 'Rest') {
        doneKm += a.km || 0;
        doneSec += a.sec || 0;
        doneRuns++;
      }
    }
    return { plannedKm, doneKm, plannedSec, doneSec, plannedRuns, doneRuns };
  }

  function renderTotals() {
    $('#totals').innerHTML = RUNNERS.map((runner) => {
      const t = weekTotals(runner);
      const pct = t.plannedKm ? Math.min(100, (t.doneKm / t.plannedKm) * 100) : (t.doneKm ? 100 : 0);
      return `<div class="tot" title="${esc(runner)} — week totals">
        <div class="tkm">${fmtKm(t.doneKm)}<small> / ${fmtKm(t.plannedKm)} km</small></div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="tline">🏃 ${t.doneRuns}/${t.plannedRuns} runs</div>
        <div class="tline">⏱ ${fmtTotal(t.doneSec)}${t.plannedSec ? ` / ${fmtTotal(t.plannedSec)}` : ''}</div>
      </div>`;
    }).join('');
  }

  function render() {
    renderCountdown();
    renderWeekLabel();
    renderGrid();
    renderTotals();
  }

  // ---------- Editor ----------
  const dlg = $('#editor');
  let draft = null;

  const typeOptions = (sel, withBlank = false) =>
    (withBlank ? '<option value="">Same as planned</option>' : '') +
    TYPES.map((t) => `<option ${t === sel ? 'selected' : ''}>${t}</option>`).join('');

  function openEditor(run) {
    draft = JSON.parse(JSON.stringify(run));
    if (!Array.isArray(draft.intervals)) draft.intervals = [];
    const isNew = !runs.has(draft.id);
    const d = parseISO(draft.run_date);

    dlg.innerHTML = `
      <form method="dialog" novalidate>
        <div class="ed-head">
          <h2>${esc(draft.runner)}<small>${d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</small></h2>
          <button type="button" class="icon-btn" data-act="close" aria-label="Close">✕</button>
        </div>
        <div class="ed-body">
          <div class="fsec">
            <h3>Plan</h3>
            <div class="row">
              <label class="field"><span>Type</span><select name="type">${typeOptions(draft.type)}</select></label>
              <label class="field"><span>Date</span><input type="date" name="run_date" value="${esc(draft.run_date)}"></label>
            </div>
            <div class="row">
              <label class="field"><span>Distance (km)</span><input name="planned_distance_km" inputmode="decimal" placeholder="e.g. 10" value="${esc(fmtKm(num(draft.planned_distance_km)))}"></label>
              <label class="field"><span>Duration</span><input name="planned_duration" inputmode="numeric" placeholder="mm:ss or h:mm:ss" value="${esc(fmtDuration(num(draft.planned_duration_s)))}"></label>
            </div>
            <div class="calc" id="plannedCalc"></div>
          </div>

          <div class="fsec" id="ivSec"></div>

          <div class="fsec">
            <h3>Status</h3>
            <div class="seg" role="radiogroup">
              ${STATUSES.map((s) => `<label><input type="radio" name="status" value="${s}" ${draft.status === s ? 'checked' : ''}><span class="st-${s}">${s[0].toUpperCase() + s.slice(1)}</span></label>`).join('')}
            </div>
          </div>

          <div class="fsec" id="actualSec">
            <h3>What you actually did</h3>
            <div id="actualTypeWrap"><label class="field"><span>Actual type</span><select name="actual_type">${typeOptions(draft.actual_type, true)}</select></label></div>
            <div class="row">
              <label class="field"><span>Distance (km)</span><input name="actual_distance_km" inputmode="decimal" placeholder="km" value="${esc(fmtKm(num(draft.actual_distance_km)))}"></label>
              <label class="field"><span>Time</span><input name="actual_duration" inputmode="numeric" placeholder="mm:ss or h:mm:ss" value="${esc(fmtDuration(num(draft.actual_duration_s)))}"></label>
            </div>
            <p class="hint" id="actualHint"></p>
            <div class="calc" id="actualCalc"></div>
          </div>

          <div class="fsec" id="compareSec"></div>

          <div class="fsec">
            <h3>Notes</h3>
            <label class="field"><textarea name="notes" rows="3" placeholder="How did it feel? Route, weather, shoes…">${esc(draft.notes || '')}</textarea></label>
          </div>
        </div>
        <div class="ed-foot">
          ${isNew ? '' : '<button type="button" class="btn danger" data-act="delete">Delete</button>'}
          <span class="spacer"></span>
          <button type="button" class="btn" data-act="close">Cancel</button>
          <button type="submit" class="btn primary" data-act="save">Save</button>
        </div>
      </form>`;

    renderIntervals();
    updateEditor();
    dlg.showModal();
    $('.ed-body', dlg).scrollTop = 0;
  }

  // Pull values from the form into the draft
  function readForm() {
    const f = $('form', dlg);
    draft.type = f.type.value;
    draft.run_date = f.run_date.value || draft.run_date;
    draft.planned_distance_km = num(String(f.planned_distance_km.value).replace(',', '.'));
    draft.planned_duration_s = parseDuration(f.planned_duration.value);
    draft.status = (f.querySelector('input[name=status]:checked') || {}).value || 'planned';
    draft.actual_type = f.actual_type.value || null;
    draft.actual_distance_km = num(String(f.actual_distance_km.value).replace(',', '.'));
    draft.actual_duration_s = parseDuration(f.actual_duration.value);
    draft.notes = f.notes.value.trim() || null;
    $$('.block', dlg).forEach((el, i) => {
      const b = draft.intervals[i];
      b.reps = Math.max(0, Math.min(50, parseInt($('[name=reps]', el).value, 10) || 0));
      b.distance_m = num($('[name=distance_m]', el).value);
      b.target_pace_s = parseDuration($('[name=target_pace]', el).value);
      b.recovery_s = parseDuration($('[name=recovery]', el).value, 's');
      b.recovery_kind = $('[name=recovery_kind]', el).value;
      const splitInputs = $$('[name=split]', el);
      b.splits = splitInputs.map((inp) => parseDuration(inp.value, 's'));
    });
  }

  function renderIntervals() {
    const sec = $('#ivSec', dlg);
    const f = $('form', dlg);
    const show = f.type.value === 'Intervals' || f.actual_type.value === 'Intervals';
    sec.hidden = !show;
    if (!show) return;
    if (!draft.intervals.length) draft.intervals.push({ reps: 6, distance_m: 800, target_pace_s: 220, recovery_s: 90, recovery_kind: 'jog', splits: [] });
    sec.innerHTML = `<h3>Interval blocks</h3>
      ${draft.intervals.map((b, i) => `
        <div class="block" data-i="${i}">
          <div class="block-head"><span>Block ${i + 1}</span><button type="button" class="btn small danger" data-act="rmblock" data-i="${i}">Remove</button></div>
          <div class="row3">
            <label class="field"><span>Reps</span><input name="reps" inputmode="numeric" value="${esc(b.reps ?? '')}"></label>
            <label class="field"><span>Distance (m)</span><input name="distance_m" inputmode="numeric" value="${esc(b.distance_m ?? '')}"></label>
            <label class="field"><span>Target pace</span><input name="target_pace" inputmode="numeric" placeholder="m:ss /km" value="${esc(fmtDuration(b.target_pace_s))}"></label>
          </div>
          <div class="row">
            <label class="field"><span>Recovery (sec or m:ss)</span><input name="recovery" inputmode="numeric" value="${esc(b.recovery_s ?? '')}"></label>
            <label class="field"><span>Recovery type</span><select name="recovery_kind">
              ${['jog', 'walk', 'stand'].map((k) => `<option ${b.recovery_kind === k ? 'selected' : ''}>${k}</option>`).join('')}
            </select></label>
          </div>
          <div class="calc" data-blocksum></div>
          <div class="splits">
            ${Array.from({ length: b.reps || 0 }, (_, r) => `
              <label class="split"><span>Rep ${r + 1}</span>
                <input name="split" inputmode="numeric" placeholder="${b.target_pace_s && b.distance_m ? fmtDuration(b.target_pace_s * b.distance_m / 1000) : 'm:ss'}" value="${esc(fmtDuration(b.splits?.[r]))}">
                <small data-splitpace></small></label>`).join('')}
          </div>
        </div>`).join('')}
      <button type="button" class="btn small" data-act="addblock">+ Add block</button>
      <p class="hint" style="margin-top:8px">Split = time for each rep (m:ss, or plain seconds).</p>`;
  }

  function updateEditor() {
    readForm();
    const st = draft.status;
    $('#plannedCalc', dlg).innerHTML = speedLine(draft.planned_distance_km, draft.planned_duration_s);

    // Actual section only for done / swapped
    const actualSec = $('#actualSec', dlg);
    actualSec.hidden = !(st === 'done' || st === 'swapped');
    $('#actualTypeWrap', dlg).hidden = st !== 'swapped';
    $('#actualHint', dlg).textContent = st === 'done'
      ? 'Leave blank to use the planned distance/time.'
      : 'Record what you did instead of the plan.';
    const a = actualOf(draft);
    $('#actualCalc', dlg).innerHTML = a ? speedLine(a.km, a.sec) : '';
    const f = $('form', dlg);
    f.actual_distance_km.placeholder = st === 'done' && draft.planned_distance_km !== null ? fmtKm(draft.planned_distance_km) : 'km';
    f.actual_duration.placeholder = st === 'done' && draft.planned_duration_s ? fmtDuration(draft.planned_duration_s) : 'mm:ss or h:mm:ss';

    // Interval per-block summary and split paces
    $$('.block', dlg).forEach((el, i) => {
      const b = draft.intervals[i];
      const work = (b.reps || 0) * (b.distance_m || 0);
      const done = (b.splits || []).filter((s) => s);
      const avg = done.length ? done.reduce((x, y) => x + y, 0) / done.length : null;
      const sum = $('[data-blocksum]', el);
      sum.innerHTML = work ? `${b.reps} × ${b.distance_m} m${b.target_pace_s ? ` @ ${fmtPace(b.target_pace_s)}` : ''}${b.recovery_s ? `, ${fmtDuration(b.recovery_s)} ${b.recovery_kind}` : ''} · work ${fmtKm(work / 1000)} km` +
        (avg && b.distance_m ? `<br>Avg rep <b>${fmtDuration(avg)}</b> → <b>${fmtPace(avg / (b.distance_m / 1000))}</b>` : '') : '';
      const targetRep = b.target_pace_s && b.distance_m ? fmtDuration(b.target_pace_s * b.distance_m / 1000) : 'm:ss';
      $$('[name=split]', el).forEach((inp) => { inp.placeholder = targetRep; });
      $$('[data-splitpace]', el).forEach((small, r) => {
        const s = b.splits?.[r];
        small.className = '';
        if (!s || !b.distance_m) { small.textContent = ''; return; }
        const p = s / (b.distance_m / 1000);
        small.textContent = fmtPace(p);
        if (b.target_pace_s) small.className = p <= b.target_pace_s + 1 ? 'fast' : 'slow';
      });
    });

    renderCompare();
  }

  function renderCompare() {
    const sec = $('#compareSec', dlg);
    const a = actualOf(draft);
    if (!a && draft.status !== 'missed') { sec.innerHTML = ''; return; }
    const pk = draft.planned_distance_km, ps = draft.planned_duration_s;
    const pp = paceOf(pk, ps), pv = kmh(pk, ps);
    const ak = a?.km ?? null, as = a?.sec ?? null;
    const ap = paceOf(ak, as), av = kmh(ak, as);
    const cls = (better) => (better === null ? '' : better ? 'diff-up' : 'diff-down');
    const cmp = (x, y, higherIsBetter) => (x === null || y === null || x === undefined || y === undefined || Math.abs(x - y) < 1e-9 ? null : higherIsBetter ? y > x : y < x);
    const rows = [
      ['Type', esc(draft.type), a ? esc(a.type) : 'Missed', ''],
      ['Distance', pk !== null ? `${fmtKm(pk)} km` : '–', ak !== null ? `${fmtKm(ak)} km` : '–', cls(cmp(pk, ak, true))],
      ['Time', ps ? fmtDuration(ps) : '–', as ? fmtDuration(as) : '–', ''],
      ['Pace', fmtPace(pp), fmtPace(ap), cls(cmp(pp, ap, false))],
      ['km/h', fmtSpeed(pv), fmtSpeed(av), cls(cmp(pv, av, true))],
      ['mph', fmtSpeed(pv && pv / KM_PER_MILE), fmtSpeed(av && av / KM_PER_MILE), cls(cmp(pv, av, true))],
    ];
    sec.innerHTML = `<h3>Planned vs actual</h3>
      <table class="compare"><thead><tr><th></th><th>Planned</th><th>Actual</th></tr></thead><tbody>
      ${rows.map(([k, p, x, c]) => `<tr><th>${k}</th><td>${p}</td><td class="${c}">${x}</td></tr>`).join('')}
      </tbody></table>`;
  }

  dlg.addEventListener('input', (e) => {
    if (e.target.name === 'reps') { readForm(); renderIntervals(); restoreFocus(e.target); }
    updateEditor();
  });
  dlg.addEventListener('change', (e) => {
    if (e.target.name === 'type' || e.target.name === 'actual_type') {
      readForm(); renderIntervals();
    }
    updateEditor();
  });
  function restoreFocus(oldEl) {
    const i = oldEl.closest('.block')?.dataset.i;
    const el = $(`.block[data-i="${i}"] [name=reps]`, dlg);
    if (el) { el.focus(); el.setSelectionRange?.(el.value.length, el.value.length); }
  }

  dlg.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'close') { dlg.close(); return; }
    if (act === 'addblock') {
      readForm();
      draft.intervals.push({ reps: 4, distance_m: 400, target_pace_s: null, recovery_s: 60, recovery_kind: 'jog', splits: [] });
      renderIntervals(); updateEditor(); return;
    }
    if (act === 'rmblock') {
      readForm();
      draft.intervals.splice(+btn.dataset.i, 1);
      if (!draft.intervals.length) draft.intervals.push({ reps: 0, distance_m: null, target_pace_s: null, recovery_s: null, recovery_kind: 'jog', splits: [] });
      renderIntervals(); updateEditor(); return;
    }
    if (act === 'delete') {
      if (!confirm('Delete this run?')) return;
      try { await Store.remove(draft.id); dlg.close(); render(); toast('Run deleted'); } catch (err) { toast('Could not delete: ' + err.message); }
      return;
    }
    if (act === 'save') {
      e.preventDefault();
      readForm();
      const out = { ...draft };
      if (out.status === 'planned' || out.status === 'missed') {
        out.actual_type = null; out.actual_distance_km = null; out.actual_duration_s = null;
      }
      if (out.status === 'done') out.actual_type = null;
      const ivType = out.type === 'Intervals' || out.actual_type === 'Intervals';
      out.intervals = ivType ? out.intervals.filter((b) => b.reps && b.distance_m).map((b) => ({ ...b, splits: (b.splits || []).slice(0, b.reps) })) : [];
      btn.disabled = true;
      try {
        await Store.save(out);
        dlg.close();
        if (iso(mondayOf(parseISO(out.run_date))) !== iso(weekStart)) toast(`Saved to ${fmtDay(parseISO(out.run_date))}`);
        render();
      } catch (err) {
        toast('Could not save: ' + err.message);
      } finally { btn.disabled = false; }
    }
  });
  dlg.addEventListener('close', () => { draft = null; });

  // ---------- Copy last week ----------
  async function copyLastWeek(runner) {
    const prev = addDays(weekStart, -7);
    const src = runsFor(runner, prev, addDays(prev, 6));
    if (!src.length) { toast(`${runner} has no runs last week to copy`); return; }
    const existing = runsFor(runner, weekStart, addDays(weekStart, 6));
    const msg = existing.length
      ? `${runner} already has ${existing.length} run(s) this week. Add last week's ${src.length} planned run(s) as well?`
      : `Copy ${runner}'s ${src.length} run(s) from last week into this week as planned?`;
    if (!confirm(msg)) return;
    const rows = src.map((r) => ({
      id: uuid(),
      runner,
      run_date: iso(addDays(parseISO(r.run_date), 7)),
      type: r.type,
      planned_distance_km: r.planned_distance_km,
      planned_duration_s: r.planned_duration_s,
      notes: r.notes,
      status: 'planned',
      intervals: (r.intervals || []).map((b) => ({ ...b, splits: [] })),
    }));
    try { await Store.insertMany(rows); render(); toast(`Copied ${rows.length} run(s) for ${runner}`); } catch (err) { toast('Could not copy: ' + err.message); }
  }

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }

  // ---------- Events ----------
  $('#prevWeek').onclick = () => setWeek(addDays(weekStart, -7));
  $('#nextWeek').onclick = () => setWeek(addDays(weekStart, 7));
  $('#todayBtn').onclick = () => setWeek(today());
  $('#datePicker').addEventListener('change', (e) => { if (e.target.value) setWeek(parseISO(e.target.value)); });

  $('#grid').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (card) { const r = runs.get(card.dataset.id); if (r) openEditor(r); return; }
    const add = e.target.closest('[data-add]');
    if (add) openEditor({ id: uuid(), runner: add.dataset.add, run_date: add.dataset.date, type: 'Easy', status: 'planned', intervals: [] });
  });
  $('#colheads').addEventListener('click', (e) => {
    const b = e.target.closest('[data-copy]');
    if (b) copyLastWeek(b.dataset.copy);
  });

  // Swipe left/right on the grid to change week
  let touch = null;
  $('#grid').addEventListener('touchstart', (e) => { const t = e.touches[0]; touch = { x: t.clientX, y: t.clientY }; }, { passive: true });
  $('#grid').addEventListener('touchend', (e) => {
    if (!touch) return;
    const t = e.changedTouches[0], dx = t.clientX - touch.x, dy = t.clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) setWeek(addDays(weekStart, dx < 0 ? 7 : -7));
  }, { passive: true });

  // Phones drop the websocket when asleep: resync when the page comes back
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !sb) return;
    try { await Store.reload(); render(); } catch { /* keep showing cached data */ }
  });
  // Keep the "today" highlight and countdown right if the page stays open past midnight
  setInterval(renderCountdown, 60 * 1000);

  // ---------- Boot ----------
  renderColheads();
  render();
  Store.init()
    .then(render)
    .catch((err) => { connState = 'off'; render(); toast('Could not load data: ' + err.message); });
})();
