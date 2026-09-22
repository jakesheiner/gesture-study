(() => {
const $ = s => document.querySelector(s);
const CLIP_BY_ID = Object.fromEntries(CLIPS.map(c => [c.id, c]));
const SPEED_WINDOW_MS = 12;   // ± window for smoothed speed

const off = s => s.cleared || s.palm;   // not shown to the participant
const isAI = ses => ses.source === 'ai';
const who = ses => isAI(ses) ? `ai-${ses.condition ?? 'ai'}` : 'human';
const WHO_LABEL = { human: 'People', 'ai-frames': 'AI (frames)', 'ai-text': 'AI (text)', 'ai-ai': 'AI' };
const sessions = new Map();   // session_id → { session, trials }
let cur = null;               // { trial, strokes (with derived speed), duration, box, vmax }
let t = 0, playing = false, lastFrame = 0;

const player = new ClipPlayer($('#stage'));
fitStage($('#stage-wrap'), $('#stage'));

// ---------- loading ----------

async function loadFiles(files) {
  for (const f of files) {
    try {
      const data = JSON.parse(await f.text());
      for (const b of data.sessions ?? [data]) sessions.set(b.session.session_id, b);
    } catch (e) { alert(`Couldn't read ${f.name}: ${e.message}`); }
  }
  renderList();
}
$('#files').onchange = e => loadFiles(e.target.files);
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); loadFiles(e.dataTransfer.files); });

let mode = 'participant';   // sidebar lists sessions → trials, or clips
for (const b of document.querySelectorAll('.seg button')) {
  b.onclick = () => { mode = b.dataset.mode; renderList(); };
}

function renderList() {
  for (const b of document.querySelectorAll('.seg button')) b.classList.toggle('on', b.dataset.mode === mode);
  const list = $('#list');
  list.innerHTML = '';
  if (mode === 'sheet') { openSheet(); return renderSheetList(list); }
  if (mode === 'clip') return renderClipList(list);
  const sorted = [...sessions.values()].sort((a, b) =>
    (isAI(a.session) - isAI(b.session)) || a.session.started_at.localeCompare(b.session.started_at));
  for (const { session, trials } of sorted) {
    const el = document.createElement('div');
    el.className = 'sess';
    const tag = isAI(session) ? `<i class="ai-tag">AI · ${esc(session.condition ?? '')}</i>` : new Date(session.started_at).toLocaleDateString();
    el.innerHTML = `<h2>${esc(session.subject)} · ${tag}</h2>`;
    for (const tr of trials) {
      const b = document.createElement('button');
      b.className = 'trial-btn';
      b.dataset.trial = tr.trial_id;
      const n = tr.strokes.filter(s => !off(s)).length;
      b.innerHTML = `<span>${tr.order_index + 1}. ${esc(CLIP_BY_ID[tr.clip_id]?.label ?? tr.clip_id)}</span><small>${n}</small>`;
      b.onclick = () => { select(b); open(session, tr); };
      el.append(b);
    }
    list.append(el);
  }
}
const select = b => { document.querySelectorAll('.trial-btn.on').forEach(x => x.classList.remove('on')); b.classList.add('on'); };

function renderClipList(list) {
  const counts = {};
  for (const { trials } of sessions.values()) for (const tr of trials) counts[tr.clip_id] = (counts[tr.clip_id] ?? 0) + 1;
  for (const [block, name] of Object.entries(BLOCKS)) {
    const el = document.createElement('div');
    el.className = 'sess';
    el.innerHTML = `<h2>${name}</h2>`;
    for (const clip of CLIPS.filter(c => c.block === block)) {
      const b = document.createElement('button');
      b.className = 'trial-btn';
      b.dataset.clip = clip.id;
      b.disabled = !counts[clip.id];
      b.innerHTML = `<span>${esc(clip.label)}</span><small>${counts[clip.id] ?? 0}</small>`;
      b.onclick = () => { select(b); openClip(clip); };
      el.append(b);
    }
    list.append(el);
  }
  if (curClip) list.querySelector(`[data-clip="${curClip.clip.id}"]`)?.classList.add('on');
}

const esc = s => String(s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);

// ---------- kinematics ----------

