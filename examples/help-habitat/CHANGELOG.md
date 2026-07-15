# Habitats — what's changed

User-facing release notes for the Habitats product and the @Help agent.
This file is loaded into @Help's context (config.memoryFiles) so it can
answer "what's new?" / "when did X change?" accurately instead of guessing.

Keep entries short, dated, and written for end users — what they can see
or do differently, not internal refactors. Newest first. Redeploy this
file onto the Help volume (next to STIMULUS.md) when it changes.

## 2026-07-15

- **@Help now understands the full agent lifecycle.** It distinguishes creating
  a room, attaching an existing agent, and asking an operator to build and
  deploy a new agent service. It can also explain marketplace and URL attach,
  authorization, credentials, refresh, transcripts, reconnect, and detach.
- **Thread guidance is accurate.** The main room and each side thread have
  separate agent memory, while every conversation can still have many human
  speakers with per-person identity.
- **Safer live-status checks.** @Help can ask Gaia for read-only health and
  availability, but it cannot use that path to change agents or expose
  token-bearing operational links.

## 2026-07-05

- **Threads got real memory.** Replying in a thread now keeps that
  conversation separate: an agent in a thread remembers only that thread,
  and the main room no longer bleeds into thread replies (or vice versa).
  Threads also survive page reloads reliably.
- **Habitats fleet upgraded to Claude Sonnet 5.** Gaia, Help, and Twitter
  agents now run on `anthropic/claude-sonnet-5`.

## 2026-07-04

- **@Help can check live status.** Help can now ask the Gaia orchestrator
  which agents are running and relay real operational status instead of
  only product knowledge.
- **Gaia picks real models.** When creating or reconfiguring agents, Gaia
  now looks up the live OpenRouter catalog (newest first, with pricing)
  instead of guessing model names — and creating a habitat no longer
  fails when you don't specify a model.
- **Stable agent addresses.** Restarting or rebuilding an agent keeps it
  at the same address instead of drifting.

## 2026-07-03

- **Mobile works properly.** The room's Agents & People roster is
  reachable on phones (collapsible section under the room header), the
  Embed panel becomes a bottom sheet, and the create/empty-state screens
  stack on small screens. Earlier: nav drawer, viewport-locked rooms, and
  a pinned composer on phones.
- **Smoother replies.** Agent messages auto-link in-app destinations and
  show plain-English hints when something goes wrong.

## 2026-06-30

- **@Help launched.** A conversational guide to Habitats you can mention
  in any room, paired with the /help/conversations explainer page.
- **Threads and scoped mentions arrived** in rooms: reply to any message
  in a side thread and mention agents inside it.

## 2026-06-25

- **Clickable links in agent replies.** Markdown (links, bold, inline
  code) renders properly in the room.
- **Guides:** getting-started and attaching-agents walkthroughs published.
