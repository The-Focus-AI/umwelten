#!/usr/bin/env python3
"""Cinematic camera pass for the philosophers-debate webreel recording.

Reads the per-frame cursor track from the webreel timeline and re-renders
the finished video with a dynamic virtual camera:

  1. open on the full frame (establishing shot)
  2. ease into a tight shot that trails the cursor through the whole setup
  3. play the first participant's card at normal speed, then fast-forward
     (SPEEDUP x, audio retimed to match) through the remaining five cards
     until just before "Begin dialogue"
  4. when "Begin dialogue" is clicked, re-frame onto the transcript column
     and hold a slow pull-back while the turns stream in
  5. ease back out to the full frame for the ending

Anchor moments come from the timeline's click events: clicks 1-4 are the
API key + first card, click 5 starts the second card (fast-forward from
there), the second-to-last click is "Begin dialogue", the last is
"Save transcript".

Usage (Pillow required — `pip install pillow`):
  python3 cinematic.py [in.mp4] [timeline.json] [out.mp4] [ffmpeg]
"""

import json
import math
import subprocess
import sys

W, H = 1920, 1080
FPS = 30

SETUP_ZOOM = 1.6      # tracking the cursor while the roster is built
DEBATE_ZOOM = 1.30    # opening shot on the transcript column
DEBATE_ZOOM_END = 1.12  # slow pull-back target by the end of the debate
DEBATE_CENTER = (1170, 620)  # transcript column, where text streams in
TAU = 0.6             # camera smoothing time constant (s) — bigger = lazier
SPEEDUP = 5           # fast-forward factor for the roster build
FAST_START_CLICK = 2  # 0-based click index where fast-forward begins
                      # (click 0 = the question, click 1 = API key, click 2 =
                      # first roster field — question + key play normal speed)

ffmpeg = sys.argv[4] if len(sys.argv) > 4 else "ffmpeg"
src = sys.argv[1] if len(sys.argv) > 1 else "videos/philosophers-debate.mp4"
tl_path = sys.argv[2] if len(sys.argv) > 2 else ".webreel/timelines/philosophers-debate.timeline.json"
out = sys.argv[3] if len(sys.argv) > 3 else "videos/philosophers-debate-cinematic.mp4"

from PIL import Image, ImageDraw

tl = json.load(open(tl_path))
cursors = [(f["cursor"]["x"], f["cursor"]["y"]) for f in tl["frames"]]
clicks = [e["timeMs"] / 1000 for e in tl["events"] if e["type"] == "click"]
t_begin, t_save = clicks[-2], clicks[-1]
# fast-forward window: everything after the question + API key — setup AND
# the debate — until a blink before the "Save transcript" click; the clip is
# then hard-cut just after the click so there's no dead tail
t_fast0, t_fast1 = clicks[FAST_START_CLICK], t_save - 1.2
t_out = t_save + 0.4
f_fast0, f_fast1 = int(t_fast0 * FPS), int(t_fast1 * FPS)


def draw_ff_badge(img):
    """fast-forward ▸▸ badge, bottom-right, in the page's accent red"""
    d = ImageDraw.Draw(img, "RGBA")
    x, y, s, gap = W - 150, H - 92, 36, 10
    col = (200, 16, 46, 210)
    d.polygon([(x, y), (x, y + s), (x + s * 0.85, y + s / 2)], fill=col)
    x2 = x + s * 0.85 + gap
    d.polygon([(x2, y), (x2, y + s), (x2 + s * 0.85, y + s / 2)], fill=col)


def ease(a, b, t):
    """cosine ease between a and b, t clamped to 0..1"""
    t = max(0.0, min(1.0, t))
    return a + (b - a) * (1 - math.cos(math.pi * t)) / 2


