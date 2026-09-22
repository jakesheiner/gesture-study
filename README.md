# Gesture Study

The in-person gesture-elicitation app, plus a review page for replaying what was captured. It's plain static files with no build step and no dependencies.

- `index.html`: the study app you hand to participants (Safari on iPad).
- `review.html`: runs on your laptop. Load exported JSON to replay each trial in real time next to its clip.
- `clips.js`: the reference clips and the player. Both pages use it.

## Run it

```bash
python3 -m http.server 5186
```

Open http://localhost:5186 for the study app and http://localhost:5186/review.html for review.

**On the iPad:** the page has to be served over HTTPS for offline mode (the service worker) and for the iOS share sheet on export. Any static host works: GitHub Pages, Netlify drop, or `npx vercel`. Open it once while online, then Share → **Add to Home Screen** so it launches full-screen with no Safari address bar. You can also load it over your LAN (`http://<mac-ip>:5186`), but then export falls back to a plain file download and nothing is cached for offline use.

## Session flow

1. **Setup (researcher):** enter the participant code, choose the clip blocks and whether to randomize. Randomizing shuffles the block order and the clips within each block, and the order used is logged.
2. **Instructions (participant):** hand over the iPad and they tap Begin.
3. **Trials:** the clip loops at the top and they draw underneath. They can draw several strokes, Clear, and Replay the clip. Next appears once there's a stroke.
4. **End:** the thank-you screen. The researcher taps **Export data** to save one JSON file for the participant, then **New session**. Everything is also kept in IndexedDB, and **Export all** on the setup screen recovers every session stored on the device.

## Clips

There are 19 clips in two blocks. Each one loops as 400 ms still, then the motion, then 900 ms still.

| Simple shapes | UI elements |
| --- | --- |
| Translate (ease-in-out) | Toggle switch on |
| Scale up (ease-out) | Modal dialog opens |
| Rotate 180° | Bottom sheet slides up |
| Fade in (linear) | Card expands to full screen |
| Drop and bounce | List items stagger in |
| Spring overshoot | Notification drops in, then leaves |
| Translate + rotate + scale | Like button pop with burst |
| Projectile arc | Tab indicator slides, content pages over |
| Decaying shake | Login fails, form shakes |
| | Button → spinner → success |

Participants never see clip names. To add a clip, append an entry to `CLIPS` in `clips.js`. Each clip is an HTML snippet plus a list of Web Animations tracks.

## Captured data

Each export is `{ format, session, trials[] }`, or `{ sessions: [...] }` for Export all.

- **session:** participant, start and end times, user agent, screen size, block order, the full clip order, and each clip's loop length.
- **trial:** clip, position in the order, start and end times, `loop_starts_ms` (when each loop of the clip began, replays included), `replays_ms`, and `strokes[]`.
- **stroke:** `start_ms` and `end_ms` relative to trial start, `clip_phase_ms` (how far into the clip's loop it was when the pen went down), canvas size, `sample_rate_hz`, `cleared`, and `points[]`.
- **point:** `{ x, y, t, pressure, pointerType }`. x and y are canvas pixels, and t is milliseconds from the start of the stroke. Points are recorded at the native event rate, including coalesced events where Safari provides them.

Multi-touch is supported, so pinches, spreads and two-finger rotations are captured as one stroke per finger. Each stroke has a `pointer_id` and a `contact_group`. Fingers that were down at the same time share a group.

Cleared strokes stay in the data with `cleared: true`. Palm rejection works like this: touches that start while the Pencil is down are ignored, and a touch that landed just before the Pencil is kept but flagged `palm: true` and hidden from the participant.

## Review page

Load one or more exports (or drag them in), then pick a trial. The clip on the left is driven by the logged loop starts, so it shows exactly what the participant was watching at each moment of the drawing. The page has these controls:

- playback speed from 0.1× to 2×, a scrubber, and space to play or pause
- colour by speed, which blends from slow (blue) to fast (orange), scaled to the trial's 95th-percentile speed
- a speed-over-time chart, with the clip's loop starts marked so you can line stroke timing up with the motion
- a per-stroke table with contact group, duration, sample rate, path length, mean and peak speed, and when the peak happened
- for multi-finger groups, a summary of how far apart the first two fingers were at the start and end (the pinch or spread ratio) and how much the line between them turned

Switch the sidebar to **By clip** to see every participant's entry for one clip in a grid next to the looping clip. **Play all** replays every entry at once, each starting from its own first stroke, so you can compare timing side by side. Speed colours use one scale across all entries. **Zoom each drawing to fit** compares shape regardless of how big or where on the canvas each person drew. Click an entry to open it in the single-trial view.

The **All** tab is a contact sheet of the whole study on one scrollable canvas: clips down the side, participants across the top, one thumbnail per trial. Clip names and participant names stay pinned while you scroll. **Play all** runs every trial at once, each from its own first stroke, so a whole column or row can be compared at a glance. Cells can be small, medium or large, the **Show** menu filters people against either AI condition, and clicking any cell opens that trial in the single-trial view. Gaps mean that participant has no entry for that clip.

Speed is smoothed over a ±12 ms window. Anything derived from it, acceleration especially, should be recomputed with proper filtering for analysis.

## AI participants

The same clip set can be run by AI "participants", so model-generated gestures can be compared with the human ones in the same review page. Everything for this lives in `ai/`.

Two conditions, run by different instances so that seeing the frames can't colour the text answers:

- **frames** — the instance sees `ai/frames/<clip_id>.png`, a strip of 16 stills of the real clip labelled with the time since the motion started. Regenerate the strips with `filmstrip.html` (see below).
- **text** — the instance reads a plain-language description of the motion from `ai/descriptions.json` and never sees the clip.

Each instance works alone: its own randomized clip order from `ai/clip-orders.json`, no access to other participants' answers, and no access to the clip source code. `ai/participant-brief.md` is the instruction sheet they follow — it mirrors what the human participants are told, plus the output format.

Running a round:

1. Regenerate the filmstrips if the clips changed. Serve the folder, then, with Playwright installed, screenshot `filmstrip.html?clip=<id>&frames=16&cols=4` for every clip into `ai/frames/`.
2. Give each instance the brief, its condition, its clip order and an output path in `ai/responses/`.
3. `node ai/build-sessions.js` turns every response file into a session export in `data/ai/`, in the same shape the iPad app produces.
4. Load those files into the review page alongside the human exports.

In the review page, AI sessions are tagged in the sidebar, and the **By clip** view has a **Show** menu for comparing everyone, only people, or one AI condition.

**What this is and isn't.** The points a model emits are an account of a gesture, not a recording of a hand: the timing is authored rather than measured, so treat AI speed and acceleration as claims about how a motion should feel, not as motor data. The shape of the gesture, how many strokes it uses, whether it traces the path or abstracts it, and whether it reaches for two fingers are the comparable parts. `ai/responses/` and `data/ai/` are gitignored like the human data.
