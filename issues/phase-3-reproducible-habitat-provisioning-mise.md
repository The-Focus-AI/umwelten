# Phase 3: Reproducible Habitat Provisioning with mise

Make habitats reproducibly provision projects from git with mise-managed dependencies and declared secrets.

## Acceptance criteria

- [x] Extend `HabitatConfig` with `gitUrl`, `gitBranch`, `projectDir`, `requiredSecrets`
- [x] Add `RequiredSecret` type
- [x] Add `resolveProjectDir()` helper
- [x] Include projectDir in file allowed roots
- [x] Add provision tools: `provision_from_git`, `provision_update`, `install_package`, `declare_secret`, `provision_status`
- [x] Register `provisionToolSet` in `containerToolSets`
- [x] Dockerfile includes mise and curl, and uses entrypoint
- [x] Entrypoint auto-provisions on boot when config has `gitUrl`
- [x] Load `STIMULUS.md` from projectDir as fallback
- [x] `bash` tool defaults cwd to projectDir when provisioned
- [x] Export new types/tool sets
- [x] TypeScript clean and tests pass
