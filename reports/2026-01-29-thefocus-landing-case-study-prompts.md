# Case-Study Image & Video Prompts: thefocus-landing

**Date:** 2026-01-29  
**Method:** Session analysis walkthrough (`docs/walkthroughs/session-analysis-walkthrough.md`) + umwelten `sessions` CLI against `../thefocus-landing`.

---

## CLI Note

Use the **`sessions`** command. To target a different directory (e.g. thefocus-landing from umwelten), use **`-p`**:

```bash
# From umwelten repo (sibling directory)
dotenvx run -- pnpm run cli sessions list -p ../thefocus-landing
dotenvx run -- pnpm run cli sessions index -p ../thefocus-landing
dotenvx run -- pnpm run cli sessions search "query" -p ../thefocus-landing

# Or with full path
pnpm run cli sessions list -p /path/to/thefocus-landing
pnpm run cli sessions messages <id> -p /path/to/thefocus-landing
pnpm run cli sessions tools <id> -p /path/to/thefocus-landing [--json]
```

---

## What I Found

### 1. Session d2f5c111 — Data flywheel & blog infographics

**First prompt:** "look at projects/product/distill/feed-architecture.md in ../operations and then look at @src/content/posts/import-driven-development.md"

This session produced **blog/card images** (not the case-study hero set) and established the **nano-banana image prompt patterns** used on the site.

**Image generation (nano-banana):**

- **Style anchor (reused):**  
  `"Wide 16:9 impasto oil painting in the style of Van Gogh with thick visible brushstrokes. [SCENE]. Warm earth tones - ochre, deep blue, burnt sienna, cream. Moody atmospheric lighting. No text."`

- **Tufte-style infographic:**  
  `"Minimalist Tufte-style infographic. Cream background (#faf9f6). Petrol blue (#0e3b46) primary, vermilion (#c3471d) accents sparingly. Inter font. No gradients, shadows, or decoration. Clean thin lines only."`  
  Plus: wide 16:9 header, summarize post, show data-in → process → outputs, optional case-study visuals.

- **Focus.AI client style:**  
  `"Wide 16:9 clean professional illustration. Focus.AI Client brand style - petrol blue (#0e3b46), cream paper (#faf9f6), vermilion (#c3471d) accents sparingly. Visual metaphor for [concept]. Clean modern illustration, no text."`

- **Info-poster (per section):**  
  e.g. `"Wide 16:9 information poster infographic. Cream (#faf9f6). Black text and lines only. Title: 'THE OPERATIONS TRACKER'. Show data flow: INPUTS (left) → CENTER → OUTPUTS (right). Simple flowchart. No gradients, no shadows."`  
  Similar prompts were used for **THE FASTING TRACKER**, **THE MEDIA DISTILL**, **THE DATA FLYWHEEL**, **WHY THIS WORKS**.

**Outputs:** `src/content/assets/cards/data-flywheel-pattern.png`, `data-flywheel-operations.png`, `data-flywheel-fasting.png`, `data-flywheel-media.png`, etc.  
**Tool:** `npx @the-focus-ai/nano-banana "…" --output <path>` plus nano-banana-imagegen skill.

---

### 2. Session 13e70652 — Claude Code non-coding post (infographic + video)

**User prompts that drove image + video:**

- "make an infographic of this post, passing it all directly into the nano-banana skill"
- "can you make a short animated video of that info graphic? 720p and looping?"
- "no be more specific about what we want — first specify the size in the video making call, and then describe how we want all of the things to move. first read in what the file has in it and then describe how it all should be animated"

So the **video-animation workflow** used in that session was:

1. Generate a static infographic with nano-banana (image).
2. Call nano-banana **video** with: **explicit size** (e.g. 720p), **looping**, and a **shot list** describing how each element moves (read the image/content first, then describe motion).

**Video tool (from project skills):**  
`npx @the-focus-ai/nano-banana --video "…" --file "path/to/image.png" --output "path/to/video.mp4"`  
With options: `--resolution 720p`, `--duration` (4/6/8s), `--video-fast` for tests.  
Image-to-video = animate the static graphic; prompt = screenplay/shot list (camera + subject + action + aesthetics).

