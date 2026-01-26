---
title: "npm Package Publishing: Best Practices for 2026"
date: 2026-01-26
topic: npm-publishing
recommendation: Trusted Publishing with OIDC + Changesets
version_researched: npm 11.8.0
use_when:
  - Publishing JavaScript/TypeScript packages to npm registry
  - Setting up automated CI/CD publishing workflows
  - Maintaining public or private npm packages
  - Building libraries for the JavaScript ecosystem
avoid_when:
  - Internal-only packages (consider private registry or GitHub Packages)
  - Rapid prototyping where formal publishing isn't needed
  - Single-use scripts not intended for distribution
project_context:
  language: JavaScript/TypeScript
  relevant_dependencies: []
---

## Summary

The npm publishing landscape has undergone significant security-focused changes in 2025-2026, with **Trusted Publishing via OIDC** becoming the gold standard for automated publishing. Released as GA in July 2025[6], this approach eliminates the need for long-lived npm tokens by using OpenID Connect for authentication directly from CI/CD workflows.

The recommended modern publishing stack combines:
- **Trusted Publishing** for secure, token-free CI/CD publishing
- **Changesets** (417k weekly downloads, 8.8k GitHub stars) for version management with developer control[4]
- **tsup** for TypeScript compilation to dual ESM/CJS formats[7]
- **npm 11.5.1+** (required for trusted publishing features)[6]

Key developments in 2025 include mandatory 2FA for package publishing, automatic provenance attestations with trusted publishing, and staged publishing (coming soon) which introduces a review window before releases become public[2]. The supply chain attacks of 2025, including the "Shai-Hulud" campaign, have made these security measures essential rather than optional[2][9].

## Philosophy & Mental Model

Modern npm publishing operates on three core principles:

### 1. Security Through Identity, Not Secrets
Traditional publishing relied on NPM_TOKEN secrets stored in CI environments—a known attack vector. Trusted publishing inverts this model: instead of proving identity with a secret, your CI/CD provider (GitHub Actions, GitLab CI) cryptographically proves the publish request originates from an authorized workflow[6]. Each publish uses short-lived, workflow-specific credentials that cannot be exfiltrated.

### 2. Explicit Change Declaration
Rather than inferring version bumps from commit messages (semantic-release approach), the modern philosophy favors explicit changeset files where developers declare "what changed and why" at development time. This separates the versioning decision from the deploy action, allowing review and adjustment[4].

### 3. ESM-First with CJS Compatibility
ES modules are the future, but backward compatibility matters. The mental model is: "Write ESM-first, transpile CJS as a courtesy." Node.js now supports `require(esm)`, making dual publishing less critical but still valuable for maximum ecosystem compatibility[7].

## Setup

### Prerequisites

```bash
# Ensure npm 11.5.1+ (required for trusted publishing)
npm --version  # Should show 11.5.1 or higher
# Or install latest npm
npm install -g npm@latest

# Node.js 24+ includes npm 11 by default
node --version
```

### Step 1: Configure package.json

```json
{
  "name": "@yourscope/package-name",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    ".": {
      "import": {
        "types": "./dist/index.d.ts",
        "default": "./dist/index.js"
      },
      "require": {
        "types": "./dist/index.d.cts",
        "default": "./dist/index.cjs"
      }
    },
    "./package.json": "./package.json"
  },
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "prepublishOnly": "npm run test && npm run build",
    "release": "changeset publish"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

### Step 2: Configure tsup for Dual ESM/CJS

```typescript
// tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
});
```

### Step 3: Initialize Changesets

```bash
pnpm add -D @changesets/cli
pnpm changeset init
```

Configure `.changeset/config.json`:

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.0.0/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

### Step 4: Configure Trusted Publishing on npm

1. Go to https://npmjs.com and navigate to your package settings
2. Find "Trusted Publisher" section
3. Select "GitHub Actions" (or GitLab CI/CD)
4. Configure:
   - **Organization/User**: Your GitHub username or org
   - **Repository**: Your repository name
   - **Workflow filename**: `release.yml` (must match exactly)
   - **Environment**: (optional) for additional protection

### Step 5: Create GitHub Actions Workflow

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    branches:
      - main

concurrency: ${{ github.workflow }}-${{ github.ref }}

permissions:
  contents: write
  pull-requests: write
  id-token: write  # Required for trusted publishing

jobs:
  release:
    name: Release
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '24'
          registry-url: 'https://registry.npmjs.org'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Create Release Pull Request or Publish
        id: changesets
        uses: changesets/action@v1
        with:
          publish: pnpm run release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # No NPM_TOKEN needed with trusted publishing!
```

