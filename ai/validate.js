#!/usr/bin/env node
// Checks every AI response file before it becomes data: right participant, right clip order,
// sane points, and no two participants sharing identical gestures (which would mean one
// instance's output leaked into another's).
const fs = require('fs'), path = require('path');
const IN = path.join(__dirname, 'responses');
const orders = JSON.parse(fs.readFileSync(path.join(__dirname, 'clip-orders.json'), 'utf8'));
const seen = new Map();
const dupes = [];   // identical strokes: usually convergence on an obvious shape, but check
let bad = 0;

for (const f of fs.readdirSync(IN).filter(f => f.endsWith('.json')).sort()) {
  const id = f.replace('.json', '');
  const say = m => { console.log(`  ✗ ${id}: ${m}`); bad++; };
  let d;
  try { d = JSON.parse(fs.readFileSync(path.join(IN, f), 'utf8')); } catch (e) { say(`invalid JSON (${e.message})`); continue; }

  if (d.participant !== id) say(`file says participant "${d.participant}"`);
  if (d.condition !== (id.includes('-frames-') ? 'frames' : 'text')) say(`condition "${d.condition}" doesn't match its name`);
  const want = orders[id], got = (d.entries ?? []).map(e => e.clip_id);
  if (!want) say('no assigned clip order');
  else if (want.join() !== got.join()) say(`clip order differs from assignment (${got.length} entries)`);

  for (const e of d.entries ?? []) {
    for (const [si, st] of (e.strokes ?? []).entries()) {
      const p = st.points ?? [];
      if (p.length < 2) say(`${e.clip_id} stroke ${si}: ${p.length} point(s)`);
      if (p.some(q => ![q.x, q.y, q.t].every(Number.isFinite))) say(`${e.clip_id} stroke ${si}: non-numeric point`);
      if (p.some((q, i) => i && q.t <= p[i - 1].t)) say(`${e.clip_id} stroke ${si}: timestamps not increasing`);
      if (p.some(q => q.x < -1 || q.x > 801 || q.y < -1 || q.y > 501)) say(`${e.clip_id} stroke ${si}: point outside the surface`);
      // fingerprint: same clip drawn identically by two participants means the files got crossed
      const key = `${e.clip_id}|${p.map(q => `${Math.round(q.x)},${Math.round(q.y)},${Math.round(q.t)}`).join(';')}`;
      if (seen.has(key) && seen.get(key) !== id) dupes.push(`${id} ${e.clip_id} stroke ${si} == ${seen.get(key)}`);
      seen.set(key, id);
    }
  }
  const n = (d.entries ?? []).length;
  const pts = (d.entries ?? []).reduce((a, e) => a + (e.strokes ?? []).reduce((b, s) => b + (s.points ?? []).length, 0), 0);
  console.log(`${bad ? '' : '✓ '}${id}: ${n} entries, ${pts} points`);
}
if (dupes.length) {
  const byFile = {};
  for (const d of dupes) { const f = d.split(' ')[0]; (byFile[f] ??= []).push(d); }
  console.log(`\n${dupes.length} identical stroke(s) across participants — look at these:`);
  for (const d of dupes) console.log(`  · ${d}`);
  // a whole file matching another means outputs got crossed, not two instances agreeing
  for (const [f, list] of Object.entries(byFile)) if (list.length > 3) { console.log(`  ✗ ${f}: ${list.length} identical strokes — likely a crossed file`); bad++; }
}
console.log(bad ? `\n${bad} problem(s) — fix or re-run those participants before building sessions.` : '\nAll files check out.');
process.exit(bad ? 1 : 0);