function withSpeed(stroke) {
  const p = stroke.points;
  const v = p.map((pt, i) => {
    let a = i, b = i;
    while (a > 0 && pt.t - p[a - 1].t <= SPEED_WINDOW_MS) a--;
    while (b < p.length - 1 && p[b + 1].t - pt.t <= SPEED_WINDOW_MS) b++;
    if (a === b) { a = Math.max(0, i - 1); b = Math.min(p.length - 1, i + 1); }
    const dt = p[b].t - p[a].t;
    return dt > 0 ? Math.hypot(p[b].x - p[a].x, p[b].y - p[a].y) / dt * 1000 : 0;
  });
  let len = 0;
  for (let i = 1; i < p.length; i++) len += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
  const peak = v.reduce((m, x, i) => x > v[m] ? i : m, 0);
  const dur = p.length ? p[p.length - 1].t : 0;
  return {
    ...stroke, speed: v,
    stats: {
      length_px: len,
      mean_speed: dur ? len / dur * 1000 : 0,
      peak_speed: v[peak] ?? 0,
      peak_at: dur ? p[peak].t / dur : 0,
    },
  };
}

const lerp = (a, b, k) => a + (b - a) * k;
const STOPS = [[47, 85, 212], [155, 77, 202], [247, 103, 7]];
function speedColor(v, vmax) {
  const k = Math.min(1, v / (vmax || 1)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(k)), f = k - i;
  const [r, g, b] = STOPS[i].map((c, j) => Math.round(lerp(c, STOPS[i + 1][j], f)));
  return `rgb(${r},${g},${b})`;
}

function showView(id) {
  $('#empty').hidden = true;
  for (const v of ['#viewer', '#clip-view', '#sheet-view'])
    $(v).style.display = v === id ? (v === '#sheet-view' ? 'flex' : 'contents') : 'none';
  if (id !== '#clip-view') { cPause(); clipPlayer.stop(); }
  if (id !== '#sheet-view') mPause();
}

// ---------- open a trial ----------

function open(session, trial) {
  pause();
  const clip = CLIP_BY_ID[trial.clip_id];
  showView('#viewer');
  $('#title').textContent = clip?.label ?? `Unknown clip "${trial.clip_id}"`;
  const pens = [...new Set(trial.strokes.map(s => s.pointer_type))].join(', ') || 'no strokes';
  $('#meta').textContent = `${session.subject} · trial ${trial.order_index + 1} · ${BLOCKS[trial.block] ?? trial.block} · ${pens} · ${trial.replays_ms.length} replay${trial.replays_ms.length === 1 ? '' : 's'}`;

  if (clip) player.load(clip); else $('#stage').innerHTML = '';
  const strokes = trial.strokes.map(withSpeed);
  const speeds = strokes.filter(s => !off(s)).flatMap(s => s.speed).sort((a, b) => a - b);
  const lastEnd = Math.max(0, ...strokes.map(s => s.end_ms ?? s.start_ms));
  cur = {
    trial, clip, strokes,
    duration: Math.max(trial.duration_ms ?? 0, lastEnd + 500),
    box: strokes[0]?.canvas ?? { w: 800, h: 600 },
    vmax: speeds[Math.floor(speeds.length * .95)] || 1,
  };
  $('#scrub').max = Math.round(cur.duration);
  renderTable();
  seek(firstStroke());
  layoutCanvases();
}

const firstStroke = () => Math.max(0, (cur.strokes[0]?.start_ms ?? 0) - 600);

// ---------- playback ----------

function seek(ms) {
  t = Math.max(0, Math.min(cur.duration, ms));
  $('#scrub').value = Math.round(t);
  $('#time').textContent = `${(t / 1000).toFixed(2)} / ${(cur.duration / 1000).toFixed(2)} s`;
  if (cur.clip) {
    const loops = cur.trial.loop_starts_ms;
    let start = 0;
    for (const s of loops) { if (s <= t) start = s; else break; }
    player.setPhase(Math.min(t - start, player.period));
  }
  drawStrokes();
  drawChart();
}

function play() {
  if (!cur) return;
  if (t >= cur.duration) seek(0);
  playing = true;
  $('#play').textContent = 'Pause';
  lastFrame = performance.now();
  requestAnimationFrame(tick);
}
function pause() {
  playing = false;
  $('#play').textContent = 'Play';
}
function tick(now) {
  if (!playing) return;
  seek(t + (now - lastFrame) * +$('#rate').value);
  lastFrame = now;
  if (t >= cur.duration) return pause();
  requestAnimationFrame(tick);
}