## Core Usage Patterns

### Pattern 1: Creating a Changeset

When you make a change that should be released, create a changeset:

```bash
pnpm changeset
```

This launches an interactive CLI:
1. Select which packages changed (for monorepos)
2. Choose bump type: patch, minor, or major
3. Write a summary of changes

This creates a markdown file in `.changeset/`:

```markdown
---
"@yourscope/package-name": minor
---

Added new authentication middleware with JWT support
```

Commit this file alongside your code changes.

### Pattern 2: Testing Before Publishing

Always test your package output before publishing[12]:

```bash
# Build the package
pnpm build

# Create tarball (simulates npm publish)
npm pack

# Check contents
tar -tzf yourscope-package-name-1.0.0.tgz

# Test in another project
cd /path/to/test-project
npm install /path/to/yourscope-package-name-1.0.0.tgz
```

For faster iteration during development, use `yalc`:

```bash
# In your package
npm install -g yalc
yalc publish

# In test project
yalc add @yourscope/package-name
```

### Pattern 3: Validating Package Exports

Use "Are the Types Wrong" to validate your package.json configuration[7]:

```bash
npx @arethetypeswrong/cli --pack .
```

This catches common issues:
- Missing type definitions
- Incorrect exports conditions
- ESM/CJS resolution problems

### Pattern 4: Monorepo Publishing with Workspaces

For pnpm workspaces, configure each package independently:

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
```

Changesets handles monorepo versioning automatically:

```bash
# Create changeset affecting multiple packages
pnpm changeset

# Version all changed packages
pnpm changeset version

# Publish all packages
pnpm changeset publish
```

### Pattern 5: Pre-release Publishing

For beta/alpha releases, use Changesets pre-release mode:

```bash
# Enter pre-release mode
pnpm changeset pre enter beta

# Create changesets and version as normal
pnpm changeset
pnpm changeset version  # Creates 1.0.0-beta.0

# Exit pre-release mode
pnpm changeset pre exit
```

## Anti-Patterns & Pitfalls

### Don't: Store NPM_TOKEN in CI Secrets

```yaml
# BAD: Using long-lived tokens
- name: Publish
  run: npm publish
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}  # Security risk!
```

**Why it's wrong:** Long-lived tokens can be compromised, accidentally exposed in logs, or require manual rotation. The 2025 supply chain attacks exploited exactly this pattern[2][9].

### Instead: Use Trusted Publishing

```yaml
# GOOD: Token-free trusted publishing
permissions:
  id-token: write

- name: Publish
  run: npm publish --provenance --access public
  # No token needed - OIDC handles authentication
```

### Don't: Rely on .npmignore Without Testing

```bash
# BAD: Assuming .npmignore works correctly
echo "src/" >> .npmignore
npm publish  # May still include unwanted files
```

**Why it's wrong:** .npmignore has complex interactions with .gitignore and can accidentally publish sensitive files like `.env` or `credentials.json`[14].

### Instead: Use the `files` Field + npm pack

```json
{
  "files": ["dist"]
}
```

```bash
# GOOD: Verify package contents before publishing
npm pack --dry-run  # Lists all files that will be included
```

### Don't: Publish Without Version Bump

```bash
# BAD: Trying to overwrite an existing version
npm version  # Skipped
npm publish  # Error: cannot publish over existing version
```

**Why it's wrong:** npm immutably stores versions. Once 1.0.0 is published, it cannot be changed.

### Instead: Always Bump Version

```bash
# GOOD: Use semantic versioning
npm version patch  # 1.0.0 -> 1.0.1
npm version minor  # 1.0.0 -> 1.1.0
npm version major  # 1.0.0 -> 2.0.0