def zoom_at(t):
    if t < 1.5:
        return 1.0
    if t < 3.0:
        return ease(1.0, SETUP_ZOOM, (t - 1.5) / 1.5)
    if t < t_begin:
        return SETUP_ZOOM
    if t < t_begin + 1.8:
        return ease(SETUP_ZOOM, DEBATE_ZOOM, (t - t_begin) / 1.8)
    if t < t_save - 2.5:
        # slow cinematic pull-back across the debate
        return ease(DEBATE_ZOOM, DEBATE_ZOOM_END, (t - t_begin - 1.8) / max(1, t_save - 2.5 - t_begin - 1.8))
    return ease(DEBATE_ZOOM_END, 1.0, (t - (t_save - 2.5)) / 2.0)


def target_at(t, i):
    if t < 1.5 or t > t_save - 2.5:
        return (W / 2, H / 2)
    if t < t_begin:
        cx, cy = cursors[min(i, len(cursors) - 1)]
        return (cx, cy)
    return DEBATE_CENTER


# probe frame count of the source video (may differ slightly from timeline)
probe = subprocess.run(
    [ffmpeg, "-i", src, "-map", "0:v", "-c", "copy", "-f", "null", "-"],
    capture_output=True, text=True,
)
n_frames = int([l for l in probe.stderr.splitlines() if "frame=" in l][-1].split("frame=")[1].split()[0])

dec = subprocess.Popen(
    [ffmpeg, "-v", "error", "-i", src, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    stdout=subprocess.PIPE,
)
# retime the audio (if the source has any) to match the dropped frames:
# normal / SPEEDUP x / normal
has_audio = "Audio:" in probe.stderr
audio_args = []
if has_audio:
    audio_args = [
        "-filter_complex",
        (f"[1:a]atrim=0:{t_fast0},asetpts=PTS-STARTPTS[a1];"
         f"[1:a]atrim={t_fast0}:{t_fast1},asetpts=PTS-STARTPTS,atempo={SPEEDUP}[a2];"
         f"[1:a]atrim={t_fast1},asetpts=PTS-STARTPTS[a3];"
         f"[a1][a2][a3]concat=n=3:v=0:a=1[aout]"),
        "-map", "[aout]", "-c:a", "aac", "-b:a", "192k",
    ]
enc = subprocess.Popen(
    [ffmpeg, "-v", "error", "-y",
     "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
     "-i", src,
     "-map", "0:v", *audio_args,
     "-c:v", "libx264", "-crf", "20", "-preset", "medium", "-pix_fmt", "yuv420p",
     out],
    stdin=subprocess.PIPE,
)

# critically-damped-ish camera: exponential smoothing toward the target
cam_x, cam_y = W / 2, H / 2
alpha = 1 - math.exp(-1 / (TAU * FPS))
frame_bytes = W * H * 3

for i in range(n_frames):
    buf = dec.stdout.read(frame_bytes)
    if len(buf) < frame_bytes:
        break
    t = i / FPS
    if t > t_out:
        break
    z = zoom_at(t)
    tx, ty = target_at(t, i)
    cam_x += (tx - cam_x) * alpha
    cam_y += (ty - cam_y) * alpha
    # fast-forward: drop all but every SPEEDUP-th frame inside the window
    # (the camera state above still advances every input frame)
    if f_fast0 <= i < f_fast1 and (i - f_fast0) % SPEEDUP:
        continue
    half_w, half_h = W / (2 * z), H / (2 * z)
    cx = min(max(cam_x, half_w), W - half_w)
    cy = min(max(cam_y, half_h), H - half_h)
    img = Image.frombuffer("RGB", (W, H), buf)
    img = img.resize((W, H), Image.BILINEAR, box=(cx - half_w, cy - half_h, cx + half_w, cy + half_h))
    if f_fast0 <= i < f_fast1:
        draw_ff_badge(img)
    enc.stdin.write(img.tobytes())
    if i % 600 == 0:
        print(f"{i}/{n_frames} ({t:.0f}s, zoom {z:.2f})", flush=True)

dec.stdout.close()
enc.stdin.close()
enc.wait()
print(f"done: {out}")
