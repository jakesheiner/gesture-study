// Reference clips + the player that runs them. Shared by the capture app (index.html)
// and the review page (review.html).
//
// Every clip is drawn on an 800×450 stage that is scaled to fit its container.
// tracks: [selector, keyframes | (el, i) => keyframes, timing]
//   timing is a normal WAAPI timing object, plus `stagger` (ms between matched elements).

const EASE = {
  out: 'cubic-bezier(.2,.8,.2,1)',
  inOut: 'cubic-bezier(.65,0,.35,1)',
  in: 'cubic-bezier(.55,0,1,.45)',
  gravUp: 'cubic-bezier(.33,1,.68,1)',
  gravDown: 'cubic-bezier(.32,0,.67,0)',
};

const LEAD_MS = 400;   // still frame before the motion starts each loop
const HOLD_MS = 900;   // still frame after the motion ends each loop

const HUES = ['#f4a261', '#7fb7be', '#b5a1e0', '#e76f51', '#8ab17d', '#e9c46a'];

const bar = (w, cls = '') => `<b class="${cls}" style="width:${w}"></b>`;
const rows = n => Array.from({ length: n }, (_, i) =>
  `<div class="row"><i class="avatar" style="background:${HUES[i % HUES.length]}"></i>` +
  `<span>${bar(55 + (i * 37) % 35 + '%')}${bar('40%', 'sub')}</span></div>`).join('');
const appbar = `<div class="appbar">${bar('90px', 'title')}</div>`;
const phone = inner => `<div class="phone">${inner}</div>`;
const HEART = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const tx = x => ({ transform: `translateX(${x}px)` });
const ty = y => ({ transform: `translateY(${y}px)` });

