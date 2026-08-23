# 0032 — External harnesses mount as runtimes, not foundations

Status: **Accepted — not yet implemented**
Date: 2026-08-23

> Pinned down in a grilling session. Frame:
> `docs/architecture/composable-surface-2026-08.md`.

## Context

DeepSeek Harness (dsh) is an open-source agent harness built on Cordis —
"everything is a plugin," including its agent loop. It is good, it overlaps
umwelten's habitat almost box-for-box (`ctx.llm`/`ctx.tools`/`ctx.sessions`/
`ctx.systemPrompt`/`ctx.agents`/`ctx.agentLoop` against our providers /
ToolRegistry / session-record / Stimulus / agents / runners), and it ships a
headless one-shot runner (`dsh-headless`). The question this ADR settles is
*where* something like dsh attaches to umwelten — because "just drop it in
wholesale" was on the table.

The habitat already has the seam: **RuntimeRunner**
(`bridge/channel-bridge.ts`), with rich built-ins (`claude-sdk`, `pi`) and
config-declared CLI runtimes via `cli-runner.ts` (the codex preset). A
declared runtime gets a scoped env of only its listed secrets, credential-file
materialization, arg templating, an output parser, and its progress mapped to
bridge events.

The grilling corrected the first framing in two ways that shape the decisions:

- **Declared CLI runtimes are one-shot per message.** `buildInvocation`
  substitutes only `{prompt}`/`{cwd}`; the codex `thread_id` is captured as a
  `nativeSessionRef` for introspection but is never fed back — every turn
  starts a fresh native session. This is a live limitation for codex, not a
  hypothetical one for dsh.
- **A `parser: "text"` mount is degraded, not equivalent.** Raw-stdout
  accumulation loses tool events, the reasoning stream, and the
  final-text/noise distinction. The codex experience is good *because* of
  `handleCodexEvent`; a new harness is only as well-mounted as its parser.

## Decisions

**D1 — The RuntimeRunner seam is the adoption boundary for external
harnesses.** The habitat is the *body*: repo, volume, provisioning, secrets,
sessions, transcript, the A2A/MCP surface, and the container trust boundary.
A runtime is the *brain*: swappable, declared in config, scoped to its listed
secrets. External harnesses — dsh today, whatever comes next — mount as
runtimes. We never rebuild habitat internals on an external harness's plugin
framework to acquire its loop; the seam exists precisely so the loop is the
replaceable part. (The spatiotemporal-composability paper's own boundary
argument, §6.3, supports the outer half: language-level composition cannot
sandbox untrusted code, so the container stays the trust boundary regardless
of how rich the harness inside it is.)

**D2 — The default coding-habitat UX is "pick a repo, pick a brain."**
`claude-sdk`, `pi`, `codex`, `dsh` are peers behind one seam, selectable per
channel the way runtimes already are. No brain is architecturally
privileged; the base Interaction loop remains the `default`.

**D3 — cli-runner grows two general seams before any dsh preset ships.**
Motivated by dsh, paying off immediately for codex:

1. *Resume templating.* `RuntimeSpec` gains `resumeArgs?: string[]`
   supporting a `{session}` placeholder. When the channel's last turn for
   this runtime produced a `nativeSessionRef`, the invocation is built from
   `resumeArgs` with the native session id substituted; otherwise from
   `args` as today. First consumer: codex (`exec resume {session}`), which
   turns the recorded-but-unused `thread_id` into actual continuity.
2. *Parser seam.* `RuntimeOutputParser` stops being a closed union baked
   into `runCliAgent`; parsers register in a small map
   (`codex-json`, `text`, later `dsh-json`) so a new JSONL dialect is a new
   parser module, not an edit to the runner.

**D4 — No dsh preset until its contract is verified.** dsh is a developer
preview; its headless output format, session persistence, and resume story
are unverified. Until someone runs `dsh-headless` and writes down what it
emits, the mount is a *custom* `runtimes` entry with `parser: "text"`,
documented as degraded. The preset (`"dsh": true` with a real parser,
`resumeArgs`, and its secret list) ships only with that verification in hand.
An ADR is not the place to guess another tool's CLI flags.

**D5 — Sandbox posture matches codex.** Inside the habitat container, an
external harness's own approval prompts and sandboxing are bypassed (the
container *is* the sandbox — same posture as the codex preset's
`--dangerously-bypass-approvals-and-sandbox` and claude-sdk's
`permissionMode: "auto"`). Its network and secret exposure are governed by
the runtime spec's scoped env, not by trusting its internal policy layer.

## Consequences

- Adopting a new harness is a config entry plus (for a good mount) a parser
  module — bounded, reversible, and testable in isolation.
- Codex gains session continuity as a side effect of D3, which is the
  strongest evidence the seam generalizes: the extension needed for the new
  case improves the existing one.
- We keep the freedom to *lose interest* in dsh at zero cost — nothing in
  habitat will have grown around it.
- The comparison that motivated this (dsh's plugin-tree internals) is
  answered at a different layer: what umwelten takes from that design is
  ADR 0031's revertible registration and declared needs, inside our own
  registry — not their framework.

## Implementation sequencing

1. Parser seam extraction (pure refactor, codex behavior unchanged).
2. `resumeArgs` + `{session}` templating; enable for codex; integration test
   against a real codex binary in the container image.
3. Verify dsh-headless: output format, session artifacts, resume flags.
   Record findings in this ADR's follow-up.
4. `dsh-json` parser + `dsh` preset, or — if the contract is unstable —
   leave as documented custom spec and revisit next preview release.
