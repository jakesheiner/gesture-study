(() => {
const $ = s => document.querySelector(s);
const FORMAT = 'gesture-elicitation/v1';
const r2 = n => Math.round(n * 100) / 100;
const uid = () => crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

// ---------- storage: IndexedDB, written as the session runs ----------

let dbp;
const db = () => dbp ??= new Promise((res, rej) => {
  const r = indexedDB.open('gesture-elicitation', 1);
  r.onupgradeneeded = () => {
    r.result.createObjectStore('sessions', { keyPath: 'session_id' });
    r.result.createObjectStore('trials', { keyPath: 'trial_id' }).createIndex('session_id', 'session_id');
  };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
async function put(store, value) {
  const tx = (await db()).transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
async function getAll(store) {
  const req = (await db()).transaction(store).objectStore(store).getAll();
  return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}

// ---------- export ----------

async function buildExport(sessionId) {
  const [sessions, trials] = await Promise.all([getAll('sessions'), getAll('trials')]);
  const bundle = s => ({ session: s, trials: trials.filter(t => t.session_id === s.session_id).sort((a, b) => a.order_index - b.order_index) });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  if (sessionId) {
    const s = sessions.find(x => x.session_id === sessionId);
    const name = `gesture-${s.subject.replace(/[^\w-]+/g, '_')}-${stamp}.json`;
    return new File([JSON.stringify({ format: FORMAT, exported_at: new Date().toISOString(), ...bundle(s) })], name, { type: 'application/json' });
  }
  const all = { format: FORMAT, exported_at: new Date().toISOString(), sessions: sessions.map(bundle) };
  return new File([JSON.stringify(all)], `gesture-all-sessions-${stamp}.json`, { type: 'application/json' });
}

// Must be called straight from a tap (iOS needs the user gesture for the share sheet),
// so the File is prepared ahead of time.
async function deliver(file) {
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return true;
}

// ---------- screens ----------

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
}

const shuffle = a => {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

let allFile = null;
async function showEntry() {
  show('entry');
  $('#subject').value = '';
  for (const [block] of Object.entries(BLOCKS)) {
    $(`[data-count="${block}"]`).textContent = `${CLIPS.filter(c => c.block === block).length} clips`;
  }
  const sessions = await getAll('sessions');
  $('#stored').textContent = sessions.length ? `${sessions.length} session${sessions.length > 1 ? 's' : ''} stored on this device ·` : 'No sessions stored yet';
  $('#export-all').hidden = !sessions.length;
  allFile = sessions.length ? await buildExport() : null;
}
$('#export-all').onclick = () => allFile && deliver(allFile);

let S = null;   // current session state

$('#entry-form').onsubmit = async e => {
  e.preventDefault();
  const blocks = [...document.querySelectorAll('[name=block]:checked')].map(i => i.value);
  if (!blocks.length) return;
  const randomize = $('#randomize').checked;
  const blockOrder = randomize ? shuffle([...blocks]) : blocks;
  const queue = blockOrder.flatMap(b => {
    const clips = CLIPS.filter(c => c.block === b);
    return randomize ? shuffle(clips) : clips;
  });
  const session = {
    session_id: uid(),
    subject: $('#subject').value.trim(),
    started_at: new Date().toISOString(),
    ended_at: null,
    user_agent: navigator.userAgent,
    screen: { w: screen.width, h: screen.height, dpr: devicePixelRatio },
    settings: { blocks: blockOrder, randomize },
    clip_order: queue.map(c => c.id),
    clip_periods_ms: {},
  };
  S = { session, queue, index: 0, penSeen: false };
  await put('sessions', session);
  show('intro');
};

$('#begin').onclick = () => { show('trial'); startTrial(); };

// ---------- trial ----------

const canvas = $('#canvas');
const ctx = canvas.getContext('2d');
const player = new ClipPlayer($('#stage'));
fitStage($('#stage-wrap'), $('#stage'));

let T = null;       // current trial record
let t0 = 0;         // performance.now() at trial start
let active = null;  // stroke being drawn

player.onLoop = now => { if (T) T.loop_starts_ms.push(r2(now - t0)); };

function startTrial() {
  const clip = S.queue[S.index];
  player.load(clip);
  S.session.clip_periods_ms[clip.id] = player.period;
  t0 = performance.now();
  T = {
    trial_id: `${S.session.session_id}-${String(S.index).padStart(2, '0')}`,
    session_id: S.session.session_id,
    subject: S.session.subject,
    clip_id: clip.id,
    block: clip.block,
    order_index: S.index,
    trial_start: new Date().toISOString(),
    trial_end: null,
    clip_period_ms: player.period,
    loop_starts_ms: [],   // relative to trial start
    replays_ms: [],
    strokes: [],
  };
  player.start();
  $('#progress-fill').style.width = `${(S.index / S.queue.length) * 100}%`;
  $('#progress-text').textContent = `${S.index + 1} of ${S.queue.length}`;
  resizeCanvas();
  refreshButtons();
}

function refreshButtons() {
  const kept = T.strokes.filter(s => !s.cleared).length;
  $('#next').disabled = !kept;
  $('#clear').disabled = !kept;
  $('#hint').hidden = !!kept || !!active;
}

$('#replay').onclick = () => {
  T.replays_ms.push(r2(performance.now() - t0));
  player.start();
};

$('#clear').onclick = () => {
  for (const s of T.strokes) s.cleared = true;   // kept in the data, just not shown
  redraw();
  refreshButtons();
  put('trials', T);
};

$('#next').onclick = async () => {
  if (active) return;
  T.trial_end = new Date().toISOString();
  T.duration_ms = r2(performance.now() - t0);
  await put('trials', T);
  S.index++;
  if (S.index < S.queue.length) return startTrial();
  player.stop();
  T = null;
  S.session.ended_at = new Date().toISOString();
  await put('sessions', S.session);
  showEnd();
};

// ---------- drawing ----------

function resizeCanvas() {
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.round(r.width * devicePixelRatio);
  canvas.height = Math.round(r.height * devicePixelRatio);
  redraw();
}
new ResizeObserver(resizeCanvas).observe($('#canvas-wrap'));

const widthFor = p => p.pointerType === 'pen' ? 1.5 + p.pressure * 5 : 3.5;

function drawSegment(a, b) {
  ctx.lineWidth = widthFor(b);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function redraw() {
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#1d1d1f';
  ctx.lineCap = ctx.lineJoin = 'round';
  if (!T) return;
  const strokes = T.strokes.filter(s => !s.cleared);
  if (active) strokes.push(active.stroke);
  for (const s of strokes) {
    const p = s.points;
    if (p.length === 1) drawSegment(p[0], { ...p[0], x: p[0].x + .1 });
    for (let i = 1; i < p.length; i++) drawSegment(p[i - 1], p[i]);
  }
}

function addPoint(ev) {
  const s = active.stroke;
  const pt = {
    x: r2(ev.clientX - active.rect.left),
    y: r2(ev.clientY - active.rect.top),
    t: r2(ev.timeStamp - active.tStart),
    pressure: r2(ev.pressure),
    pointerType: ev.pointerType,
  };
  const prev = s.points[s.points.length - 1];
  if (prev && pt.t === prev.t && pt.x === prev.x && pt.y === prev.y) return;
  s.points.push(pt);
  drawSegment(prev || { ...pt, x: pt.x + .1 }, pt);
}

canvas.addEventListener('pointerdown', e => {
  if (!T || active) return;
  if (e.pointerType === 'touch' && S.penSeen) return;   // palm rejection once a Pencil has been used
  if (e.pointerType === 'pen') S.penSeen = true;
  try { canvas.setPointerCapture(e.pointerId); } catch {}
  const rect = canvas.getBoundingClientRect();
  const sinceTrial = e.timeStamp - t0;
  const loopStart = player.loopStart;
  active = {
    id: e.pointerId, rect, tStart: e.timeStamp,
    stroke: {
      stroke_index: T.strokes.length,
      start_ms: r2(sinceTrial),                              // relative to trial start
      clip_loop_index: Math.max(0, T.loop_starts_ms.length - 1),
      clip_phase_ms: r2(((e.timeStamp - loopStart) % player.period + player.period) % player.period), // where the clip was when the stroke began
      canvas: { w: Math.round(rect.width), h: Math.round(rect.height) },
      pointer_type: e.pointerType,
      cleared: false,
      points: [],
    },
  };
  addPoint(e);
  refreshButtons();
});

canvas.addEventListener('pointermove', e => {
  if (!active || e.pointerId !== active.id) return;
  const evs = e.getCoalescedEvents?.();
  for (const ev of evs?.length ? evs : [e]) addPoint(ev);
});

function endStroke(e) {
  if (!active || e.pointerId !== active.id) return;
  addPoint(e);
  const s = active.stroke;
  const last = s.points[s.points.length - 1];
  s.duration_ms = last.t;
  s.end_ms = r2(s.start_ms + last.t);
  s.sample_rate_hz = last.t > 0 ? r2((s.points.length - 1) / (last.t / 1000)) : null;
  if (e.type === 'pointercancel') s.cancelled = true;
  T.strokes.push(s);
  active = null;
  refreshButtons();
  put('trials', T);
}
canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);
// Stop iOS text selection, the loupe and Scribble from grabbing the canvas.
canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });

// ---------- end ----------

let sessionFile = null;
async function showEnd() {
  show('end');
  $('#export').disabled = true;
  $('#export-status').textContent = '';
  sessionFile = await buildExport(S.session.session_id);
  $('#export').disabled = false;
}

$('#export').onclick = async () => {
  if (!sessionFile) return;
  if (await deliver(sessionFile)) {
    S.session.exported_at = new Date().toISOString();
    put('sessions', S.session);
    $('#export-status').textContent = `Exported ${sessionFile.name}`;
  }
};

$('#new-session').onclick = () => { S = null; showEntry(); };

document.addEventListener('gesturestart', e => e.preventDefault());   // no pinch-zoom in Safari

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js');
}

showEntry();
})();
