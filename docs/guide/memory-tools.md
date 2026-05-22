# Fact Extraction & Tools

Umwelten no longer exposes automatic chat memory as a public chat mode. `Interaction` always uses the base runner.

For knowledge workflows, use the explicit memory helper APIs from `packages/core/src/memory/`:

- `extractFacts(interaction, modelDetails)` extracts structured facts from an `Interaction`.
- `determineOperations(modelDetails, facts, existingMemories)` proposes ADD/UPDATE/NONE operations for a caller-managed store.

Tool usage remains configured through `Stimulus.tools` and CLI `--tools` options where available.