$('#play').onclick = () => playing ? pause() : play();
$('#to-stroke').onclick = () => cur && seek(firstStroke());
$('#scrub').oninput = e => { pause(); seek(+e.target.value); };
for (const id of ['#by-speed', '#ghost', '#show-cleared']) $(id).onchange = () => cur && seek(t);
addEventListener('keydown', e => {
  if (e.code === 'Space' && cur && $('#viewer').style.display !== 'none' && e.target.tagName !== 'SELECT') { e.preventDefault(); playing ? pause() : play(); }
});

// ---------- drawing ----------

const draw = $('#draw'), dctx = draw.getContext('2d');
const chart = $('#chart'), cctx = chart.getContext('2d');

function sizeCanvas(c) {
  const r = c.getBoundingClientRect();
  c.width = Math.round(r.width * devicePixelRatio);
  c.height = Math.round(r.height * devicePixelRatio);
  return r;
}
function layoutCanvases() { if (cur) { sizeCanvas(draw); sizeCanvas(chart); seek(t); } }
new ResizeObserver(layoutCanvases).observe($('#draw-wrap'));

function drawStrokes() {
  renderDrawing(dctx, draw.getBoundingClientRect(), cur.strokes.filter(st => $('#show-cleared').checked || !off(st)), st => t - st.start_ms, {
    box: cur.box, vmax: cur.vmax, bySpeed: $('#by-speed').checked, ghost: $('#ghost').checked, pad: 20,
  });
}

// Draws strokes into a canvas. localTime(stroke) = ms into that stroke to draw up to (Infinity = all of it).
// fit: zoom to the drawing's own bounds instead of showing the participant's whole canvas.
function renderDrawing(ctx, r, strokes, localTime, { box, fit = false, vmax, bySpeed, ghost, pad = 16, tip = true, clear = true, frame = true }) {
  const rx = r.x ?? 0, ry = r.y ?? 0;
  let bx = 0, by = 0, bw = box.w, bh = box.h;
  if (fit) {
    const pts = strokes.flatMap(st => st.points);
    if (pts.length) {
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      bw = Math.max(40, x1 - x0); bh = Math.max(40, y1 - y0);
      bx = (x0 + x1 - bw) / 2; by = (y0 + y1 - bh) / 2;
    }
  }
  const s = Math.min((r.width - 2 * pad) / bw, (r.height - 2 * pad) / bh);
  const ox = rx + (r.width - bw * s) / 2 - bx * s, oy = ry + (r.height - bh * s) / 2 - by * s;
  const X = x => ox + x * s, Y = y => oy + y * s;
  const lw = Math.max(.6, Math.min(1.5, s));
  const width = p => (p.pointerType === 'pen' ? 1.5 + p.pressure * 5 : 3.5) * lw;

  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  if (clear) ctx.clearRect(rx, ry, r.width, r.height);
  if (!fit && frame) {   // the participant's canvas
    ctx.strokeStyle = '#ecebe6';
    ctx.lineWidth = 1;
    ctx.strokeRect(X(0), Y(0), box.w * s, box.h * s);
  }
  ctx.lineCap = ctx.lineJoin = 'round';
  const seg = (a, b) => { ctx.beginPath(); ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(b.x), Y(b.y)); ctx.stroke(); };

  if (ghost) {
    ctx.strokeStyle = '#e9e8e3';
    ctx.lineWidth = 3 * lw;
    for (const st of strokes) for (let i = 1; i < st.points.length; i++) seg(st.points[i - 1], st.points[i]);
  }
  for (const st of strokes) {
    const local = localTime(st);
    if (local < 0) continue;
    let n = 0;
    while (n < st.points.length && st.points[n].t <= local) n++;
    for (let i = 1; i < n; i++) {
      ctx.strokeStyle = off(st) ? '#c7c7cc' : bySpeed ? speedColor(st.speed[i], vmax) : '#1d1d1f';
      ctx.lineWidth = width(st.points[i]);
      seg(st.points[i - 1], st.points[i]);
    }
    if (tip && n > 0 && n < st.points.length) {   // pen tip while mid-stroke
      const p = st.points[n - 1];
      ctx.fillStyle = '#1d1d1f';
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 4, 0, Math.PI * 2); ctx.fill();
    }
  }
}

