# Releasing umwelten

A point release ships every workspace package to npm via a single git tag.
CI does the actual publish; humans do the version bump and tag push.

## What's published

All `@umwelten/*` packages plus the `umwelten` meta package are public on
npm. Eight packages publish in lockstep — they share the same version
number, set in each package's `package.json`. The meta package
`umwelten` re-exports the rest and is the one most users install
(`npm i -g umwelten`).

`workspace:*` deps between packages are rewritten to the concrete
version at publish time by `pnpm publish` — you don't need to edit them.

## The cut process

A release is one commit (version bumps) plus one tag (`v<version>`).
GitHub Actions takes over from the tag push.

### 1. Pick the version

We follow semver loosely:

- **Patch** (`0.4.12` → `0.4.13`): bug fix, small adapter addition, no
  breaking changes to public types.
- **Minor** (`0.4.12` → `0.5.0`): new public surface, deprecation, or
  a behavior change a user could notice. Adding a new SessionAdapter
  counts as minor; renaming a public type counts as minor.
- **Major** (`0.x.y` → `1.0.0`): only when we deliberately decide the
  API surface is stable.

### 2. Bump every package

From the repo root:

```bash
NEW=0.4.13   # set to the version you picked
pnpm -r --filter='./packages/*' exec npm version "$NEW" --no-git-tag-version
```

This bumps every package's `package.json` in place; `--no-git-tag-version`
prevents npm from making nested git tags. Verify:

```bash
git diff --stat packages/*/package.json
```

All eight files should show the same one-line version bump.

### 3. Run the gates locally

The CI workflow runs the same `pnpm test:run` as a publish gate, but it's
cheaper to fail fast on your laptop:

```bash
pnpm install                # refresh lockfile after version bumps
pnpm test:run               # ~8s — must be green
```

### 4. Commit and tag

```bash
git add -A
git commit -m "chore(release): v$NEW"
git tag "v$NEW"
git push origin main
git push origin "v$NEW"   # triggers .github/workflows/release.yml
```

Watch the Actions tab on GitHub. The workflow:

1. Checks out the tag
2. Installs deps with the frozen lockfile
3. Runs the unit suite
4. Runs `pnpm -r publish --access public --no-git-checks --provenance`,
   which iterates every non-private package and publishes it to npm

If you only see `umwelten` (the meta package) appear on npm and not the
sub-packages, look at the workflow logs — `pnpm -r publish` is the line
to check.

### 5. Verify

```bash
npm view umwelten version          # should equal $NEW
npm view @umwelten/core version    # should equal $NEW
```

## When things go wrong

### CI runs but no packages land on npm

Almost always an auth issue. Confirm the `NPM_TOKEN` repository secret
is still valid and has publish permission on the `@umwelten` scope.
`NPM_CONFIG_PROVENANCE=true` requires the workflow have `id-token: write`,
which is already set.

### Tag created but tests failed in CI

The publish step doesn't run. To re-release:

1. Fix whatever the test caught on `main`
2. Delete the old tag locally and on origin:
   ```bash
   git tag -d "v$NEW"
   git push origin ":refs/tags/v$NEW"
   ```
3. Re-tag the new tip of `main` and push.

### One package needs a hotfix between releases

We don't support out-of-lockstep package versions. Bump everyone to the
next patch (`0.4.13` → `0.4.14`) even if only one package changed.

### Need to publish manually (e.g. CI is down)

```bash
# from a clean checkout of the tagged commit
pnpm install --frozen-lockfile
pnpm test:run
pnpm -r publish --access public --no-git-checks
```

You need npm login (`npm whoami`) and publish rights on the `@umwelten`
scope.

## Version-bump checklist

- [ ] All eight `package.json` files match the new version
- [ ] `pnpm install` re-ran so the lockfile reflects the bumps
- [ ] `pnpm test:run` passed locally
- [ ] One `chore(release): v$NEW` commit (no other changes mixed in)
- [ ] Tag `v$NEW` pushed to origin
- [ ] CI workflow finished green
- [ ] `npm view umwelten version` returns `$NEW`
