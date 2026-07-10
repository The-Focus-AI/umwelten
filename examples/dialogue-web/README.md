# Dialogue web explorer

A single static HTML file for exploring agent Dialogues in the browser:
enter your OpenRouter key, add participants (name + model + persona), pose a
question, and watch them talk it out with live streaming.

No build step, no dependencies, no server-side code — the browser talks
directly to OpenRouter's CORS-enabled API:

- `GET /api/v1/models` populates the model picker (no key needed)
- `POST /api/v1/chat/completions` with `stream: true` streams each turn (SSE)

Your API key is kept in `localStorage` and only ever sent to
`openrouter.ai`.

## Run it

A hosted copy lives on the docs site: **https://umwelten.thefocus.ai/dialogue/**
(synced from this directory at docs build time by the root `docs:sync-assets`
script — edit `index.html` here, never the generated copy under
`docs/public/dialogue/`).

To run locally:

```bash
# from this directory — also enables transcript capture (see below):
node serve.mjs
# then open http://localhost:7439
```

(Any static file server works too, and opening `index.html` directly with
`open index.html` works in most browsers, since OpenRouter allows
cross-origin requests.)

## What it demonstrates

The page reimplements the `@umwelten/core/dialogue` conventions in ~150
lines of vanilla JS (see the `runDialogue` function):

- one canonical event log; each participant keeps a private message history
- other participants' turns arrive batched as one `user` message labeled
  `[Name]: text`; a participant's own replies are its `assistant` turns
- round-robin turn-taking; a participant bows out by ending a message with
  `<done/>` (stripped from display); the dialogue stops at max turns or when
  everyone is done
- echoed self-prefixes (`[Advocate]: …`) are stripped, mirroring
  `InteractionParticipant`

It is intentionally standalone — a demonstration of the wire-level
conventions, not an import of the TypeScript engine. For the full engine
(habitat agents, moderator policy, session persistence) use
`umwelten converse` or `examples/dialogue-debate/` — see
`docs/guide/agent-dialogues.md`.

## Recording a demo video

`webreel.config.json` scripts a full demo (six philosophers debating AI
regulation, two rounds) as a [webreel](https://webreel.dev) recording:

```bash
node serve.mjs   # keep running; receives the transcript when the debate ends
dotenvx run -f ../../.env -- npx webreel record philosophers-debate
```

Output lands in `videos/`; the debate transcript is saved to `transcripts/`
(the page POSTs it to the server via the `?post=/transcript` URL hook,
because headless Chrome silently drops real file downloads). The config
comments document two webreel 0.1.4 quirks every step works around — read
them before editing the steps.

### Post-editing without re-recording

`.webreel/` keeps the raw capture and a per-frame timeline, so overlays
(cursor, keystroke HUD, sound) can be changed after the fact with
`npx webreel composite philosophers-debate`.

webreel has no dynamic zoom, but the timeline records the cursor position
for **every frame**, which is enough to drive a full virtual camera in post.
`cinematic.py` re-renders the finished video with one: an establishing shot,
a tight cursor-trailing camera through the setup, a re-frame onto the
transcript column with a slow pull-back while the debate streams in, and an
ease back out to full frame at the end. Anchor times come from the
timeline's click events, so it adapts to each recording.

```bash
FF=$(find ~/.webreel -name ffmpeg -type f | head -1)   # webreel's bundled ffmpeg
pip install pillow                                      # (or use a venv)
python3 cinematic.py videos/philosophers-debate.mp4 \
  .webreel/timelines/philosophers-debate.timeline.json \
  videos/philosophers-debate-cinematic.mp4 "$FF"
```

Camera language (zoom levels, smoothing, the transcript frame center) is a
handful of constants at the top of the script. For a simpler static
two-shot version, ffmpeg's `zoompan` alone works — see git history.

### The full assembly

The published cut is three webreel recordings joined end to end: the debate
(through the camera pass), a slow scroll of the exported markdown
(`transcript.html` renders the newest file from `/transcript/latest`), and
a closing card (`end-card.html`) pointing at the guide:

The transcript scroll is recorded at reading pace but time-compressed to a
~3.5s flythrough in the assembly (the full text is there if you pause), and
the end card is trimmed to ~5s:

```bash
npx webreel record transcript-scroll end-card   # no API key needed
FF=$(find ~/.webreel -name ffmpeg -type f | head -1)
$FF -y -i videos/philosophers-debate-cinematic.mp4 \
  -i videos/transcript-scroll.mp4 -i videos/end-card.mp4 \
  -filter_complex "[1:v]setpts=0.15*PTS,fps=30[t];[2:v]trim=0:5.2,setpts=PTS-STARTPTS[e];[0:v][t][e]concat=n=3:v=1:a=0[v]" \
  -map "[v]" -c:v libx264 -crf 20 -pix_fmt yuv420p videos/full.mp4 \
  && mv videos/full.mp4 videos/philosophers-debate-cinematic.mp4
```

Optional soundtrack — lay a music track under the whole cut (video stream
copied, song trimmed to length with a fade-out):

```bash
$FF -i videos/philosophers-debate-cinematic.mp4 -i song.mp3 \
  -map 0:v -map 1:a -c:v copy \
  -af "afade=t=in:d=1.5,afade=t=out:st=89:d=4" \
  -c:a aac -b:a 192k -shortest videos/with-music.mp4
```
(set the fade-out start `st` to video length minus 4)