// Speed over trial time, with clip loop starts marked so stroke timing can be read against the clip.
function drawChart() {
  const r = chart.getBoundingClientRect();
  cctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  cctx.clearRect(0, 0, r.width, r.height);
  const pad = { l: 52, r: 14, t: 14, b: 22 };
  const W = r.width - pad.l - pad.r, H = r.height - pad.t - pad.b;
  const vtop = Math.max(...cur.strokes.flatMap(s => s.speed), 1);
  const X = ms => pad.l + ms / cur.duration * W;
  const Y = v => pad.t + H - Math.min(1, v / vtop) * H;

  cctx.font = '11px -apple-system, sans-serif';
  cctx.fillStyle = '#86868b';
  cctx.textAlign = 'right';
  cctx.fillText(`${Math.round(vtop)} px/s`, pad.l - 6, pad.t + 8);
  cctx.fillText('0', pad.l - 6, pad.t + H);
  cctx.textAlign = 'left';
  cctx.fillText('clip loop starts ▾', pad.l, r.height - 6);

  cctx.strokeStyle = '#ecebe6';
  cctx.lineWidth = 1;
  for (const ls of cur.trial.loop_starts_ms) {
    cctx.beginPath(); cctx.moveTo(X(ls), pad.t); cctx.lineTo(X(ls), pad.t + H); cctx.stroke();
  }
  cctx.beginPath(); cctx.moveTo(pad.l, pad.t + H); cctx.lineTo(pad.l + W, pad.t + H); cctx.stroke();

  for (const st of cur.strokes) {
    if (off(st) && !$('#show-cleared').checked) continue;
    cctx.strokeStyle = off(st) ? '#c7c7cc' : '#1d1d1f';
    cctx.lineWidth = 1.5;
    cctx.beginPath();
    st.points.forEach((p, i) => cctx[i ? 'lineTo' : 'moveTo'](X(st.start_ms + p.t), Y(st.speed[i])));
    cctx.stroke();
  }
  cctx.strokeStyle = '#f76707';
  cctx.lineWidth = 1.5;
  cctx.beginPath(); cctx.moveTo(X(t), pad.t - 6); cctx.lineTo(X(t), pad.t + H); cctx.stroke();
}
chart.addEventListener('pointerdown', e => {
  const r = chart.getBoundingClientRect();
  pause();
  seek((e.clientX - r.left - 52) / (r.width - 66) * cur.duration);
});

function renderTable() {
  const f = (n, d = 0) => n == null ? '–' : n.toFixed(d);
  $('#strokes').innerHTML =
    `<tr><th>Stroke</th><th>Group</th><th>Input</th><th>Starts at (s)</th><th>Clip phase (ms)</th><th>Duration (ms)</th><th>Points</th><th>Sample rate (Hz)</th><th>Length (px)</th><th>Mean speed (px/s)</th><th>Peak speed (px/s)</th><th>Peak at</th></tr>` +
    cur.strokes.map(s => `<tr class="${off(s) ? 'cleared' : ''}"><td>${s.stroke_index + 1}${s.palm ? ' (palm)' : s.cleared ? ' (cleared)' : ''}</td><td>${(s.contact_group ?? s.stroke_index) + 1}</td><td>${s.pointer_type}</td>` +
      `<td>${f(s.start_ms / 1000, 2)}</td><td>${f(s.clip_phase_ms)} / ${cur.trial.clip_period_ms}</td><td>${f(s.duration_ms)}</td><td>${s.points.length}</td>` +
      `<td>${f(s.sample_rate_hz)}</td><td>${f(s.stats.length_px)}</td><td>${f(s.stats.mean_speed)}</td><td>${f(s.stats.peak_speed)}</td><td>${f(s.stats.peak_at * 100)}%</td></tr>`).join('');
  $('#groups').innerHTML = multiTouch().join('<br>');
}

// For groups where two or more fingers were down together: how far apart the first two
// were at the start and end of their overlap (pinch/spread), and how much the line between them turned.
function multiTouch() {
  const groups = Map.groupBy(cur.strokes.filter(s => !off(s)), s => s.contact_group ?? s.stroke_index);
  const out = [];
  for (const [g, st] of groups) {
    if (st.length < 2) continue;
    const [a, b] = st;
    const t0 = Math.max(a.start_ms, b.start_ms), t1 = Math.min(a.end_ms, b.end_ms);
    if (!(t1 > t0)) continue;
    const at = (s, tt) => { let p = s.points[0]; for (const q of s.points) { if (s.start_ms + q.t <= tt) p = q; else break; } return p; };
    const geo = tt => { const p = at(a, tt), q = at(b, tt); return { d: Math.hypot(q.x - p.x, q.y - p.y), ang: Math.atan2(q.y - p.y, q.x - p.x) }; };
    const s0 = geo(t0), s1 = geo(t1);
    let turn = (s1.ang - s0.ang) * 180 / Math.PI;
    turn = ((turn + 540) % 360) - 180;
    out.push(`<b>Group ${g + 1}</b>: ${st.length} fingers together for ${Math.round(t1 - t0)} ms · spread ${Math.round(s0.d)} → ${Math.round(s1.d)} px (×${(s1.d / (s0.d || 1)).toFixed(2)}) · turned ${turn >= 0 ? '+' : ''}${turn.toFixed(0)}°`);
  }
  return out;
}

