# Personality quiz — the 36 questions, with memory

Two people work through [Aron et al.'s 36 questions][aron] — the escalating
self-disclosure protocol popularly known as "the 36 questions that lead to
love" — and both of them come out of it as someone you can talk to again.

The point isn't the transcript. It's that a persona starts as a one-line
sketch and finishes as a person with a history, and that the history survives
the process exiting.

```bash
# both seats played by the model — watch two strangers become specific
dotenvx run -- pnpm tsx examples/personality-quiz/quiz.ts --questions 6

# take a seat yourself
dotenvx run -- pnpm tsx examples/personality-quiz/quiz.ts --human Will

# afterwards: talk to someone who remembers the conversation
dotenvx run -- pnpm tsx examples/personality-quiz/reconnect.ts --person mira --you theo
```

## How it works

Each question is posted into a `Dialogue` as an ambient **event** — something
that happened *to* the conversation rather than something a participant said.
Both people answer, then a separate pass writes what was revealed into their
profiles, and those profiles go back into each persona's system prompt before
the next question.

```
question (ambient event)
      ↓
  A answers ─┐
  B answers ─┴→ witness pass ─→ profiles ─→ system prompts ─→ next question
```

Three moving parts are worth understanding.

**The license to invent.** A persona's seed is deliberately thin ("Mid-thirties.
Moved to a new city eight months ago for a job she is not sure about."). Almost
every question therefore reaches something that has never been established, and
the persona is told to make it up and then treat it as permanently binding.
That invention is captured by the witness pass and returned as system context,
so the character *accretes* rather than drifting — question 30 is answered by
someone with 29 questions of history, not by a model improvising fresh each
time.

**The witness runs outside the dialogue.** Neither persona is ever asked to
summarize itself mid-conversation; that leaks the machinery into the transcript
and makes people talk like they're being observed. A separate `Interaction`
(`reflect.ts`) reads each exchange and produces, per speaker: facts about them,
a rewritten first-person self-image, and the impression the *other* person is
forming. Facts reuse `@umwelten/core`'s memory types, so `determineOperations`
can reconcile them — "has a dog" gets *replaced* by "has a dog named Max"
instead of accumulating beside it. Pass `--no-reconcile` for cheap local dedupe
instead.

**Impressions are what make a reconnection feel like one.** A profile holds
three separate things: what you said (verbatim), distilled facts about you, and
what you now believe about the *other* person. That third kind is why
`reconnect.ts` produces someone who remembers you rather than a stranger
reading your file — and it's gated on the two of them having actually talked,
so having a profile is never by itself permission to know its contents.

## Files

| File | What it holds |
| --- | --- |
| `questions.ts` | The 36 questions, canonical numbering, three sets with framing |
| `profile.ts` | `PersonProfile` — answers, facts, impressions, self-image; load/save/render |
| `reflect.ts` | The witness pass: one structured call per exchange |
| `personas.ts` | Profile → `InteractionParticipant`; the persona contract; context refresh |
| `round-policy.ts` | Turn policy: one question, both answers, alternating who leads |
| `quiz.ts` | Driver for the 36 questions |
| `reconnect.ts` | Open-ended chat with a persona that remembers |

## Flags

**`quiz.ts`**

| Flag | Effect |
| --- | --- |
| `--questions N` | Stop after N questions (default: all 36) |
| `--sets 1,2` | Restrict to certain sets |
| `--human [name]` | Take one of the two seats yourself |
| `--a ID` / `--b ID` | Profile ids for the two seats (default `mira` / `theo`) |
| `--fresh` | Start both profiles over instead of resuming |
| `--no-reconcile` | Local dedupe instead of the LLM memory reconciler |
| `--no-persist` | Skip writing the dialogue transcript |
| `--provider` / `--model` | Override the model (also `QUIZ_PROVIDER` / `QUIZ_MODEL`) |

**`reconnect.ts`**

| Flag | Effect |
| --- | --- |
| `--person ID` | Whose profile the persona embodies — who you're talking to |
| `--you ID` | Which profile is you (inferred when they only know one person) |
| `--scene TEXT` | Set the circumstances of running into each other again |
| `--no-learn` | Don't update memory from this conversation |

Type `exit` to leave a conversation you're sitting in.

## Cost

A full 36-question run is 72 persona turns plus 36 witness passes, and
`--reconcile` (on by default) adds up to two more calls per question. Start
with `--questions 6` to see the mechanism before paying for the whole protocol.
The escalation is the mechanism, so `--questions N` always takes from the
shallow end — jumping straight to set III produces performance, not disclosure.

## Where things land

- **Profiles** → `examples/personality-quiz/profiles/<id>.json` (override with
  `QUIZ_PROFILE_DIR`). Gitignored — the people are generated, not source.
- **Transcripts** → `~/.umwelten/dialogues/<id>/`, the same layout habitat
  sessions use, so `umwelten browse` renders them with no changes.

Profiles are resumable: run the quiz again without `--fresh` and the same two
people pick up where they left off.

[aron]: https://journals.sagepub.com/doi/10.1177/0146167297234003
