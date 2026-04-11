# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.19] - 2026-04-11

### Added
- `--no-subagent-merge` flag for `air start` — parity with `air prepare` for skipping subagent root merging
- TUI now pre-selects MCP servers and skills from subagent roots when a root declares `default_subagent_roots`
- `getMergedDefaults` utility for computing the union of parent and subagent artifact defaults
- `--dry-run` output for `air start` now reflects merged subagent artifacts

### Changed
- Adapter no longer merges subagent artifacts on top of explicit overrides — when `mcpServerOverrides` or `skillOverrides` are provided (e.g., from the TUI), they are treated as the final selection

## [0.0.18] - 2026-04-11

### Added
- `air upgrade` command to upgrade the CLI to the latest version via `npm install -g @pulsemcp/air-cli@latest`
- `--dry-run` flag for `air upgrade` to preview what would be run without executing

### Fixed
- `air init` now discovers artifact index files that have individual entries with schema validation errors (e.g., descriptions exceeding 500 characters) — previously the entire file was silently skipped if any entry failed validation
- Artifact index files in subdirectories (e.g., `agents/agent-roots/roots.json`) are now properly discovered

## [0.0.17] - 2026-04-10

### Fixed
- `air init` no longer auto-generates a `roots/roots.json` file in the repo — it only discovers existing artifact index files, consistent with how all other artifact types work

### Changed
- Removed `generatedRootsPath` and `generatedRootName` from `InitFromRepoResult` (breaking for SDK consumers that relied on these fields)

## [0.0.16] - 2026-04-10

### Added
- `hookOverrides` and `pluginOverrides` fields on `PrepareSessionOptions`, allowing callers to override root defaults for hooks and plugins the same way `skillOverrides` and `mcpServerOverrides` already work (#57)

## [0.0.15] - 2026-04-10

### Added
- Interactive terminal UI for `air start claude` with tab-based artifact browsing, per-item toggle, search filtering, and cross-artifact selection summary (#59)
- `--skip-confirmation` flag to bypass TUI and launch agent directly
- `--` passthrough args support to forward arguments to the agent process
- Automatic TTY detection with non-interactive fallback

## [0.0.14] - 2026-04-09

### Fixed
- Handle ESM-only extension packages that throw `ERR_PACKAGE_PATH_NOT_EXPORTED` during CJS resolution (#55)
- Make `air start` and `air prepare` discover adapters installed to `~/.air/node_modules/` (#54)
- `air init` uses `github://` URI for roots, consistent with other artifact types (#52)

### Changed
- `air init` includes all officially maintained extensions by default: adapter-claude, provider-github, secrets-env, secrets-file (#53)
- `air init` writes auto-generated `roots.json` to the repo directory instead of `~/.air/` (#52)
- `startSession` checks extension-provided adapters before falling back to registry lookup (#54)

## [0.0.12] - 2026-04-08

### Added
- Hooks catalog layer with directory-based definitions (#39)
- Repo-aware `air init` with GitHub resolver discovery (#34)
- Auto-generate `roots.json` for current repo during `air init` (#45)
- Comprehensive user-facing CLI guides (#32)

### Fixed
- Resolve extension packages from project dir, not SDK location (#42)
- Default to empty artifact sets when no root defaults configured — artifacts are now opt-in via root selection (#46)
- Load extensions in `startSession` before resolving artifacts (#48)

## [0.0.11] - 2026-04-07

### Fixed
- Support `${VAR:-default}` fallback syntax in `air-secrets-env` (#38)

## [0.0.10] - 2026-04-07

### Added
- Remove `default_stop_condition` from schemas; allow additional properties (#30)
- Support repo-level `@ref` syntax in GitHub resolver URIs (#33)

### Fixed
- Auto-discover extension packages in CI and publish workflows (#31)
- Improve error messages and edge case handling for `@ref` syntax (#35)
- Normalize trailing-slash stripping in workflow globs (#36)

## [0.0.9] - 2026-04-07

### Added
- Initial changelog