// ---------- clip view: every participant's entry for one clip ----------

const clipPlayer = new ClipPlayer($('#c-stage'));
fitStage($('#c-stage-wrap'), $('#c-stage'));
let curClip = null;   // { clip, entries: [{ session, trial, strokes, first, span, canvas }], vmax, duration }
let ct = Infinity, cPlaying = false, cLast = 0;

function openClip(clip) {
  pause();
  const entries = [];
  const sorted = [...sessions.values()].sort((a, b) =>
    (isAI(a.session) - isAI(b.session)) || a.session.subject.localeCompare(b.session.subject));
  for (const { session, trials } of sorted) {
    for (const trial of trials.filter(tr => tr.clip_id === clip.id)) {
      const strokes = trial.strokes.filter(st => !off(st)).map(withSpeed);
      const first = Math.min(...strokes.map(st => st.start_ms));
      const span = strokes.length ? Math.max(...strokes.map(st => st.end_ms ?? st.start_ms)) - first : 0;
      entries.push({ session, trial, strokes, first, span, who: who(session), box: strokes[0]?.canvas ?? { w: 800, h: 600 } });
    }
  }
  // One speed scale for the whole clip so colours compare across participants.
  const speeds = entries.flatMap(e => e.strokes.flatMap(st => st.speed)).sort((a, b) => a - b);
  curClip = { clip, all: entries, entries, vmax: speeds[Math.floor(speeds.length * .95)] || 1 };

  const kinds = [...new Set(entries.map(e => e.who))];
  $('#c-who').innerHTML = `<option value="all">Everyone</option>` +
    kinds.map(k => `<option value="${k}">${WHO_LABEL[k] ?? k} only</option>`).join('');
  drawGrid();
}

function drawGrid() {
  const pick = $('#c-who').value;
  const entries = curClip.all.filter(e => pick === 'all' || e.who === pick);
  curClip.entries = entries;
  curClip.duration = Math.max(0, ...entries.map(e => e.span));
  const clip = curClip.clip;

  showView('#clip-view');
  $('#c-title').textContent = clip.label;
  const byKind = Map.groupBy(entries, e => e.who);
  $('#c-meta').textContent = `${BLOCKS[clip.block]} · ` +
    [...byKind].map(([k, v]) => `${v.length} ${WHO_LABEL[k] ?? k}`).join(' · ');
  clipPlayer.load(clip);
  clipPlayer.start();

  const grid = $('#c-grid');
  grid.innerHTML = '';
  for (const e of entries) {
    const card = document.createElement('button');
    card.className = `card ${e.who}`;
    const n = e.strokes.length, fingers = Math.max(0, ...[...Map.groupBy(e.strokes, st => st.contact_group ?? st.stroke_index).values()].map(g => g.length));
    card.innerHTML = `<canvas></canvas><div class="cap"><b>${esc(e.session.subject)}</b>` +
      `<span>${n} stroke${n === 1 ? '' : 's'}${fingers > 1 ? ` · ${fingers} fingers` : ''} · ${(e.span / 1000).toFixed(2)} s</span></div>`;
    card.title = 'Open this entry';
    card.onclick = () => {
      mode = 'participant';
      renderList();
      const b = $(`[data-trial="${e.trial.trial_id}"]`);
      if (b) { select(b); b.scrollIntoView({ block: 'nearest' }); }
      open(e.session, e.trial);
    };
    e.canvas = card.querySelector('canvas');
    grid.append(card);
  }
  ct = Infinity;
  renderCards();
}

