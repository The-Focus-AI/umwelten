# Phase 7: Config-Driven Skill Management

Manage habitat skills declaratively through Gaia config so a rebuilt habitat recreates skills, secrets, and model configuration from scratch.

## Acceptance criteria

- [x] Add `skillsFromGit` to create/config flow
- [x] Add Gaia tools: `add_skill`, `remove_skill`, `list_skills`, `update_habitat_config`
- [x] Update `create_habitat` to accept skills
- [x] Update STIMULUS template for config-driven skill management
- [x] Remove secrets tool set from Gaia-managed containers
- [x] Integrate `npx skills` in entrypoint and generate real `skills-lock.json`
- [x] Seed only config and secrets; never fake lock files
- [x] Re-seed volume on skill add/remove
- [x] Load skills from `.agents/skills/` and `./skills/`
- [x] Verify rebuild/destroy/recreate preserves configured skills
