#!/usr/bin/env node
// Turns each AI participant's response file (ai/responses/*.json) into a session export
// in the same shape the iPad app produces, so the review page can show AI and human
// entries side by side.
//
//   node ai/build-sessions.js
//
// Writes data/ai/gesture-<participant>.json, and prints a line per participant.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const IN = path.join(__dirname, 'responses');
const OUT = path.join(ROOT, 'data', 'ai');

// Loop length of each clip in the capture app (lead 400 + motion + hold 900), read off ClipPlayer.
const PERIOD = {
  'p-translate': 2500, 'p-scale': 2200, 'p-rotate': 2700, 'p-fade': 2500, 'p-bounce': 3000,
  'p-overshoot': 2700, 'p-compound': 2900, 'p-arc': 2700, 'p-shake': 2100, 'u-toggle': 1680,
  'u-modal': 1840, 'u-sheet': 1920, 'u-card-expand': 2020, 'u-list-stagger': 2140, 'u-toast': 3900,
  'u-like': 2170, 'u-tabs': 1920, 'u-error-shake': 2080, 'u-submit-morph': 3300,
};
const BLOCK = id => id.startsWith('p-') ? 'primitive' : 'ui';
const CANVAS = { w: 800, h: 500 };   // the surface described in the brief
const WATCH_MS = 1200;               // notional time spent watching before the first stroke

const r2 = n => Math.round(n * 100) / 100;
const problems = [];

function buildTrial(res, entry, i, sessionId) {
  const clipId = entry.clip_id;
  if (!PERIOD[clipId]) problems.push(`${res.participant}: unknown clip "${clipId}"`);
  const strokes = [];
  // Strokes in the same group happened at the same time (two fingers); other groups follow on.
  let lastGroup = null, groupStart = WATCH_MS, groupEnd = WATCH_MS;

  (entry.strokes ?? []).forEach((st, si) => {
    const pts = (st.points ?? [])
      .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.t))
      .sort((a, b) => a.t - b.t);
    if (pts.length < 2) { problems.push(`${res.participant}/${clipId}: stroke ${si} has < 2 usable points`); return; }
    const t0 = pts[0].t;
    const group = st.group ?? si;
    if (group !== lastGroup) { groupStart = groupEnd; lastGroup = group; }

    const points = pts.map(p => ({
      x: r2(Math.min(CANVAS.w, Math.max(0, p.x))),
      y: r2(Math.min(CANVAS.h, Math.max(0, p.y))),
      t: r2(p.t - t0),
      pressure: 0.5,
      pointerType: 'ai',
    }));
    const dur = points[points.length - 1].t;
    strokes.push({
      stroke_index: strokes.length,
      pointer_id: si,
      contact_group: group,
      start_ms: r2(groupStart),
      clip_loop_index: Math.floor(groupStart / (PERIOD[clipId] ?? 2000)),
      clip_phase_ms: r2(groupStart % (PERIOD[clipId] ?? 2000)),
      canvas: { ...CANVAS },
      pointer_type: 'ai',
      cleared: false,
      points,
      duration_ms: dur,
      end_ms: r2(groupStart + dur),
      sample_rate_hz: dur > 0 ? r2((points.length - 1) / (dur / 1000)) : null,
    });
    groupEnd = Math.max(groupEnd, r2(groupStart + dur + 250));
  });

  const period = PERIOD[clipId] ?? 2000;
  const lastEnd = Math.max(WATCH_MS, ...strokes.map(s => s.end_ms));
  return {
    trial_id: `${sessionId}-${String(i).padStart(2, '0')}`,
    session_id: sessionId,
    subject: res.participant,
    clip_id: clipId,
    block: BLOCK(clipId),
    order_index: i,
    trial_start: null,
    trial_end: null,
    clip_period_ms: period,
    loop_starts_ms: Array.from({ length: Math.ceil((lastEnd + 500) / period) }, (_, k) => k * period),
    replays_ms: [],
    note: entry.note ?? null,
    strokes,
    duration_ms: r2(lastEnd + 500),
  };
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const files = fs.readdirSync(IN).filter(f => f.endsWith('.json'));
  if (!files.length) { console.error(`No response files in ${IN}`); process.exit(1); }

  for (const f of files) {
    let res;
    try { res = JSON.parse(fs.readFileSync(path.join(IN, f), 'utf8')); }
    catch (e) { problems.push(`${f}: invalid JSON (${e.message})`); continue; }

    const sessionId = `ai-${res.participant}`;
    const trials = (res.entries ?? []).map((e, i) => buildTrial(res, e, i, sessionId));
    const session = {
      session_id: sessionId,
      subject: res.participant,
      source: 'ai',
      condition: res.condition ?? null,
      started_at: res.started_at ?? new Date().toISOString(),
      ended_at: new Date().toISOString(),
      user_agent: res.agent ?? 'Claude Code subagent',
      screen: null,
      settings: { blocks: [...new Set(trials.map(t => t.block))], randomize: true },
      clip_order: trials.map(t => t.clip_id),
      clip_periods_ms: Object.fromEntries(trials.map(t => [t.clip_id, t.clip_period_ms])),
    };
    const out = { format: 'gesture-elicitation/v1', exported_at: new Date().toISOString(), session, trials };
    fs.writeFileSync(path.join(OUT, `gesture-${res.participant}.json`), JSON.stringify(out));
    const pts = trials.reduce((n, t) => n + t.strokes.reduce((m, s) => m + s.points.length, 0), 0);
    console.log(`${res.participant}: ${trials.length} trials, ${pts} points`);
  }

  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    for (const p of problems) console.log(`  - ${p}`);
  }
  console.log(`\nWrote to ${path.relative(ROOT, OUT)}/`);
}

main();
