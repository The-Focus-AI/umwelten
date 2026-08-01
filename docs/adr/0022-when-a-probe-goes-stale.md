# 0022 — A probe goes stale when the serving path moves, and our own code counts

Status: Accepted
Date: 2026-08-01

An Offer is re-probed when any of these changes, and otherwise after an elapsed
backstop of **24 hours** (configurable):

1. **The agent's own version** — our client integration
2. The serving runtime's version
3. The set of weights on disk, including a file replaced in place
4. What the agent pinned: context length, concurrent slots, serving mode

And always on start, before publishing anything.

## Why our own version is first

ADR 0015 records that a probe is a snapshot of a whole serving path — client
integration, runtime, build, quantization, weights — and goes stale when any
layer in it moves. The layer least likely to prompt anyone to re-probe is our
own code. It is also the layer measurement found dominating the result.

That is not a hypothetical. Twice during the prototype run, a change to this
repository changed what the same weights on the same machine appeared able to
do:

- `supportsStructuredOutputs` defaulted false in `createOpenAICompatible`, so
  the SDK never sent `response_format` and three local providers appeared
  unable to produce structured output.
- The Ollama `think` parameter was unreachable, so reasoning-capable models
  were probed without ever being *asked* to reason, and four of them were
  recorded as having no reasoning at all.

Neither involved a single byte of weights changing. An operator upgrading
umwelten has no reason to think about re-probing, which is exactly why it
cannot be left to them.

## Why not just a timer

A re-probe policy that fires only on a schedule is wrong in both directions. It
is too slow for a runtime upgrade — the Offers are wrong from the moment
`llama-server` restarts until the timer next fires, and they are wrong in a way
that has already been measured to change capability results. And it is too eager
for a machine that has not changed: re-probing costs the machine time it could
spend earning, and a re-probe that finds nothing new still writes to the
Exchange.

So detection is primary and the timer is the backstop, covering what a
fingerprint cannot see — a driver update, a firmware change, thermal behaviour
in a warmer room.

## Why always on start

A restart that republishes the previous snapshot is publishing a claim about a
machine that may no longer exist. Between the two runs a GPU could have been
removed, a runtime downgraded, or weights deleted, and none of that is visible
from the state file alone. Probing on start costs minutes once; publishing a
wrong claim costs a buyer's request and the Supplier's reputation for the
duration.

## What a re-probe does not do

**It does not churn.** A re-probe that finds exactly what the last one found
publishes nothing. A daily write per Model per machine that says what the
previous one said is noise, and noise makes the real changes harder to see.

**It does not take the machine out of service.** Capability re-probes run
against the live runtime, so existing Offers keep serving throughout. The one
bounded exception is Headroom re-sampling, which is real load — it stays within
`HEADROOM_POLICY.maxSampleSeconds` per Model (ADR 0021) and runs only when the
fingerprint moved, not on the elapsed-time path.

**It does not silently change an Offer.** Capabilities gained and lost are
reported to the operator as they are republished. An Offer that quietly stopped
supporting tool calling is a support ticket; an Offer that said so is a
maintenance note.

## The withdrawal threshold

Related, and recorded here because it is the other half of keeping the picture
honest: an Offer is withdrawn after **3 consecutive failed checks** at a 30
second interval — roughly ninety seconds of genuinely not serving — and restored
after **1** success.

The asymmetry is deliberate. Withdrawing on the first failure would let a single
timeout under momentary load take an Offer out, and the next success put it back;
an Offer that flaps in and out of the pool is worse for Dispatch than one that
is honestly down, because routing keeps selecting it during the up phases. But
being slow to *restore* costs the Supplier money for a machine that is working,
which is a cost with no corresponding benefit.

Runtime death skips the threshold entirely. It is not per-Model and it is not in
doubt, and waiting three cycles to say so would route three cycles of traffic
into a process that is not running.
