(() => {
const $ = s => document.querySelector(s);
const CLIP_BY_ID = Object.fromEntries(CLIPS.map(c => [c.id, c]));
const SPEED_WINDOW_MS = 12;   // ± window for smoothed speed

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

function renderList() {
  const list = $('#list');
  list.innerHTML = '';
  const sorted = [...sessions.values()].sort((a, b) => a.session.started_at.localeCompare(b.session.started_at));
  for (const { session, trials } of sorted) {
    const el = document.createElement('div');
    el.className = 'sess';
    el.innerHTML = `<h2>${esc(session.subject)} · ${new Date(session.started_at).toLocaleDateString()}</h2>`;
    for (const tr of trials) {
      const b = document.createElement('button');
      b.className = 'trial-btn';
      const n = tr.strokes.filter(s => !s.cleared).length;
      b.innerHTML = `<span>${tr.order_index + 1}. ${esc(CLIP_BY_ID[tr.clip_id]?.label ?? tr.clip_id)}</span><small>${n}</small>`;
      b.onclick = () => { document.querySelectorAll('.trial-btn.on').forEach(x => x.classList.remove('on')); b.classList.add('on'); open(session, tr); };
      el.append(b);
    }
    list.append(el);
  }
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

// ---------- open a trial ----------

function open(session, trial) {
  pause();
  const clip = CLIP_BY_ID[trial.clip_id];
  $('#empty').hidden = true;
  $('#viewer').style.display = 'contents';
  $('#title').textContent = clip?.label ?? `Unknown clip "${trial.clip_id}"`;
  const pens = [...new Set(trial.strokes.map(s => s.pointer_type))].join(', ') || 'no strokes';
  $('#meta').textContent = `${session.subject} · trial ${trial.order_index + 1} · ${BLOCKS[trial.block] ?? trial.block} · ${pens} · ${trial.replays_ms.length} replay${trial.replays_ms.length === 1 ? '' : 's'}`;

  if (clip) player.load(clip); else $('#stage').innerHTML = '';
  const strokes = trial.strokes.map(withSpeed);
  const speeds = strokes.filter(s => !s.cleared).flatMap(s => s.speed).sort((a, b) => a - b);
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
  if (e.code === 'Space' && cur && e.target.tagName !== 'SELECT') { e.preventDefault(); playing ? pause() : play(); }
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
  const r = draw.getBoundingClientRect();
  const { w, h } = cur.box;
  const s = Math.min((r.width - 32) / w, (r.height - 40) / h);
  const ox = (r.width - w * s) / 2, oy = (r.height - h * s) / 2 + 8;
  dctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  dctx.clearRect(0, 0, r.width, r.height);
  dctx.strokeStyle = '#ecebe6';
  dctx.lineWidth = 1;
  dctx.strokeRect(ox, oy, w * s, h * s);   // the participant's canvas

  dctx.lineCap = dctx.lineJoin = 'round';
  const bySpeed = $('#by-speed').checked;
  const visible = cur.strokes.filter(st => $('#show-cleared').checked || !st.cleared);
  const X = x => ox + x * s, Y = y => oy + y * s;
  const width = p => (p.pointerType === 'pen' ? 1.5 + p.pressure * 5 : 3.5) * Math.max(.6, s);

  if ($('#ghost').checked) {
    dctx.strokeStyle = '#e9e8e3';
    for (const st of visible) path(st.points, st.points.length, X, Y, () => 3 * Math.max(.6, s));
  }
  for (const st of visible) {
    const local = t - st.start_ms;
    if (local < 0) continue;
    let n = 0;
    while (n < st.points.length && st.points[n].t <= local) n++;
    for (let i = 1; i < n; i++) {
      const a = st.points[i - 1], b = st.points[i];
      dctx.strokeStyle = st.cleared ? '#c7c7cc' : bySpeed ? speedColor(st.speed[i], cur.vmax) : '#1d1d1f';
      dctx.lineWidth = width(b);
      dctx.beginPath(); dctx.moveTo(X(a.x), Y(a.y)); dctx.lineTo(X(b.x), Y(b.y)); dctx.stroke();
    }
    if (n > 0 && n < st.points.length) {   // pen tip while mid-stroke
      const p = st.points[n - 1];
      dctx.fillStyle = '#1d1d1f';
      dctx.beginPath(); dctx.arc(X(p.x), Y(p.y), 5, 0, Math.PI * 2); dctx.fill();
    }
  }
}

function path(points, n, X, Y, w) {
  for (let i = 1; i < n; i++) {
    dctx.lineWidth = w(points[i]);
    dctx.beginPath(); dctx.moveTo(X(points[i - 1].x), Y(points[i - 1].y)); dctx.lineTo(X(points[i].x), Y(points[i].y)); dctx.stroke();
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
    if (st.cleared && !$('#show-cleared').checked) continue;
    cctx.strokeStyle = st.cleared ? '#c7c7cc' : '#1d1d1f';
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
    `<tr><th>Stroke</th><th>Input</th><th>Starts at (s)</th><th>Clip phase (ms)</th><th>Duration (ms)</th><th>Points</th><th>Sample rate (Hz)</th><th>Length (px)</th><th>Mean speed (px/s)</th><th>Peak speed (px/s)</th><th>Peak at</th></tr>` +
    cur.strokes.map(s => `<tr class="${s.cleared ? 'cleared' : ''}"><td>${s.stroke_index + 1}${s.cleared ? ' (cleared)' : ''}</td><td>${s.pointer_type}</td>` +
      `<td>${f(s.start_ms / 1000, 2)}</td><td>${f(s.clip_phase_ms)} / ${cur.trial.clip_period_ms}</td><td>${f(s.duration_ms)}</td><td>${s.points.length}</td>` +
      `<td>${f(s.sample_rate_hz)}</td><td>${f(s.stats.length_px)}</td><td>${f(s.stats.mean_speed)}</td><td>${f(s.stats.peak_speed)}</td><td>${f(s.stats.peak_at * 100)}%</td></tr>`).join('');
}
})();
