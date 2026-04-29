---
name: air-version-bump
description: 'Bump versions in lockstep across the AIR monorepo when a PR ships new package contents to npm. TRIGGER when the PR changes publishable code under `packages/*/src/`, JSON schemas under `schemas/` or `packages/core/schemas/`, or shipped fields (dependencies, peerDependencies, bin, exports, main, files) in a `packages/*/package.json`. SKIP when the PR is scoped to non-published files only: `README.md`, `docs/`, `CHANGELOG.md`, `examples/`, `tests/` (root or `packages/*/tests/`), `.github/`, `.claude/`, or root config files such as `tsconfig.base.json`, `vitest.workspace.ts`, `.gitignore`, root `package.json` — none of those ship to npm.'
user-invocable: true
argument-hint: '[patch|minor|major]'
---

# AIR Version Bump

Bump type: $ARGUMENTS (default: patch)

## When NOT to bump

Versioning exists to publish new package contents to npm — `publish.yml` only publishes a package when its `version` does not already exist on the registry. Files that do not ship in any npm package have no functional reason to bump.

**Skip this skill entirely** when the PR's diff is scoped to one or more of:

- `README.md` and other repo-root markdown
- `docs/` — user-facing documentation
- `CHANGELOG.md` — written by this skill when a real bump happens; never the trigger
- `examples/` — sample configs, not bundled in any package
- `tests/` (repo-root) and `packages/*/tests/` — never published; only `dist/` (and `schemas/` for core) ships
- `.github/` — CI and workflow config
- `.claude/` — Claude / AO session resources (generally gitignored)
- Root config files: `tsconfig.base.json`, `vitest.workspace.ts`, `.gitignore`, root `package.json` (workspace metadata)
- Asset files referenced only by docs (e.g., `assets/` containing screenshots or videos)

If the PR only touches files in those categories, do NOT bump versions, do NOT edit any `packages/*/package.json`, do NOT add a `CHANGELOG.md` entry, and do NOT regenerate the lockfile. Open the PR without invoking this skill.

A mixed PR that touches both publishable and non-publishable files DOES need a bump — the trigger is whether any publishable file changed, not the proportion.

## What to bump

AIR is an npm workspaces monorepo where all packages are versioned in lockstep. A complete version bump must touch every category below:

1. **Every `package.json` in `packages/`** — update the `version` field in each one to the new version.

2. **Internal dependency references** — packages depend on each other (e.g., sdk depends on core, cli depends on sdk). Search each `package.json` for `dependencies` entries that reference other `@pulsemcp/air-*` packages and update those version strings to match.

3. **Hardcoded version strings in source code** — the CLI entry point has a hardcoded `.version()` call that must match. Grep the source for the old version string to find it and any others that may have been added.

4. **`CHANGELOG.md`** — add a new entry at the top of the changelog (below the header) for the new version. The file lives at the repo root and follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format:

   ```markdown
   ## [x.y.z] - YYYY-MM-DD

   ### Added
   - Description of new features or capabilities

   ### Fixed
   - Description of bug fixes

   ### Changed
   - Description of changes to existing functionality
   ```

   Categorize the PR's changes under the appropriate subsections (`Added`, `Fixed`, `Changed`, `Removed`, etc.). Only include subsections that apply. Use today's date in `YYYY-MM-DD` format.

5. **The lockfile** — run `npm install` after all edits to regenerate `package-lock.json`.

## Verification

After making all changes, verify nothing was missed:

- Check that every `package.json` under `packages/` shows the same `version` value
- Check that every internal `@pulsemcp/air-*` dependency reference matches the new version
- Check that `CHANGELOG.md` has a new entry for the bumped version with today's date
- Grep the entire repo for the old version string — there should be zero hits outside of `node_modules/` and `package-lock.json`

## Build and test

```bash
npm run build -w packages/core   # core must build first (others depend on it)
npm run build                     # build remaining packages
npx vitest run                    # run all tests
```

## Publishing

Publishing is automatic. The `publish.yml` workflow runs on every push to `main` and publishes any package whose version doesn't already exist on npm. Packages are published in dependency order.

## Key things to watch for

- `CHANGELOG.md` must be updated with every version bump — it's easy to forget since it's not a `package.json` or source file
- The CLI has a hardcoded `.version()` call in its entry point that is easy to forget since it's not in a `package.json`
- Internal dependency references (e.g., sdk's dependency on `@pulsemcp/air-core`) must match — updating just the `version` field without updating cross-references breaks installs
- Always run `npm install` to update the lockfile, otherwise CI will fail
- When opening a PR that includes a version bump, include the new version number in the PR title (e.g., "Fix init roots generation (v0.0.17)") — this helps reviewers and the git log immediately see which version a PR targets
