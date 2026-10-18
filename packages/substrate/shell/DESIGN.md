# Shell visual language

The Habitat Shell follows **Habitats design system v0.2**. The source of
truth is `design.md` in the private habitats repo (the Habitats SaaS at
habitats.thefocus.ai). Tokens, type, radius, and base classes live in
`theme.css` here — a port of that spec, not a live import.

Do not add a dependency on the private repo.

Rules this shell keeps:

- Light theme only (`--bg #fafafa`, `--ink #0a0a0a`). No dark-mode toggle.
- Geist for UI text; Geist Mono only for IDs, keys, and timestamps.
- Black is the action color. No uppercase eyebrow headings.
- Old component variables (`--panel`, `--line`, `--muted`, `--accent`,
  `--error`) and `.shell-card` remain as aliases onto these tokens.