const CLIPS = [
  // ---------- primitives ----------
  {
    id: 'p-translate', block: 'primitive', label: 'Translate (ease-in-out)',
    html: `<div class="shape sq" style="left:120px;top:185px"></div>`,
    tracks: [['.sq', [tx(0), tx(480)], { duration: 1200, easing: EASE.inOut }]],
  },
  {
    id: 'p-scale', block: 'primitive', label: 'Scale up (ease-out)',
    html: `<div class="shape circle" style="left:360px;top:185px"></div>`,
    tracks: [['.circle', [{ transform: 'scale(1)' }, { transform: 'scale(2.6)' }], { duration: 900, easing: EASE.out }]],
  },
  {
    id: 'p-rotate', block: 'primitive', label: 'Rotate 180°',
    html: `<div class="shape sq" style="left:340px;top:165px;width:120px;height:120px"></div>`,
    tracks: [['.sq', [{ transform: 'rotate(0)' }, { transform: 'rotate(180deg)' }], { duration: 1400, easing: EASE.inOut }]],
  },
  {
    id: 'p-fade', block: 'primitive', label: 'Fade in (linear)',
    html: `<div class="shape sq" style="left:340px;top:165px;width:120px;height:120px"></div>`,
    tracks: [['.sq', [{ opacity: 0 }, { opacity: 1 }], { duration: 1200, easing: 'linear' }]],
  },
  {
    id: 'p-bounce', block: 'primitive', label: 'Drop and bounce',
    html: `<div class="floor"></div><div class="shape circle" style="left:365px;top:40px;width:70px;height:70px"></div>`,
    tracks: [['.circle', [
      { ...ty(0), easing: EASE.gravDown },
      { ...ty(290), offset: .42, easing: EASE.gravUp },
      { ...ty(150), offset: .62, easing: EASE.gravDown },
      { ...ty(290), offset: .80, easing: EASE.gravUp },
      { ...ty(235), offset: .90, easing: EASE.gravDown },
      { ...ty(290), offset: 1 },
    ], { duration: 1700 }]],
  },
  {
    id: 'p-overshoot', block: 'primitive', label: 'Translate with spring overshoot',
    html: `<div class="shape sq" style="left:140px;top:185px"></div>`,
    tracks: [['.sq', [
      { ...tx(0), easing: 'cubic-bezier(.3,.6,.5,1)' },
      { ...tx(450), offset: .38, easing: 'ease-in-out' },
      { ...tx(375), offset: .58, easing: 'ease-in-out' },
      { ...tx(415), offset: .74, easing: 'ease-in-out' },
      { ...tx(394), offset: .88, easing: 'ease-in-out' },
      { ...tx(400), offset: 1 },
    ], { duration: 1400 }]],
  },
  {
    id: 'p-compound', block: 'primitive', label: 'Translate + rotate + scale',
    html: `<div class="shape sq" style="left:150px;top:300px"></div>`,
    tracks: [['.sq', [
      { transform: 'translate(0,0) rotate(0) scale(1)' },
      { transform: 'translate(440px,-200px) rotate(180deg) scale(1.6)' },
    ], { duration: 1600, easing: EASE.inOut }]],
  },
  {
    id: 'p-arc', block: 'primitive', label: 'Projectile arc',
    html: `<div class="floor"></div><div class="ax" style="left:110px;top:330px"><div class="shape circle ay" style="left:0;top:0;width:70px;height:70px"></div></div>`,
    tracks: [
      ['.ax', [tx(0), tx(510)], { duration: 1400, easing: 'linear' }],
      ['.ay', [
        { ...ty(0), easing: EASE.gravUp },
        { ...ty(-250), offset: .5, easing: EASE.gravDown },
        { ...ty(0), offset: 1 },
      ], { duration: 1400 }],
    ],
  },
  {
    id: 'p-shake', block: 'primitive', label: 'Decaying shake',
    html: `<div class="shape circle" style="left:360px;top:185px"></div>`,
    tracks: [['.circle', [0, -46, 40, -30, 22, -13, 6, 0].map(tx), { duration: 800, easing: 'ease-in-out' }]],
  },

  // ---------- UI ----------
  {
    id: 'u-toggle', block: 'ui', label: 'Toggle switch on',
    html: `<div class="switch"><i class="knob"></i></div>`,
    tracks: [
      ['.knob', [tx(0), tx(56)], { duration: 380, easing: 'cubic-bezier(.3,1.35,.5,1)' }],
      ['.switch', [{ background: '#e5e5ea' }, { background: '#34c759' }], { duration: 300, easing: 'ease' }],
    ],
  },
  {
    id: 'u-modal', block: 'ui', label: 'Modal dialog opens',
    html: phone(appbar + rows(7) +
      `<div class="scrim"></div><div class="dialog">${bar('60%', 'title')}${bar('90%')}${bar('75%')}` +
      `<div class="dialog-btns"><i></i><i class="primary"></i></div></div>`),
    tracks: [
      ['.scrim', [{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: 'linear' }],
      ['.dialog', [
        { opacity: 0, transform: 'scale(.8)' },
        { opacity: 1, transform: 'scale(1.04)', offset: .6 },
        { opacity: 1, transform: 'scale(1)' },
      ], { duration: 460, delay: 80, easing: EASE.out }],
    ],
  },
  {
    id: 'u-sheet', block: 'ui', label: 'Bottom sheet slides up',
    html: phone(appbar + rows(7) +
      `<div class="scrim"></div><div class="sheet"><i class="handle"></i>` +
      [0, 1, 2, 3].map(i => `<div class="opt"><i style="background:${HUES[i]}"></i>${bar(40 + i * 12 + '%')}</div>`).join('') + `</div>`),
    tracks: [
      ['.scrim', [{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'linear' }],
      ['.sheet', [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], { duration: 560, delay: 60, easing: 'cubic-bezier(.2,.9,.25,1)' }],
    ],
  },
  {
    id: 'u-card-expand', block: 'ui', label: 'Card expands to full screen',
    html: phone(appbar +
      [[14, 70], [136, 70], [14, 224]].map(([l, t], i) =>
        `<div class="tile" style="left:${l}px;top:${t}px"><div class="img" style="background:${HUES[i]}"></div>${bar('70%')}${bar('45%', 'sub')}</div>`).join('') +
      `<div class="tile hero" style="left:136px;top:224px"><div class="img" style="background:${HUES[4]}"></div>${bar('70%')}${bar('45%', 'sub')}` +
      `<div class="detail">${bar('92%')}${bar('85%')}${bar('88%')}${bar('60%')}</div></div>`),
    tracks: [
      ['.hero', [
        { left: '136px', top: '224px', width: '110px', height: '140px', borderRadius: '14px' },
        { left: '0px', top: '0px', width: '260px', height: '430px', borderRadius: '0px' },
      ], { duration: 650, easing: EASE.out }],
      ['.hero .img', [{ height: '70px' }, { height: '210px' }], { duration: 650, easing: EASE.out }],
      ['.hero .detail', [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: 420, easing: EASE.out }],
    ],
  },
  {
    id: 'u-list-stagger', block: 'ui', label: 'List items stagger in',
    html: phone(appbar + `<div class="list">${rows(7)}</div>`),
    tracks: [['.list .row', [{ opacity: 0, transform: 'translateY(28px)' }, { opacity: 1, transform: 'none' }], { duration: 420, stagger: 70, easing: EASE.out }]],
  },
  {
    id: 'u-toast', block: 'ui', label: 'Notification drops in, then leaves',
    html: phone(appbar + rows(7) +
      `<div class="toast"><i style="background:${HUES[1]}"></i><span>${bar('70%', 'title')}${bar('90%')}</span></div>`),
    tracks: [['.toast', [
      { ...ty(-110), easing: 'cubic-bezier(.3,1.3,.5,1)' },
      { ...ty(0), offset: .18 },
      { ...ty(0), offset: .78, easing: EASE.in },
      { ...ty(-110), offset: 1 },
    ], { duration: 2600 }]],
  },
  {
    id: 'u-like', block: 'ui', label: 'Like button pop with burst',
    html: `<div class="like"><i class="ring"></i>${'<i class="dot"></i>'.repeat(8)}<div class="heart">${HEART}</div></div>`,
    tracks: [
      ['.heart', [
        { transform: 'scale(1)', color: '#c7c7cc' },
        { transform: 'scale(.72)', color: '#c7c7cc', offset: .25 },
        { transform: 'scale(1.3)', color: '#ff375f', offset: .6 },
        { transform: 'scale(1)', color: '#ff375f' },
      ], { duration: 620, easing: 'ease-in-out' }],
      ['.ring', [{ transform: 'scale(.3)', opacity: 1 }, { transform: 'scale(1.5)', opacity: 0 }], { duration: 480, delay: 330, easing: EASE.out, fill: 'forwards' }],
      ['.dot', (el, i) => [
        { transform: `rotate(${i * 45}deg) translateY(-30px) scale(1)`, opacity: 1 },
        { transform: `rotate(${i * 45}deg) translateY(-78px) scale(0)`, opacity: 1 },
      ], { duration: 520, delay: 350, easing: EASE.out, fill: 'forwards' }],
    ],
  },
  {
    id: 'u-tabs', block: 'ui', label: 'Tab indicator slides, content pages over',
    html: `<div class="tabbar"><span class="tab t1">Photos</span><span class="tab">Albums</span><span class="tab t3">People</span><i class="ind"></i></div>` +
      `<div class="panes-view"><div class="panes">` +
      [0, 1, 2].map(p => `<div class="pane${p === 2 ? ' people' : ''}">` +
        Array.from({ length: 8 }, (_, i) => `<i style="background:${HUES[(i + p * 2) % HUES.length]}"></i>`).join('') + `</div>`).join('') +
      `</div></div>`,
    tracks: [
      ['.ind', [
        { left: '20px', width: '100px' },
        { left: '20px', width: '380px', offset: .45 },
        { left: '300px', width: '100px' },
      ], { duration: 620, easing: EASE.inOut }],
      ['.panes', [tx(0), tx(-840)], { duration: 620, easing: EASE.inOut }],
      ['.t1', [{ color: '#1d1d1f' }, { color: '#8e8e93' }], { duration: 300 }],
      ['.t3', [{ color: '#8e8e93' }, { color: '#1d1d1f' }], { duration: 300, delay: 320 }],
    ],
  },
  {
    id: 'u-error-shake', block: 'ui', label: 'Login fails, form shakes',
    html: `<div class="form"><div class="field">${bar('55%')}</div><div class="field pw">••••••••</div>` +
      `<div class="err">Incorrect password</div><div class="btn">Sign in</div></div>`,
    tracks: [
      ['.btn', [{ transform: 'scale(1)' }, { transform: 'scale(.94)', offset: .4 }, { transform: 'scale(1)' }], { duration: 220 }],
      ['.pw', [{ borderColor: '#d1d1d6' }, { borderColor: '#ff3b30' }], { duration: 150, delay: 260 }],
      ['.form', [0, -18, 16, -12, 9, -5, 2, 0].map(tx), { duration: 520, delay: 260, easing: 'ease-in-out' }],
      ['.err', [{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: 420 }],
    ],
  },
  {
    id: 'u-submit-morph', block: 'ui', label: 'Button → spinner → success',
    html: `<div class="morph"><span class="label">Submit</span><i class="spinner"></i><span class="check">${CHECK}</span></div>`,
    tracks: [
      ['.morph', [
        { width: '240px', left: '280px', background: '#0a84ff', easing: EASE.inOut },
        { width: '64px', left: '368px', background: '#0a84ff', offset: .18 },
        { width: '64px', left: '368px', background: '#0a84ff', offset: .82, easing: 'ease' },
        { width: '64px', left: '368px', background: '#30d158', offset: 1 },
      ], { duration: 2000 }],
      ['.label', [{ opacity: 1 }, { opacity: 0 }], { duration: 150 }],
      ['.spinner', [
        { opacity: 0, transform: 'rotate(0deg)' },
        { opacity: 1, offset: .1 },
        { opacity: 1, offset: .9 },
        { opacity: 0, transform: 'rotate(1080deg)' },
      ], { duration: 1300, delay: 330, easing: 'linear' }],
      ['.check', [{ transform: 'scale(0)' }, { transform: 'scale(1)' }], { duration: 360, delay: 1640, easing: 'cubic-bezier(.3,1.5,.5,1)' }],
    ],
  },
];

const BLOCKS = { primitive: 'Simple shapes', ui: 'UI elements' };

// Runs one clip on a stage element, looping: lead → motion → hold → repeat.
// Either free-running (start()) or driven externally (setPhase(), used by review).
class ClipPlayer {
  constructor(stage) {
    this.stage = stage;
    this.anims = [];
    this.raf = 0;
    this.onLoop = null;   // called with performance.now() at each loop start
  }

  load(clip) {
    this.stop();
    this.clip = clip;
    this.stage.innerHTML = clip.html;
    this.anims = [];
    let end = 0;
    for (const [sel, kf, timing] of clip.tracks) {
      const { stagger = 0, ...t } = timing;
      this.stage.querySelectorAll(sel).forEach((el, i) => {
        const frames = typeof kf === 'function' ? kf(el, i) : kf;
        const a = el.animate(frames, { fill: 'both', ...t, delay: LEAD_MS + (t.delay || 0) + i * stagger });
        a.pause();
        end = Math.max(end, a.effect.getComputedTiming().endTime);
        this.anims.push(a);
      });
    }
    this.period = Math.round(end + HOLD_MS);
    this.setPhase(0);
  }

  setPhase(ms) {
    for (const a of this.anims) a.currentTime = ms;
  }

  start() {
    this.stop();
    const loop = now => {
      this.loopStart = now;
      for (const a of this.anims) { a.currentTime = 0; a.play(); }
      this.onLoop?.(now);
    };
    loop(performance.now());
    const tick = now => {
      if (now - this.loopStart >= this.period) loop(now);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    for (const a of this.anims) a.pause();
  }
}

// Scales a fixed 800×450 stage to fit its wrapper.
function fitStage(wrap, stage) {
  const fit = () => {
    const s = Math.min(wrap.clientWidth / 800, wrap.clientHeight / 450);
    stage.style.setProperty('--s', s);
  };
  new ResizeObserver(fit).observe(wrap);
  fit();
}
