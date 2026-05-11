# Backlog: Agent Definition Export/Import

Export and import complete agent definitions, including persona, skills, tool config, and related runtime metadata.

## Acceptance criteria

- [ ] Define portable export format for an agent definition
- [ ] Export persona/stimulus, skills, model config, tool exposure/config, and declared capabilities
- [ ] Import creates or updates a habitat without losing unrelated local state
- [ ] Validate imported definitions before applying
- [ ] Include tests for round-trip export/import
