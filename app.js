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
    const s = String(str).trim().toLowerCase().replace(/,/g, '.');
    if (!s) return null;
    // Phone number pads have no ":", so "." (or ",") works too: 4.30 → 4:30, 1.05.00 → 1:05:00
    if (/^\d+(?:[.:]\d{2}){1,2}$/.test(s)) {
      const p = s.split(/[.:]/).map(Number);
      return p.length === 2 ? p[0] * 60 + p[1] : p[0] * 3600 + p[1] * 60 + p[2];
    }
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
  const paceSpeeds = (secPerKm) => (secPerKm ? `${fmtSpeed(3600 / secPerKm)} km/h · ${fmtSpeed(3600 / secPerKm / KM_PER_MILE)} mph` : '');
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
        km: num(r.actual_distance_km) ?? plannedOf(r).km,
        sec: num(r.actual_duration_s) ?? plannedOf(r).sec,
      };
    }
    if (r.status === 'swapped') {
      return { type: r.actual_type || r.type, km: num(r.actual_distance_km), sec: num(r.actual_duration_s) };
    }
    return null;
  }
  // Rep distance in metres. Small numbers are km (0.9 → 900 m); "900m" and "0.9km" also work.
  function repMeters(v) {
    const s = String(v ?? '').trim().toLowerCase().replace(',', '.');
    const m = s.match(/^(\d+(?:\.\d+)?)\s*(km|k|m)?$/);
    if (!m) return null;
    const n = +m[1];
    if (!n) return null;
    const km = m[2] === 'km' || m[2] === 'k' || (!m[2] && n < 50);
    return Math.round(km ? n * 1000 : n);
  }
  const repBlocks = (blocks) => (blocks || [])
    .filter((b) => b.kind !== 'segment')
    .map((b) => ({ ...b, distance_m: repMeters(b.distance_m) }))
    .filter((b) => b.reps && b.distance_m);

  const intervalsSummary = (blocks) => repBlocks(blocks)
    .map((b) => `${b.reps}×${b.distance_m >= 1000 && b.distance_m % 1000 === 0 ? b.distance_m / 1000 + 'k' : b.distance_m}`)
    .join(' + ');

  // Total rep distance of interval blocks, in km
  const intervalsKm = (blocks) => repBlocks(blocks).reduce((s, b) => s + (b.reps * b.distance_m) / 1000, 0);

  // The plan: for Intervals / Long / Tempo it comes from the blocks, otherwise from the planned fields
  function plannedOf(r) {
    if (r.type === 'Intervals') {
      const reps = repBlocks(r.intervals);
      const km = intervalsKm(reps);
      if (km) return { km, sec: reps.every((b) => b.target_pace_s) ? reps.reduce((s, b) => s + b.target_pace_s * b.reps * b.distance_m / 1000, 0) : null };
    }
    if (r.type === 'Long' || r.type === 'Tempo') {
      const segs = (r.intervals || []).filter((b) => b.kind === 'segment' && num(b.distance_km));
      const km = segs.reduce((s, b) => s + num(b.distance_km), 0);
      if (km) return { km, sec: segs.every((b) => b.target_pace_s) ? segs.reduce((s, b) => s + num(b.distance_km) * b.target_pace_s, 0) : null };
    }
    return { km: num(r.planned_distance_km), sec: num(r.planned_duration_s) };
  }

  const segmentsSummary = (blocks) => (blocks || [])
    .filter((b) => b.kind === 'segment' && b.distance_km)
    .map((b) => fmtKm(b.distance_km))
    .join('+');

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
    $('#colheads').innerHTML = RUNNERS.map((r, i) => `
      <div class="colhead r${i}">
        <span class="name">${esc(r)}</span>
        <button class="copy" data-copy="${esc(r)}" title="Copy last week's plan into this week">⧉ Copy last wk</button>
      </div>`).join('');
  }

  function cardHTML(r) {
    const act = actualOf(r);
    const { km: pk, sec: ps } = plannedOf(r);
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
    const iv = intervalsSummary(r.intervals) || segmentsSummary(r.intervals);
    if (iv) meta = meta ? `${iv} · ${meta}` : iv;
    const showType = r.status === 'swapped' ? (r.actual_type || r.type) : r.type;
    return `<button class="card ${typeClass(showType)} s-${r.status}${clip && clip.id === r.id ? ' is-clip' : ''}" data-id="${esc(r.id)}">
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
      for (const [ri, runner] of RUNNERS.entries()) {
        const list = runsFor(runner, d, d);
        html += `<div class="cell r${ri}">${list.map(cardHTML).join('')}<button class="add" data-add="${esc(runner)}" data-date="${ds}" aria-label="${clip ? 'Paste' : 'Add run'} for ${esc(runner)} on ${fmtDay(d)}">${clip ? '⧉ Paste' : '+'}</button></div>`;
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
        const p = plannedOf(r);
        plannedKm += p.km || 0;
        plannedSec += p.sec || 0;
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
    $('#totals').innerHTML = RUNNERS.map((runner, ri) => {
      const t = weekTotals(runner);
      const pct = t.plannedKm ? Math.min(100, (t.doneKm / t.plannedKm) * 100) : (t.doneKm ? 100 : 0);
      return `<div class="tot r${ri}" title="${esc(runner)} — week totals">
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
    renderClipbar();
  }

  // ---------- Editor ----------
  const dlg = $('#editor');
  let draft = null;

  const typeOptions = (sel, withBlank = false) =>
    (withBlank ? '<option value="">Same as planned</option>' : '') +
    TYPES.map((t) => `<option ${t === sel ? 'selected' : ''}>${t}</option>`).join('');
  const numIn = (v) => num(String(v ?? '').trim().replace(',', '.'));
  const fmtKm2 = (km) => (km === null || km === undefined ? '' : (Math.round(km * 100) / 100).toString());
  const SEGMENT_TYPES = ['Long', 'Tempo'];
  const SEGMENT_LABELS = ['Warm-up', 'Easy', 'Steady', 'Marathon pace', 'Half-marathon pace', 'Tempo', 'Fast finish', 'Cool-down'];
  const newInterval = () => ({ reps: 6, distance_m: 800, target_pace_s: 220, recovery_s: 90, recovery_kind: 'jog', splits: [] });
  const newSegment = (label = '') => ({ kind: 'segment', label, distance_km: null, target_pace_s: null, actual_s: null });
  const defaultSegments = (type) => (type === 'Tempo'
    ? [newSegment('Warm-up'), newSegment('Tempo'), newSegment('Cool-down')]
    : [newSegment('Easy'), newSegment('Fast finish')]);

  // Which block editor applies: intervals (reps + recovery) or segments (Long / Tempo)
  function blockMode() {
    const types = [draft.type];
    if (draft.status === 'swapped' && draft.actual_type) types.push(draft.actual_type);
    if (types.includes('Intervals')) return 'intervals';
    if (types.some((t) => SEGMENT_TYPES.includes(t))) return 'segments';
    return null;
  }

  // ----- Distance / time / pace triads: fill any two, the third is calculated -----
  // A triad is an element with data-triad holding inputs with data-role dist | time | pace (| speed).
  // data-order remembers the two most recently typed roles; the remaining one is computed.
  function triadCompute(g) {
    const get = (r) => $(`[data-role="${r}"]`, g);
    $$('[data-role]', g).forEach((el) => el.classList.remove('is-calc'));
    const order = (g.dataset.order || '').split(',').filter(Boolean);
    if (order.length < 2) return;
    const target = ['dist', 'time', 'pace'].find((r) => !order.includes(r));
    const km = numIn(get('dist').value), sec = parseDuration(get('time').value);
    // Keep the unrounded pace from triadInit while the pace field still shows it
    const exact = +g.dataset.exactPace;
    const pace = exact && get('pace').value === fmtDuration(exact) ? exact : parseDuration(get('pace').value);
    let out = '';
    if (target === 'dist' && sec && pace) out = fmtKm2(sec / pace);
    if (target === 'time' && km && pace) out = fmtDuration(km * pace);
    if (target === 'pace' && km && sec) out = fmtDuration(sec / km);
    get(target).value = out;
    if (out) get(target).classList.add('is-calc');
    const speed = get('speed');
    if (speed && target === 'pace') {
      speed.value = out ? (km / (sec / 3600)).toFixed(1) : '';
      if (out) speed.classList.add('is-calc');
    }
  }
  function triadInput(input) {
    const g = input.closest('[data-triad]');
    if (!g || !input.dataset.role) return;
    const get = (r) => $(`[data-role="${r}"]`, g);
    let role = input.dataset.role;
    if (role === 'speed') {
      const v = numIn(input.value);
      get('pace').value = v > 0 ? fmtDuration(3600 / v) : '';
      role = 'pace';
    } else if (role === 'pace' && get('speed')) {
      const p = parseDuration(input.value);
      get('speed').value = p ? (3600 / p).toFixed(1) : '';
    }
    let order = (g.dataset.order || '').split(',').filter((r) => r && r !== role);
    if (get(role).value.trim()) order.unshift(role);
    order = order.filter((r) => get(r).value.trim()).slice(0, 2);
    g.dataset.order = order.join(',');
    triadCompute(g);
  }
  // With a saved distance and time, show the pace and treat it as fixed:
  // changing the distance then changes the time, not the pace.
  function triadInit(g) {
    const get = (r) => $(`[data-role="${r}"]`, g);
    delete g.dataset.exactPace;
    const km = numIn(get('dist').value), sec = parseDuration(get('time').value);
    if (km > 0 && sec > 0 && !get('pace').value.trim()) {
      g.dataset.exactPace = sec / km;
      get('pace').value = fmtDuration(sec / km);
      if (get('speed')) get('speed').value = (km / (sec / 3600)).toFixed(1);
      g.dataset.order = 'dist,pace';
      $$('[data-role]', g).forEach((el) => el.classList.remove('is-calc'));
      get('time').classList.add('is-calc');
      return;
    }
    const filled = ['dist', 'time', 'pace'].filter((r) => get(r).value.trim());
    g.dataset.order = filled.slice(0, 2).join(',');
    triadCompute(g);
  }
  const triadFields = (prefix, km, sec, opts = {}) => `
    <div class="row">
      <label class="field"><span>Distance (km)</span><input name="${prefix}_distance_km" data-role="dist" inputmode="decimal" placeholder="${opts.distPh || 'km'}" value="${esc(fmtKm2(km))}"></label>
      <label class="field"><span>${opts.timeLabel || 'Time'}</span><input name="${prefix}_duration" data-role="time" inputmode="decimal" data-dur="min" placeholder="${opts.timePh || 'mm:ss or h:mm:ss'}" value="${esc(fmtDuration(sec))}"></label>
    </div>
    <div class="row">
      <label class="field"><span>Pace (min/km)</span><input name="${prefix}_pace" data-role="pace" inputmode="decimal" data-dur="min" placeholder="m:ss"></label>
      <label class="field"><span>Speed (km/h)</span><input name="${prefix}_speed" data-role="speed" inputmode="decimal" placeholder="km/h"></label>
    </div>`;

  function openEditor(run) {
    draft = JSON.parse(JSON.stringify(run));
    const blocks = Array.isArray(draft.intervals) ? draft.intervals : [];
    draft._iv = blocks.filter((b) => b.kind !== 'segment').map((b) => ({ ...b, distance_m: repMeters(b.distance_m) ?? b.distance_m }));
    draft._seg = blocks.filter((b) => b.kind === 'segment');
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
            <div id="plannedFields">
              <div data-triad id="plannedTriad">${triadFields('planned', num(draft.planned_distance_km), num(draft.planned_duration_s), { distPh: 'e.g. 10', timeLabel: 'Duration' })}</div>
              <p class="hint">Fill in any two of distance, time and pace/speed and the third is calculated. Times can use a dot: 4.30 = 4:30.</p>
              <div class="calc" id="plannedCalc"></div>
            </div>
          </div>

          <div class="fsec" id="blockSec"></div>

          <div class="fsec">
            <h3>Status</h3>
            <div class="seg" role="radiogroup">
              ${STATUSES.map((s) => `<label><input type="radio" name="status" value="${s}" ${draft.status === s ? 'checked' : ''}><span class="st-${s}">${s[0].toUpperCase() + s.slice(1)}</span></label>`).join('')}
            </div>
          </div>

          <div class="fsec" id="actualSec">
            <h3>What you actually did</h3>
            <div id="actualTypeWrap"><label class="field"><span>Actual type</span><select name="actual_type">${typeOptions(draft.actual_type, true)}</select></label></div>
            <div data-triad id="actualTriad">${triadFields('actual', num(draft.actual_distance_km), num(draft.actual_duration_s))}</div>
            <p class="hint" id="actualHint"></p>
            <div class="calc" id="actualCalc"></div>
          </div>

          <div class="fsec" id="compareSec"></div>

          <div class="fsec">
            <h3>Notes</h3>
            <label class="field"><textarea name="notes" rows="3" placeholder="How did it feel? Route, weather, shoes…">${esc(draft.notes || '')}</textarea></label>
          </div>

          <div class="fsec"><button type="button" class="btn copy-open" data-act="copyrun">⧉ Copy to other runners or days…</button></div>
        </div>
        <div class="ed-foot">
          ${isNew ? '' : '<button type="button" class="btn danger" data-act="delete">Delete</button>'}
          <span class="spacer"></span>
          <button type="button" class="btn" data-act="close">Cancel</button>
          <button type="submit" class="btn primary" data-act="save">Save</button>
        </div>
      </form>`;

    triadInit($('#plannedTriad', dlg));
    triadInit($('#actualTriad', dlg));
    readForm();
    renderBlocks();
    updateEditor();
    dlg.showModal();
    $('.ed-body', dlg).scrollTop = 0;
  }

  // Pull values from the form into the draft
  function readForm() {
    const f = $('form', dlg);
    draft.type = f.type.value;
    draft.run_date = f.run_date.value || draft.run_date;
    draft.planned_distance_km = numIn(f.planned_distance_km.value);
    draft.planned_duration_s = parseDuration(f.planned_duration.value);
    draft.status = (f.querySelector('input[name=status]:checked') || {}).value || 'planned';
    draft.actual_type = f.actual_type.value || null;
    draft.actual_distance_km = numIn(f.actual_distance_km.value);
    draft.actual_duration_s = parseDuration(f.actual_duration.value);
    draft.notes = f.notes.value.trim() || null;
    $$('.block', dlg).forEach((el) => {
      const i = +el.dataset.i;
      if (el.dataset.kind === 'segment') {
        const b = draft._seg[i];
        b.label = $('[name=seg_label]', el).value.trim();
        b.distance_km = numIn($('[name=seg_dist]', el).value);
        b.target_pace_s = parseDuration($('[name=seg_pace]', el).value);
        b.actual_s = parseDuration($('[name=seg_actual]', el).value);
        return;
      }
      const b = draft._iv[i];
      b.reps = Math.max(0, Math.min(50, parseInt($('[name=reps]', el).value, 10) || 0));
      b.distance_m = repMeters($('[name=distance_m]', el).value);
      b.target_pace_s = parseDuration($('[name=target_pace]', el).value);
      b.recovery_s = parseDuration($('[name=recovery]', el).value, 's');
      b.recovery_kind = $('[name=recovery_kind]', el).value;
      b.splits = $$('[name=split]', el).map((inp) => parseDuration(inp.value, 's'));
    });
    // Intervals / Long / Tempo: the plan is the blocks, so their totals become the planned distance and time
    const t = blockPlanTotals();
    if (t && t.km) {
      draft.planned_distance_km = Math.round(t.km * 100) / 100;
      draft.planned_duration_s = t.planned ? Math.round(t.planned) : null;
    }
  }
  const plansFromBlocks = (type) => type === 'Intervals' || SEGMENT_TYPES.includes(type);
  function blockPlanTotals() {
    if (draft.type === 'Intervals') return intervalTotals();
    if (SEGMENT_TYPES.includes(draft.type)) return segmentTotals();
    return null;
  }

  const GRIP = '<span class="grip" data-grip aria-label="Drag to reorder" title="Drag to reorder">⠿</span>';

  // ----- Drag a block by its ⠿ handle to reorder -----
  let drag = null;
  dlg.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest('[data-grip]');
    if (!grip) return;
    e.preventDefault();
    readForm();
    const el = grip.closest('.block');
    const blocks = $$('.block', dlg);
    const from = blocks.indexOf(el);
    const rects = blocks.map((b) => b.getBoundingClientRect());
    const step = blocks.length > 1 ? Math.abs(rects[1].top - rects[0].top) - rects[0].height + rects[from].height : rects[from].height;
    drag = { el, blocks, rects, from, to: from, y0: e.clientY, step, id: e.pointerId };
    grip.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
  });
  dlg.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { el, blocks, rects, from, step } = drag;
    const dy = e.clientY - drag.y0;
    el.style.transform = `translateY(${dy}px)`;
    const mid = rects[from].top + rects[from].height / 2 + dy;
    let to = 0;
    rects.forEach((r, i) => { if (i !== from && mid > r.top + r.height / 2) to++; });
    drag.to = to;
    blocks.forEach((b, i) => {
      if (i === from) return;
      const shift = from < i && i <= to ? -step : to <= i && i < from ? step : 0;
      b.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  });
  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const { blocks, from, to } = drag;
    drag = null;
    blocks.forEach((b) => { b.style.transform = ''; b.classList.remove('dragging'); });
    if (from === to) return;
    const list = $('#blockSec', dlg).dataset.mode === 'segments' ? draft._seg : draft._iv;
    list.splice(to, 0, list.splice(from, 1)[0]);
    renderBlocks();
    updateEditor();
  }
  dlg.addEventListener('pointerup', endDrag);
  dlg.addEventListener('pointercancel', endDrag);

  function renderBlocks() {
    const sec = $('#blockSec', dlg);
    const mode = blockMode();
    sec.hidden = !mode;
    sec.dataset.mode = mode || '';
    if (mode === 'intervals') renderIntervals(sec);
    else if (mode === 'segments') renderSegments(sec);
    else sec.innerHTML = '';
  }

  function renderIntervals(sec) {
    if (!draft._iv.length) draft._iv.push(newInterval());
    const grip = draft._iv.length > 1 ? GRIP : '';
    sec.innerHTML = `<h3>Interval blocks</h3>
      ${draft._iv.map((b, i) => `
        <div class="block" data-i="${i}">
          <div class="block-head">${grip}<span class="block-title">Block ${i + 1}</span><button type="button" class="btn small danger" data-act="rmblock" data-i="${i}">Remove</button></div>
          <div class="row3">
            <label class="field"><span>Reps</span><input name="reps" inputmode="numeric" value="${esc(b.reps ?? '')}"></label>
            <label class="field"><span>Distance (m or km)</span><input name="distance_m" inputmode="decimal" placeholder="900 or 0.9" value="${esc(b.distance_m ?? '')}"></label>
            <label class="field"><span>Target pace</span><input name="target_pace" inputmode="decimal" data-dur="min" placeholder="m:ss /km" value="${esc(fmtDuration(b.target_pace_s))}"></label>
          </div>
          <div class="row">
            <label class="field"><span>Recovery (sec or m.ss)</span><input name="recovery" inputmode="decimal" data-dur="s" value="${esc(fmtDuration(b.recovery_s))}"></label>
            <label class="field"><span>Recovery type</span><select name="recovery_kind">
              ${['jog', 'walk', 'stand'].map((k) => `<option ${b.recovery_kind === k ? 'selected' : ''}>${k}</option>`).join('')}
            </select></label>
          </div>
          <div class="calc" data-blocksum></div>
          <div class="splits">
            ${Array.from({ length: b.reps || 0 }, (_, r) => `
              <label class="split"><span>Rep ${r + 1}</span>
                <input name="split" inputmode="decimal" data-dur="s" placeholder="m:ss" value="${esc(fmtDuration(b.splits?.[r]))}">
                <small data-splitpace></small></label>`).join('')}
          </div>
        </div>`).join('')}
      <button type="button" class="btn small" data-act="addblock">+ Add block</button>
      <div class="calc" id="ivTotal" style="margin-top:10px"></div>
      <p class="hint" style="margin-top:8px">Split = time for each rep: 3.36 or 3:36, or plain seconds. Drag ⠿ to reorder blocks.</p>`;
  }

  function renderSegments(sec) {
    if (!draft._seg.length) draft._seg.push(...defaultSegments(draft.type));
    const grip = draft._seg.length > 1 ? GRIP : '';
    sec.innerHTML = `<h3>Blocks</h3>
      <datalist id="segLabels">${SEGMENT_LABELS.map((l) => `<option value="${esc(l)}">`).join('')}</datalist>
      ${draft._seg.map((b, i) => `
        <div class="block" data-i="${i}" data-kind="segment">
          <div class="block-head">
            ${grip}<input class="seg-label" name="seg_label" list="segLabels" placeholder="Block ${i + 1}" value="${esc(b.label || '')}" aria-label="Block name">
            <button type="button" class="btn small danger" data-act="rmblock" data-i="${i}">Remove</button>
          </div>
          <div class="row3" data-triad>
            <label class="field"><span>Distance (km)</span><input name="seg_dist" data-role="dist" inputmode="decimal" placeholder="km" value="${esc(fmtKm2(b.distance_km))}"></label>
            <label class="field"><span>Target pace</span><input name="seg_pace" data-role="pace" inputmode="decimal" data-dur="min" placeholder="m:ss /km" value="${esc(fmtDuration(b.target_pace_s))}"></label>
            <label class="field"><span>Target time</span><input name="seg_time" data-role="time" inputmode="decimal" data-dur="min" placeholder="m:ss"></label>
          </div>
          <div class="calc" data-segtarget></div>
          <div class="row seg-actual">
            <label class="field"><span>Actual time</span><input name="seg_actual" inputmode="decimal" data-dur="min" placeholder="m:ss" value="${esc(fmtDuration(b.actual_s))}"></label>
            <div class="seg-actual-pace" data-segpace></div>
          </div>
        </div>`).join('')}
      <button type="button" class="btn small" data-act="addblock">+ Add block</button>
      <div class="calc" id="segTotal" style="margin-top:10px"></div>
      <div class="seg-use">
        <button type="button" class="btn small" data-act="seg-actual">Use as actual total</button>
      </div>`;
    $$('[data-triad]', sec).forEach(triadInit);
  }

  function segmentTotals() {
    const segs = draft._seg.filter((b) => b.distance_km);
    const km = segs.reduce((s, b) => s + b.distance_km, 0);
    const planned = segs.length && segs.every((b) => b.target_pace_s) ? segs.reduce((s, b) => s + b.distance_km * b.target_pace_s, 0) : null;
    const actual = segs.length && segs.every((b) => b.actual_s) ? segs.reduce((s, b) => s + b.actual_s, 0) : null;
    return { km, planned, actual };
  }

  // Strip what was actually done from a block, keeping only the plan
  const planOnlyBlock = (b) => (b.kind === 'segment' ? { ...b, actual_s: null } : { ...b, splits: [] });

  function blocksForSave(mode) {
    if (mode === 'intervals') {
      return draft._iv.filter((b) => b.reps && b.distance_m).map((b) => ({ ...b, splits: (b.splits || []).slice(0, b.reps) }));
    }
    if (mode === 'segments') {
      return draft._seg.filter((b) => b.distance_km || b.target_pace_s || b.actual_s)
        .map((b) => ({ kind: 'segment', label: b.label || '', distance_km: b.distance_km, target_pace_s: b.target_pace_s, actual_s: b.actual_s ?? null }));
    }
    return [];
  }

  function updateEditor() {
    readForm();
    const st = draft.status;
    const mphLine = (km, sec) => { const v = kmh(km, sec); return v ? `${fmtPace(paceOf(km, sec))} · ${fmtSpeed(v)} km/h · <b>${fmtSpeed(v / KM_PER_MILE)} mph</b>` : ''; };
    $('#plannedFields', dlg).hidden = plansFromBlocks(draft.type);
    $('#plannedCalc', dlg).innerHTML = mphLine(draft.planned_distance_km, draft.planned_duration_s);

    // Actual section only for done / swapped
    $('#actualSec', dlg).hidden = !(st === 'done' || st === 'swapped');
    $('#actualTypeWrap', dlg).hidden = st !== 'swapped';
    $('#actualHint', dlg).textContent = st === 'done'
      ? 'Leave blank to use the planned distance/time.'
      : 'Record what you did instead of the plan.';
    const a = actualOf(draft);
    $('#actualCalc', dlg).innerHTML = a ? mphLine(a.km, a.sec) : '';
    const f = $('form', dlg);
    f.actual_distance_km.placeholder = st === 'done' && draft.planned_distance_km !== null ? fmtKm2(draft.planned_distance_km) : 'km';
    f.actual_duration.placeholder = st === 'done' && draft.planned_duration_s ? fmtDuration(draft.planned_duration_s) : 'mm:ss or h:mm:ss';

    const mode = $('#blockSec', dlg).dataset.mode;
    if (mode === 'intervals') { updateIntervalCalcs(); updateIntervalTotal(); }
    if (mode === 'segments') updateSegmentCalcs();
    renderCompare();
  }

  function updateIntervalCalcs() {
    $$('.block', dlg).forEach((el) => {
      const b = draft._iv[+el.dataset.i];
      const work = (b.reps || 0) * (b.distance_m || 0);
      const done = (b.splits || []).filter((s) => s);
      const avg = done.length ? done.reduce((x, y) => x + y, 0) / done.length : null;
      const workKm = work / 1000, t = b.target_pace_s;
      const avgP = avg && b.distance_m ? avg / (b.distance_m / 1000) : null;
      $('[data-blocksum]', el).innerHTML = work
        ? `${b.reps} × ${b.distance_m} m = <b>${fmtKm2(workKm)} km</b>${b.recovery_s ? ` · ${fmtDuration(b.recovery_s)} ${b.recovery_kind}` : ''}` +
          (t ? `<br>Target <b>${fmtPace(t)}</b> · ${paceSpeeds(t)} · ${fmtDuration(t * b.distance_m / 1000)}/rep, ${fmtDuration(t * workKm)} total` : '') +
          (avgP ? `<br>Avg rep <b>${fmtDuration(avg)}</b> → <b>${fmtPace(avgP)}</b> · ${paceSpeeds(avgP)}` : '')
        : '';
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
  }

  function intervalTotals() {
    const blocks = draft._iv.filter((b) => b.reps && b.distance_m);
    const km = intervalsKm(blocks);
    const planned = blocks.length && blocks.every((b) => b.target_pace_s) ? blocks.reduce((s, b) => s + b.target_pace_s * b.reps * b.distance_m / 1000, 0) : null;
    return { km, planned };
  }
  function updateIntervalTotal() {
    const { km, planned: timed } = intervalTotals();
    $('#ivTotal', dlg).innerHTML = km
      ? `Total reps <b>${fmtKm2(km)} km</b>${timed ? `<br>Target <b>${fmtDuration(timed)}</b> · ${fmtPace(timed / km)} · ${paceSpeeds(timed / km)}` : ''}`
      : '';
  }

  function updateSegmentCalcs() {
    $$('.block', dlg).forEach((el) => {
      const b = draft._seg[+el.dataset.i];
      const out = $('[data-segpace]', el);
      $('[data-segtarget]', el).innerHTML = b.target_pace_s ? `Target <b>${fmtPace(b.target_pace_s)}</b> · ${paceSpeeds(b.target_pace_s)}` : '';
      $('[name=seg_actual]', el).placeholder = b.distance_km && b.target_pace_s ? fmtDuration(b.distance_km * b.target_pace_s) : 'm:ss';
      if (!b.actual_s || !b.distance_km) { out.innerHTML = ''; return; }
      const p = b.actual_s / b.distance_km;
      const cls = b.target_pace_s ? (p <= b.target_pace_s + 1 ? 'fast' : 'slow') : '';
      out.innerHTML = `<b class="${cls}">${fmtPace(p)}</b><br>${paceSpeeds(p)}`;
    });
    const t = segmentTotals();
    $('#segTotal', dlg).innerHTML = t.km
      ? `Total <b>${fmtKm2(t.km)} km</b>${t.planned ? `<br>Planned <b>${fmtDuration(t.planned)}</b> · ${fmtPace(t.planned / t.km)} · ${paceSpeeds(t.planned / t.km)}` : ''}${t.actual ? `<br>Actual <b>${fmtDuration(t.actual)}</b> · ${fmtPace(t.actual / t.km)} · ${paceSpeeds(t.actual / t.km)}` : ''}`
      : '';
    $('[data-act="seg-actual"]', dlg).hidden = !(draft.status === 'done' || draft.status === 'swapped');
  }

  // Put the blocks' actual totals into the actual distance/time fields
  function useSegmentActuals() {
    readForm();
    const t = segmentTotals();
    const sec = t.actual;
    if (!t.km) { toast('Add distances to the blocks first'); return; }
    const g = $('#actualTriad', dlg);
    $('[data-role="dist"]', g).value = fmtKm2(t.km);
    $('[data-role="time"]', g).value = sec ? fmtDuration(sec) : '';
    $('[data-role="pace"]', g).value = '';
    triadInit(g);
    if (!sec) toast('Distance set; add an actual time to every block for the time');
    updateEditor();
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
      ['Distance', pk !== null ? `${fmtKm2(pk)} km` : '–', ak !== null ? `${fmtKm2(ak)} km` : '–', cls(cmp(pk, ak, true))],
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
    triadInput(e.target);
    if (e.target.name === 'reps') { readForm(); renderBlocks(); restoreFocus(e.target); }
    updateEditor();
  });
  dlg.addEventListener('change', (e) => {
    const n = e.target.name;
    // Tidy typed times on leaving the field: 4.30 → 4:30, 45 → 45:00
    if (e.target.dataset.dur) {
      const v = parseDuration(e.target.value, e.target.dataset.dur);
      if (v) e.target.value = fmtDuration(v);
    }
    if (n === 'type' || n === 'actual_type' || n === 'status') {
      readForm();
      if ((blockMode() || '') !== $('#blockSec', dlg).dataset.mode) renderBlocks();
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
    const mode = $('#blockSec', dlg).dataset.mode;
    if (act === 'close') { dlg.close(); return; }
    if (act === 'addblock') {
      readForm();
      if (mode === 'segments') draft._seg.push(newSegment());
      else draft._iv.push({ reps: 4, distance_m: 400, target_pace_s: null, recovery_s: 60, recovery_kind: 'jog', splits: [] });
      renderBlocks(); updateEditor(); return;
    }
    if (act === 'rmblock') {
      readForm();
      const list = mode === 'segments' ? draft._seg : draft._iv;
      list.splice(+btn.dataset.i, 1);
      if (!list.length) list.push(mode === 'segments' ? newSegment() : { reps: 0, distance_m: null, target_pace_s: null, recovery_s: null, recovery_kind: 'jog', splits: [] });
      renderBlocks(); updateEditor(); return;
    }
    if (act === 'seg-actual') { useSegmentActuals(); return; }
    if (act === 'copyrun') {
      readForm();
      // Copies are plain planned runs, so keep the blocks that match the planned type
      const planMode = draft.type === 'Intervals' ? 'intervals' : SEGMENT_TYPES.includes(draft.type) ? 'segments' : null;
      openCopier({ ...draft, intervals: blocksForSave(planMode) });
      return;
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
      out.intervals = blocksForSave(blockMode());
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
      intervals: (r.intervals || []).map(planOnlyBlock),
    }));
    try { await Store.insertMany(rows); render(); toast(`Copied ${rows.length} run(s) for ${runner}`); } catch (err) { toast('Could not copy: ' + err.message); }
  }

  // ---------- Quick copy: long-press (or right-click) a card, then tap + to paste ----------
  let clip = null;
  let picking = false; // header ⧉ button pressed: next tapped card is copied
  function startClip(run) {
    clip = run;
    picking = false;
    navigator.vibrate?.(15);
    render();
  }
  function endClip() { clip = null; picking = false; render(); }
  function renderClipbar() {
    const bar = $('#clipbar');
    document.body.classList.toggle('copying', !!clip);
    document.body.classList.toggle('picking', picking);
    $('#copyModeBtn').classList.toggle('on', !!clip || picking);
    bar.hidden = !clip && !picking;
    if (picking) {
      bar.innerHTML = `<span class="cliptext"><b>Copy a run</b><small>Tap the card you want to copy</small></span>
        <button class="clipdone" data-clipdone>Cancel</button>`;
      return;
    }
    if (!clip) { bar.innerHTML = ''; return; }
    const km = num(clip.planned_distance_km);
    bar.innerHTML = `<span class="card-dot ${typeClass(clip.type)}"></span>
      <span class="cliptext"><b>Copying ${esc(clip.type)}${km !== null ? ` · ${fmtKm(km)} km` : ''}</b>
      <small>Tap any “Paste” to add it · from ${esc(clip.runner)}, ${fmtDay(parseISO(clip.run_date))}</small></span>
      <button class="clipdone" data-clipdays>Pick days…</button>
      <button class="clipdone" data-clipdone>Done</button>`;
  }
  // A fresh planned run with src's plan (type, distance, time, matching blocks, notes)
  function planCopy(src, runner, run_date) {
    const blocks = (src.intervals || [])
      .filter((b) => (src.type === 'Intervals' ? b.kind !== 'segment' : SEGMENT_TYPES.includes(src.type) && b.kind === 'segment'))
      .map(planOnlyBlock);
    return {
      id: uuid(), runner, run_date, type: src.type, status: 'planned',
      planned_distance_km: src.planned_distance_km, planned_duration_s: src.planned_duration_s,
      notes: src.notes, intervals: blocks,
    };
  }
  async function pasteClip(runner, run_date) {
    try { await Store.insertMany([planCopy(clip, runner, run_date)]); render(); toast(`Pasted to ${runner} · ${fmtDay(parseISO(run_date))}`); } catch (err) { toast('Could not paste: ' + err.message); }
  }

  // ---------- Copy picker: any runners × any days in the next 6 weeks ----------
  const COPY_WEEKS = 6;
  const copier = $('#copier');
  let copySrc = null;
  function openCopier(src) {
    copySrc = JSON.parse(JSON.stringify(src));
    const t = today(), tIso = iso(t), srcDate = parseISO(copySrc.run_date);
    const start = mondayOf(srcDate > t ? srcDate : t);
    const km = num(copySrc.planned_distance_km), sec = num(copySrc.planned_duration_s);
    const what = km !== null ? ` · ${fmtKm(km)} km` : sec ? ` · ${fmtDuration(sec)}` : '';
    let rows = '';
    for (let w = 0; w < COPY_WEEKS; w++) {
      const mon = addDays(start, 7 * w);
      rows += `<span class="cal-wk">${mon.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>`;
      for (let i = 0; i < 7; i++) {
        const d = addDays(mon, i), ds = iso(d);
        const cls = (ds === copySrc.run_date ? ' is-src' : '') + (ds === tIso ? ' is-today' : '');
        rows += `<label class="chip cday${cls}"><input type="checkbox" name="cday" value="${ds}" data-wd="${i}" ${ds < tIso ? 'disabled' : ''}>
          <span>${d.getDate()}<i class="dots" data-dots="${ds}"></i></span></label>`;
      }
    }
    copier.innerHTML = `
      <form method="dialog" novalidate>
        <div class="ed-head">
          <h2>Copy ${esc(copySrc.type)}${what}<small>from ${esc(copySrc.runner)} · ${fmtDay(srcDate)}</small></h2>
          <button type="button" class="icon-btn" data-cact="close" aria-label="Close">✕</button>
        </div>
        <div class="ed-body">
          <div class="chips-label">To</div>
          <div class="chips">${RUNNERS.map((r, i) => `<label class="chip r${i}"><input type="checkbox" name="crunner" value="${esc(r)}" ${r === copySrc.runner ? 'checked' : ''}><span>${esc(r)}</span></label>`).join('')}</div>
          <div class="chips-label">Days <small>· tap a weekday to pick it in every week</small></div>
          <div class="cal">
            <span></span>
            ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((n, i) => `<button type="button" class="cal-wd" data-cact="weekday" data-wd="${i}">${n}</button>`).join('')}
            ${rows}
          </div>
          <p class="hint" style="margin-top:10px">Dots = runs already planned that day. Copies are added as “planned”, keeping the type, distance, time, blocks and notes.</p>
        </div>
        <div class="ed-foot">
          <span class="copy-count" id="copyCount"></span>
          <span class="spacer"></span>
          <button type="button" class="btn" data-cact="close">Cancel</button>
          <button type="submit" class="btn primary" data-cact="copy">Copy</button>
        </div>
      </form>`;
    updateCopier();
    copier.showModal();
  }
  function updateCopier() {
    const who = $$('[name=crunner]:checked', copier).map((el) => el.value);
    const days = $$('[name=cday]:checked', copier);
    $$('[data-dots]', copier).forEach((el) => {
      const d = parseISO(el.dataset.dots);
      el.innerHTML = RUNNERS.map((r, i) => (who.includes(r) && runsFor(r, d, d).length ? `<b class="r${i}"></b>` : '')).join('');
    });
    const n = who.length * days.length;
    $('#copyCount', copier).textContent = n ? `${n} run${n === 1 ? '' : 's'}` : 'Pick runners and days';
    $('[data-cact="copy"]', copier).disabled = !n;
  }
  copier.addEventListener('change', updateCopier);
  copier.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-cact]');
    if (!btn) return;
    const act = btn.dataset.cact;
    if (act === 'close') { copier.close(); return; }
    if (act === 'weekday') {
      const boxes = $$(`[name=cday][data-wd="${btn.dataset.wd}"]:not(:disabled)`, copier);
      const on = !boxes.every((el) => el.checked);
      boxes.forEach((el) => { el.checked = on; });
      updateCopier();
      return;
    }
    if (act === 'copy') {
      e.preventDefault();
      const who = $$('[name=crunner]:checked', copier).map((el) => el.value);
      const days = $$('[name=cday]:checked', copier).map((el) => el.value);
      const rows = who.flatMap((r) => days.map((d) => planCopy(copySrc, r, d)));
      if (!rows.length) return;
      btn.disabled = true;
      try {
        await Store.insertMany(rows);
        copier.close();
        if (clip) endClip(); else render();
        toast(`Copied ${rows.length} run${rows.length === 1 ? '' : 's'}`);
      } catch (err) {
        toast('Could not copy: ' + err.message);
        btn.disabled = false;
      }
    }
  });
  copier.addEventListener('close', () => { copySrc = null; });

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

  // Long-press a card to pick it up for quick copy
  const grid = $('#grid');
  // Fingers use touch events (more reliable than pointer events on iOS); the mouse uses pointer events.
  let press = null, suppressClick = false;
  const cancelPress = () => { if (press) { clearTimeout(press.timer); press = null; } };
  function beginPress(card, x, y) {
    cancelPress();
    press = {
      x, y,
      timer: setTimeout(() => {
        press = null;
        const r = runs.get(card.dataset.id);
        if (r) { suppressClick = true; startClip(r); }
      }, 450),
    };
  }
  const movedTooFar = (x, y) => press && Math.hypot(x - press.x, y - press.y) > 14;
  grid.addEventListener('touchstart', (e) => {
    suppressClick = false;
    const card = e.target.closest('.card');
    if (!card || e.touches.length !== 1) { cancelPress(); return; }
    beginPress(card, e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  grid.addEventListener('touchmove', (e) => { const t = e.touches[0]; if (t && movedTooFar(t.clientX, t.clientY)) cancelPress(); }, { passive: true });
  grid.addEventListener('touchend', (e) => {
    cancelPress();
    if (suppressClick && e.cancelable) e.preventDefault(); // no editor after a long-press
  });
  grid.addEventListener('touchcancel', cancelPress);
  grid.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') return;
    suppressClick = false;
    const card = e.target.closest('.card');
    if (card && e.button === 0) beginPress(card, e.clientX, e.clientY);
  });
  grid.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && movedTooFar(e.clientX, e.clientY)) cancelPress(); });
  grid.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse') cancelPress(); });
  grid.addEventListener('contextmenu', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    e.preventDefault();
    cancelPress();
    const r = runs.get(card.dataset.id);
    if (r && clip?.id !== r.id) startClip(r);
  });

  grid.addEventListener('click', (e) => {
    if (suppressClick) { suppressClick = false; return; }
    const card = e.target.closest('.card');
    if (card) {
      const r = runs.get(card.dataset.id);
      if (r && picking) startClip(r);
      else if (r) openEditor(r);
      return;
    }
    const add = e.target.closest('[data-add]');
    if (!add) return;
    if (picking) { toast('Tap a card to copy it'); return; }
    if (clip) pasteClip(add.dataset.add, add.dataset.date);
    else openEditor({ id: uuid(), runner: add.dataset.add, run_date: add.dataset.date, type: 'Easy', status: 'planned', intervals: [] });
  });
  $('#copyModeBtn').onclick = () => {
    if (clip || picking) { endClip(); return; }
    picking = true;
    render();
  };
  $('#clipbar').addEventListener('click', (e) => {
    if (e.target.closest('[data-clipdone]')) endClip();
    else if (e.target.closest('[data-clipdays]') && clip) openCopier(clip);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && (clip || picking) && !dlg.open && !copier.open) endClip(); });
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
