# Participant brief

You are taking part in a gesture-elicitation study as one participant. Work alone: do not read other participants' responses in `ai/responses/`, and do not read `review.js`, `app.js` or `clips.js` — the point is to respond to the motion itself, not to its source code.

For each clip you are shown one motion. **Draw a gesture you would use to describe that motion to someone else, such as a collaborator or an AI tool.** There are no right answers. You may use one stroke or several, and you may use two fingers at once where that is what you would do.

Work through the clips in the order you are given, one at a time, and don't revise earlier entries once you move on.

## How you see each clip

- **Frames condition:** read the image `ai/frames/<clip_id>.png`. It's a strip of eight stills, left to right then top to bottom, labelled with the time in milliseconds since the motion started. The motion loops in the real study; participants could watch it as many times as they liked.
- **Text condition:** read the entry for `<clip_id>` in `ai/descriptions.json`.

You'll be told which condition you are in. Use only that source.

## The drawing surface

A blank white rectangle, 800 wide and 500 tall, below the clip. x runs left to right from 0 to 800, y runs top to bottom from 0 to 500. It is empty at the start of every clip, and there is no grid, guide or drawing from a previous clip.

## What to record

For each clip, output the points of your gesture as they would be sampled from a finger or stylus:

- `x`, `y` in surface coordinates, and `t` in milliseconds from the start of that stroke, with `t: 0` on the first point.
- Space points about 10 to 20 ms apart, and let the spacing between points reflect how fast your hand is moving. Speed and acceleration are analysed afterwards, so a fast section should cover more distance per point than a slow one, and a pause should be points close together in space.
- 30 to 120 points per stroke is normal. Don't emit thousands.
- Multiple strokes: give each stroke its own `group` number, counting up. Two strokes made at the same time with two fingers share the same `group`.

Write **one JSON file** at the path you are given, in exactly this shape:

```json
{
  "participant": "AI-frames-01",
  "condition": "frames",
  "entries": [
    {
      "clip_id": "p-bounce",
      "note": "one sentence, in your own words, on what you drew and why",
      "strokes": [
        { "group": 0, "points": [{ "x": 120, "y": 300, "t": 0 }, { "x": 128, "y": 292, "t": 14 }] }
      ]
    }
  ]
}
```

If you use a scratch script or temp file while working, give it a name that includes your participant id — other participants run at the same time and share the scratch directory, and a shared filename will clobber their work.

Rules for the file: one entry per clip, in the order you were given; valid JSON only, no comments or trailing commas; nothing else written to disk. Keep each `note` to one sentence — your reasoning is not the data, the gesture is.