# Or let Changesets handle it automatically
pnpm changeset version
```

### Don't: Publish Pre-releases to `latest` Tag

```bash
# BAD: Publishing beta to latest
npm version 2.0.0-beta.1
npm publish  # Installs as default for all users!
```

**Why it's wrong:** Users running `npm install yourpackage` will get the unstable beta.

### Instead: Use Dist Tags

```bash
# GOOD: Explicit tag for pre-releases
npm publish --tag beta

# Users opt-in to beta:
npm install yourpackage@beta
```

### Don't: Skip 2FA Configuration

**Why it's wrong:** As of 2025, all packages require 2FA or granular access tokens for publishing. Skipping this configuration will block your publishes[16].

### Instead: Enable 2FA and Configure Trusted Publishing

1. Enable 2FA on your npm account (Settings > Two-Factor Authentication)
2. Use WebAuthn/FIDO keys for strongest security
3. Configure trusted publishing to eliminate token management entirely

## Why This Choice

### Decision Criteria

| Criterion | Weight | How Trusted Publishing + Changesets Scored |
|-----------|--------|-------------------------------------------|
| Security | Critical | Excellent - No secrets to manage, automatic provenance |
| Developer Experience | High | Good - Explicit changesets, review before release |
| Automation | High | Excellent - Full CI/CD automation with human oversight |
| Monorepo Support | Medium | Excellent - Changesets designed for monorepos |
| Learning Curve | Medium | Moderate - Requires understanding changeset workflow |
| Ecosystem Adoption | Medium | Strong - Used by major projects (Turborepo, Pnpm) |

### Key Factors

- **Security First**: After the 2025 supply chain attacks, eliminating long-lived tokens is essential. Trusted publishing provides cryptographic proof of publish origin[6].

- **Developer Control**: Unlike fully automated semantic-release, Changesets lets developers explicitly declare changes. This prevents surprise releases from poorly-formatted commit messages[4].

- **Monorepo Native**: Changesets was built specifically for multi-package repositories, handling cross-package dependencies automatically[4].

- **Provenance by Default**: With trusted publishing, npm automatically generates provenance attestations linking packages to source code and build instructions[9].

## Alternatives Considered

### Semantic-Release

- **What it is:** Fully automated release tool that analyzes commit messages (conventional commits) to determine version bumps and publish automatically[4].
- **Why not chosen:** Requires strict commit message discipline from entire team. Unexpected releases can occur from improperly formatted commits. Less suitable for teams wanting human review before releases.
- **Choose this instead when:**
  - Your team strictly follows conventional commits
  - You want zero-touch automation after merge
  - You have robust CI/CD and trust your commit hygiene
- **Key tradeoff:** Maximum automation vs. less control over release timing

### Release Please (Google)

- **What it is:** PR-based release workflow that creates release PRs from conventional commits, requiring manual merge to publish[4].
- **Why not chosen:** Still relies on commit message analysis. Less explicit about what changes are included compared to changeset files.
- **Choose this instead when:**
  - You prefer Google's tooling ecosystem
  - You want PR-based review but don't want to manage changeset files
  - Your team already uses conventional commits reliably
- **Key tradeoff:** PR-based review vs. changeset file management

### Release-it

- **What it is:** Interactive CLI tool for versioning and publishing with plugin support for changelog generation[5].
- **Why not chosen:** More manual/interactive workflow. Less suited for fully automated CI/CD. Better for smaller projects or manual releases.
- **Choose this instead when:**
  - You prefer interactive release process
  - You want fine-grained control during each release
  - You're maintaining a single package (not monorepo)
- **Key tradeoff:** Interactive control vs. automation

### Manual Publishing

- **What it is:** Direct `npm version` + `npm publish` from local machine.
- **Why not chosen:** Security risk (requires local npm token), no provenance, no automated changelog, prone to human error.
- **Choose this instead when:**
  - Initial package setup and testing
  - One-time or infrequent publishes
  - Learning npm publishing workflow
- **Key tradeoff:** Simplicity vs. security and automation

## Caveats & Limitations

- **Trusted Publishing Requirements**: Requires npm CLI v11.5.1+ and currently only supports GitHub Actions and GitLab CI/CD as identity providers[6]. Self-hosted runners are not supported yet.

- **Workflow Filename Must Match Exactly**: The workflow filename configured on npmjs.com must exactly match your actual workflow file, including the `.yml` extension. This is case-sensitive[17].

- **Provenance Doesn't Guarantee Safety**: Package provenance verifies where code came from, not whether it's malicious. A compromised repository can still publish malicious code with valid provenance[9].

- **Changesets Learning Curve**: Developers must remember to create changeset files for releasable changes. Forgetting changesets means changes won't be released.

- **Dual ESM/CJS Complexity**: Despite improvements, publishing packages that work correctly in both ESM and CJS environments remains complex. Use tools like `@arethetypeswrong/cli` to validate[7].

- **Staged Publishing (Coming)**: npm is implementing staged publishing that will require MFA-verified approval during a review window before packages go public[2]. This may affect CI/CD workflows when released.

- **Scoped Packages Default to Private**: Scoped packages (@yourscope/package) require explicit `--access public` or `publishConfig.access: "public"` to be publicly accessible[1].

## References

[1] [npm Docs: Creating and Publishing Scoped Public Packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/) - Official documentation on scoped package publishing requirements

[2] [Socket: npm to Implement Staged Publishing](https://socket.dev/blog/npm-to-implement-staged-publishing) - Coverage of upcoming staged publishing feature and 2025 security context

[3] [Snyk: Best Practices for Modern npm Package](https://snyk.io/blog/best-practices-create-modern-npm-package/) - Comprehensive guide covering security, testing, and publishing

[4] [Oleksii Popov: NPM Release Automation Guide](https://oleksiipopov.com/blog/npm-release-automation/) - Detailed comparison of Semantic Release, Release Please, and Changesets

[5] [GitHub: release-it](https://github.com/release-it/release-it) - Documentation for release-it automation tool

[6] [GitHub Changelog: npm Trusted Publishing GA](https://github.blog/changelog/2025-07-31-npm-trusted-publishing-with-oidc-is-generally-available/) - Announcement of trusted publishing general availability

[7] [Liran Tal: TypeScript in 2025 with ESM and CJS](https://lirantal.com/blog/typescript-in-2025-with-esm-and-cjs-npm-publishing) - Analysis of current TypeScript publishing challenges and solutions

[8] [Hiroki Osame: Guide to package.json exports](https://hirok.io/posts/package-json-exports) - Comprehensive guide to the exports field

[9] [DEV: npm Security 2025](https://dev.to/dataformathub/npm-security-2025-why-provenance-and-sigstore-change-everything-2m7j) - Deep dive into provenance and Sigstore

[10] [npm Docs: Generating Provenance Statements](https://docs.npmjs.com/generating-provenance-statements/) - Official provenance documentation

[11] [remarkablemark: npm Trusted Publishing Setup](https://remarkablemark.org/blog/2025/12/19/npm-trusted-publishing/) - Step-by-step trusted publishing configuration guide

[12] [DEV: Testing NPM Packages with npm pack](https://dev.to/yoriiis/how-we-test-npm-packages-before-publishing-with-npm-pack-57bo) - Best practices for pre-publish testing

[13] [GitHub: Changesets](https://github.com/changesets/changesets) - Official Changesets repository and documentation

[14] [Zell Liew: Ignoring Files from npm Package](https://zellwk.com/blog/ignoring-files-from-npm-package/) - Comparison of .npmignore vs files field

[15] [jsdev.space: Complete Monorepo Guide](https://jsdev.space/complete-monorepo-guide/) - pnpm workspaces with Changesets configuration

[16] [npm Docs: Requiring 2FA](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/) - Official 2FA requirements documentation

[17] [npm Community: OIDC Publishing Troubleshooting](https://github.com/orgs/community/discussions/176761) - Common issues with trusted publishing setup

[18] [johnnyreilly: Dual Publishing with tsup](https://johnnyreilly.com/dual-publishing-esm-cjs-modules-with-tsup-and-are-the-types-wrong) - Practical guide to ESM/CJS dual publishing

[19] [OWASP: NPM Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/NPM_Security_Cheat_Sheet.html) - Security best practices for npm

[20] [The Hacker News: GitHub Mandates 2FA](https://thehackernews.com/2025/09/github-mandates-2fa-and-short-lived.html) - Coverage of 2025 npm security mandate changes