---

### 3. Case-study hero images (distill_wide, image-browser_wide, etc.)

**Assets:**  
`src/content/assets/case-studies/*.png`: e.g. `distill_wide.png`, `image-browser_wide.png`, `ndn_wide.png`, `onboarding_wide.png`, `perplexity_wide.png`, `tezlab_wide.png`, `upperhand_wide.png`.

**In sessions:** No tool calls in the exported session list wrote to `src/content/assets/case-studies/`. They appear in git in a single commit (e.g. "finishing the redesign"), so they may have been created in another client/session or before the current session index.

**Documented pattern (thefocus-landing CLAUDE.md):**

- **Aspect:** Wide 16:9.
- **Style:** Impasto oil painting (Van Gogh-like) **or** vintage illustration/risograph.
- **Subject:** Visual metaphor for the case study — not literal.
- **Colors:** Warm earth tones (ochre, deep blue, burnt sienna, cream).
- **Mood:** Contemplative, atmospheric, moody lighting.
- **No text** in the image.

**Example prompt structure:**  
`"Wide 16:9 impasto oil painting in the style of Van Gogh with thick visible brushstrokes. [METAPHORICAL SCENE FOR THIS CASE STUDY]. Warm earth tones - ochre, deep blue, burnt sienna, cream. Moody atmospheric lighting. No text."`

So to **recreate or add** case-study hero images: use that structure + a one-line metaphor per case study (e.g. content flowing through a flywheel for Distill, browser/catalog for Image Browser), and output to `src/content/assets/case-studies/<name>_wide.png`.

---

### 4. Case-study video loops (_wide_loop.mp4)

**Assets:**  
`public/videos/case-studies/*.mp4` and `src/content/assets/case-studies/*_wide_loop.mp4` (e.g. `distill_wide_loop.mp4`).  
The `.uri` files in `src/content/assets/case-studies/` only store Gemini download URLs, not the prompts.

**Workflow inferred from session 13e70652 + weekend-coding-agent video skill:**

1. Start from the **case-study hero image** (e.g. `distill_wide.png`).
2. Call nano-banana **video** with:
   - `--file` = path to that image (image-to-video).
   - `--output` = e.g. `…/distill_wide_loop.mp4`.
   - `--resolution 720p` (and optionally `--duration` for loop length).
   - **Prompt:** A short “screenplay” describing how elements in the image move (e.g. “Subtle parallax, wheel turns slowly, light flickers”) so the loop feels coherent.

So the **prompts used to generate and video-animate** the case-study images are:

- **Image:** Same as §3 — Wide 16:9, impasto or vintage, metaphor for the case study, warm earth tones, no text.
- **Video:** Same tool and size/duration as in §2, with `--file` set to the `_wide.png` asset and a motion/shot-list description tailored to that graphic (and optionally “looping” or “seamless loop” in the prompt).

---

## Summary Table

| Asset type              | Where prompts were found              | Tool / workflow                                      |
|-------------------------|---------------------------------------|------------------------------------------------------|
| Blog/card infographics  | Session d2f5c111 (tools JSON)        | nano-banana image + Tufte/Focus.AI/style prompts    |
| Post infographic → video| Session 13e70652 (user messages)      | nano-banana image then `--video` + 720p + motion    |
| Case-study hero images  | CLAUDE.md (no session tool calls)     | Same Wide 16:9 + metaphor pattern as CLAUDE.md      |
| Case-study loop videos  | Inferred from §2 + video skill        | nano-banana `--video` with `--file` _wide.png + motion |

---

## References

- `docs/walkthroughs/session-analysis-walkthrough.md` — session list, show, messages, tools, index, search.
- thefocus-landing `CLAUDE.md` — post header images, nano-banana style, Wide 16:9.
- thefocus-landing `subsites/weekend-coding-agent/skills/generate_video/SKILL.md` — Veo/nano-banana video options and prompting.
- Session d2f5c111 tools: nano-banana Bash commands for data-flywheel cards and infographics.
- Session 13e70652 messages: infographic + “short animated video … 720p and looping” and “describe how we want all of the things to move”.