function renderCards() {
  if (!curClip) return;
  const opts = { fit: $('#c-fit').checked, bySpeed: $('#c-by-speed').checked, vmax: curClip.vmax, pad: 14 };
  for (const e of curClip.entries) {
    const r = sizeCanvas(e.canvas);
    renderDrawing(e.canvas.getContext('2d'), r, e.strokes, st => ct - (st.start_ms - e.first), { ...opts, box: e.box });
  }
  $('#c-time').textContent = ct === Infinity ? '' : `${(Math.min(ct, curClip.duration) / 1000).toFixed(2)} s`;
}
new ResizeObserver(() => renderCards()).observe($('#c-grid'));
for (const id of ['#c-fit', '#c-by-speed']) $(id).onchange = renderCards;
$('#c-who').onchange = () => { cPause(); ct = Infinity; drawGrid(); };

// Play all: every entry starts at its own first stroke, so the timing lines up side by side.
function cPlay() {
  if (!curClip) return;
  cPlaying = true;
  ct = 0;
  $('#c-play').textContent = 'Stop';
  cLast = performance.now();
  requestAnimationFrame(cTick);
}
function cPause() {
  cPlaying = false;
  $('#c-play').textContent = 'Play all';
}
function cTick(now) {
  if (!cPlaying) return;
  ct += (now - cLast) * +$('#c-rate').value;
  cLast = now;
  if (ct >= curClip.duration + 400) { ct = Infinity; renderCards(); return cPause(); }
  renderCards();
  requestAnimationFrame(cTick);
}
$('#c-play').onclick = () => {
  if (cPlaying) { cPause(); ct = Infinity; renderCards(); } else cPlay();
};

// ---------- contact sheet: every clip against every participant, on one zoomable canvas ----------
// Only the cells in view are drawn, so zooming from the whole study down to a single
// trial stays smooth however many participants are loaded.

const BASE = { w: 190, h: 130 }, GAP = 8, HEAD = { w: 150, h: 30 };
const Z_MIN = 0.12, Z_MAX = 6;

const sheet = $('#sheet'), sctx = sheet.getContext('2d');
const topHead = $('#sheet-top'), tctx = topHead.getContext('2d');
const leftHead = $('#sheet-left'), lctx = leftHead.getContext('2d');
const viewport = $('#sheet-viewport'), scroller = $('#sheet-scroll'), spacer = $('#sheet-spacer');

let M = null;            // { cols, rows, cells, vmax, duration }
let z = 1;               // zoom: 1 = one cell at its natural 190×130
let mt = Infinity, mPlaying = false, mLast = 0;

const cellW = () => BASE.w * z, cellH = () => BASE.h * z;
const stepX = () => cellW() + GAP * Math.min(1, z), stepY = () => cellH() + GAP * Math.min(1, z);

function renderSheetList(list) {
  const el = document.createElement('div');
  el.className = 'sess';
  el.innerHTML = `<h2>Jump to clip</h2>`;
  for (const clip of CLIPS.filter(c => M?.rows.some(r => r.id === c.id))) {
    const b = document.createElement('button');
    b.className = 'trial-btn';
    b.innerHTML = `<span>${esc(clip.label)}</span>`;
    b.onclick = () => scroller.scrollTo({ top: M.rows.findIndex(r => r.id === clip.id) * stepY(), behavior: 'smooth' });
    el.append(b);
  }
  list.append(el);
}

function openSheet() {
  const pick = $('#m-who').value;
  const cols = [...sessions.values()]
    .sort((a, b) => (isAI(a.session) - isAI(b.session)) || a.session.subject.localeCompare(b.session.subject))
    .filter(s => pick === 'all' || who(s.session) === pick)
    .map(({ session, trials }) => ({ session, label: session.subject, kind: who(session), trials }));

  const rows = CLIPS
    .filter(c => cols.some(col => col.trials.some(t => t.clip_id === c.id)))
    .map(c => ({ id: c.id, label: c.label, block: c.block }));

  const cells = [];
  for (const [ri, row] of rows.entries()) {
    for (const [ci, col] of cols.entries()) {
      const trial = col.trials.find(t => t.clip_id === row.id);
      if (!trial) continue;
      const strokes = trial.strokes.filter(st => !off(st)).map(withSpeed);
      if (!strokes.length) continue;
      const first = Math.min(...strokes.map(st => st.start_ms));
      cells.push({
        ri, ci, session: col.session, trial, strokes, first,
        span: Math.max(...strokes.map(st => st.end_ms ?? st.start_ms)) - first,
        box: strokes[0]?.canvas ?? { w: 800, h: 600 },
      });
    }
  }
  const speeds = cells.flatMap(c => c.strokes.flatMap(st => st.speed)).sort((a, b) => a - b);
  M = { cols, rows, cells, vmax: speeds[Math.floor(speeds.length * .95)] || 1, duration: Math.max(0, ...cells.map(c => c.span)) };

  const kinds = [...new Set([...sessions.values()].map(s => who(s.session)))];
  if ($('#m-who').options.length !== kinds.length + 1) {
    $('#m-who').innerHTML = `<option value="all">Everyone</option>` +
      kinds.map(k => `<option value="${k}">${WHO_LABEL[k] ?? k} only</option>`).join('');
  }
  $('#m-meta').textContent = `${rows.length} clips × ${cols.length} participants · ${cells.length} trials`;

  showView('#sheet-view');
  layoutSheet();
}

function layoutSheet() {
  if (!M) return;
  spacer.style.width = `${M.cols.length * stepX()}px`;
  spacer.style.height = `${M.rows.length * stepY()}px`;
  for (const [c, w, h] of [[sheet, viewport.clientWidth, viewport.clientHeight],
                           [topHead, topHead.clientWidth, HEAD.h],
                           [leftHead, HEAD.w, leftHead.clientHeight]]) {
    c.width = Math.round(w * devicePixelRatio);
    c.height = Math.round(h * devicePixelRatio);
  }
  $('#m-zoom').value = z;
  $('#m-zoom-out').textContent = `${Math.round(z * 100)}%`;
  drawSheet();
}

function drawSheet() {
  if (!M) return;
  const sx = scroller.scrollLeft, sy = scroller.scrollTop;
  const vw = viewport.clientWidth, vh = viewport.clientHeight;
  const cw = cellW(), ch = cellH(), dx = stepX(), dy = stepY();
  const c0 = Math.max(0, Math.floor(sx / dx)), c1 = Math.min(M.cols.length - 1, Math.ceil((sx + vw) / dx));
  const r0 = Math.max(0, Math.floor(sy / dy)), r1 = Math.min(M.rows.length - 1, Math.ceil((sy + vh) / dy));

  sctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  sctx.clearRect(0, 0, vw, vh);
  for (let ri = r0; ri <= r1; ri++) {
    for (let ci = c0; ci <= c1; ci++) {
      sctx.fillStyle = M.cols[ci].kind === 'human' ? '#fff' : '#fbfaff';
      sctx.fillRect(ci * dx - sx, ri * dy - sy, cw, ch);
    }
  }
  const opts = { fit: $('#m-fit-draw').checked, bySpeed: $('#m-by-speed').checked, vmax: M.vmax,
                 pad: Math.max(4, 10 * Math.min(1.5, z)), clear: false, frame: false };
  for (const c of M.cells) {
    if (c.ri < r0 || c.ri > r1 || c.ci < c0 || c.ci > c1) continue;
    renderDrawing(sctx, { x: c.ci * dx - sx, y: c.ri * dy - sy, width: cw, height: ch },
      c.strokes, st => mt - (st.start_ms - c.first), { ...opts, box: c.box });
  }

  tctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  tctx.clearRect(0, 0, topHead.clientWidth, HEAD.h);
  tctx.font = '600 12px -apple-system, sans-serif';
  tctx.textBaseline = 'middle';
  for (let ci = c0; ci <= c1; ci++) {
    tctx.fillStyle = M.cols[ci].kind === 'human' ? '#1d1d1f' : '#5b3fc4';
    tctx.fillText(M.cols[ci].label, ci * dx - sx + 4, HEAD.h / 2, Math.max(40, cw - 8));
  }

  lctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  lctx.clearRect(0, 0, HEAD.w, leftHead.clientHeight);
  lctx.font = '500 12px -apple-system, sans-serif';
  lctx.fillStyle = '#1d1d1f';
  lctx.textBaseline = 'middle';
  for (let ri = r0; ri <= r1; ri++) {
    const y = ri * dy - sy + ch / 2;
    if (ch < 26) { lctx.fillText(M.rows[ri].label, 8, y, HEAD.w - 12); continue; }
    const lines = [];
    let line = '';
    for (const w of M.rows[ri].label.split(' ')) {
      if (line && lctx.measureText(`${line} ${w}`).width > HEAD.w - 16) { lines.push(line); line = w; }
      else line = line ? `${line} ${w}` : w;
    }
    lines.push(line);
    lines.forEach((l, i) => lctx.fillText(l, 8, y + (i - (lines.length - 1) / 2) * 15));
  }
  $('#m-time').textContent = mt === Infinity ? '' : `${(Math.min(mt, M.duration) / 1000).toFixed(2)} s`;
}

// ---------- zoom ----------

// Keeps the point under (ax, ay) — viewport coordinates — fixed while the scale changes.
function setZoom(next, ax = viewport.clientWidth / 2, ay = viewport.clientHeight / 2) {
  if (!M) return;
  const clamped = Math.min(Z_MAX, Math.max(Z_MIN, next));
  if (clamped === z) return;
  const fx = (scroller.scrollLeft + ax) / stepX(), fy = (scroller.scrollTop + ay) / stepY();
  z = clamped;
  layoutSheet();
  scroller.scrollLeft = fx * stepX() - ax;
  scroller.scrollTop = fy * stepY() - ay;
  drawSheet();
}

function fitAll() {
  if (!M) return;
  const zx = viewport.clientWidth / (M.cols.length * (BASE.w + GAP));
  const zy = viewport.clientHeight / (M.rows.length * (BASE.h + GAP));
  z = Math.min(Z_MAX, Math.max(Z_MIN, Math.min(zx, zy)));
  layoutSheet();
  scroller.scrollTo({ top: 0, left: 0 });
}

function zoomToCell(cell) {
  const zx = viewport.clientWidth / (BASE.w + GAP), zy = viewport.clientHeight / (BASE.h + GAP);
  z = Math.min(Z_MAX, Math.min(zx, zy)) * 0.92;
  layoutSheet();
  scroller.scrollTo({
    left: cell.ci * stepX() - (viewport.clientWidth - cellW()) / 2,
    top: cell.ri * stepY() - (viewport.clientHeight - cellH()) / 2,
  });
}

const cellAt = (px, py) => {
  const ci = Math.floor((px + scroller.scrollLeft) / stepX()), ri = Math.floor((py + scroller.scrollTop) / stepY());
  return M?.cells.find(c => c.ci === ci && c.ri === ri) ?? null;
};
const pointerPos = e => {
  const r = viewport.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
};

scroller.addEventListener('scroll', drawSheet, { passive: true });
// Pinch on a trackpad and ctrl/⌘+wheel arrive as wheel events with ctrlKey set.
scroller.addEventListener('wheel', e => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  const [ax, ay] = pointerPos(e);
  setZoom(z * Math.exp(-e.deltaY * 0.0035), ax, ay);
}, { passive: false });
scroller.addEventListener('click', e => {
  const cell = cellAt(...pointerPos(e));
  if (!cell) return;
  mode = 'participant';
  renderList();
  const b = $(`[data-trial="${cell.trial.trial_id}"]`);
  if (b) { select(b); b.scrollIntoView({ block: 'nearest' }); }
  open(cell.session, cell.trial);
});
scroller.addEventListener('dblclick', e => {
  const cell = cellAt(...pointerPos(e));
  if (cell) { e.preventDefault(); zoomToCell(cell); }
});
$('#m-zoom').oninput = e => setZoom(+e.target.value);
$('#m-zoom-in-btn').onclick = () => setZoom(z * 1.4);
$('#m-zoom-out-btn').onclick = () => setZoom(z / 1.4);
$('#m-fit').onclick = fitAll;
addEventListener('keydown', e => {
  if ($('#sheet-view').style.display === 'none' || e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
  if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(z * 1.4); }
  else if (e.key === '-') { e.preventDefault(); setZoom(z / 1.4); }
  else if (e.key === '0') { e.preventDefault(); fitAll(); }
});
for (const id of ['#m-fit-draw', '#m-by-speed']) $(id).onchange = drawSheet;
$('#m-who').onchange = () => { openSheet(); renderList(); };
new ResizeObserver(() => { if ($('#sheet-view').style.display !== 'none') layoutSheet(); }).observe(viewport);

// ---------- play all ----------

function mPause() { mPlaying = false; $('#m-play').textContent = 'Play all'; }
function mTick(now) {
  if (!mPlaying) return;
  mt += now - mLast;
  mLast = now;
  if (mt >= M.duration + 400) { mt = Infinity; drawSheet(); return mPause(); }
  drawSheet();
  requestAnimationFrame(mTick);
}
$('#m-play').onclick = () => {
  if (mPlaying) { mPause(); mt = Infinity; drawSheet(); return; }
  mPlaying = true; mt = 0; mLast = performance.now();
  $('#m-play').textContent = 'Stop';
  requestAnimationFrame(mTick);
};
})();
