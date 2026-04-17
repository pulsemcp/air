# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.30] - 2026-04-17

### Added
- `air start` and `air prepare` now accept `--skills`, `--mcp-servers`, `--hooks`, and `--plugins` flags — each taking a comma-separated list of IDs — to **add** artifacts on top of root defaults non-interactively. Any flag present suppresses the interactive TUI in `air start`; unspecified categories are untouched. `--dry-run` honors these flags so scripted invocations can be previewed.
- Matching `--without-skills`, `--without-mcp-servers`, `--without-hooks`, and `--without-plugins` flags remove specific IDs from the root defaults.
- `--without-defaults` drops all root defaults (parent root + merged subagent roots) so only the artifacts explicitly added via the `--skills` / `--mcp-servers` / `--hooks` / `--plugins` flags are activated.
- New SDK helpers: `computeMergedDefaults(root, artifacts, skipSubagentMerge?)` and `resolveCategoryOverride(explicit, defaults, add, remove, withoutDefaults)` for reusing the add/remove resolution logic from callers other than the CLI.

### Changed
- `air prepare --skills <ids>` (and `--mcp-servers` / `--hooks` / `--plugins`) now **adds** on top of root defaults instead of replacing them. This is a breaking change for callers that relied on the previous override behavior — combine with `--without-defaults` to restore the old semantic (`--without-defaults --skills <ids>`).

## [0.0.29] - 2026-04-14

### Added
- New `PluginEmitter` extension interface in core for building distributable plugin packages from AIR artifacts
- New `@pulsemcp/air-cowork` package — emits Claude Co-work plugin directories and marketplace indexes from AIR plugins, resolving skill/hook/MCP server references into the Co-work inline format
- New `exportMarketplace()` SDK operation for programmatic marketplace generation
- New `air export` CLI command for building marketplace directories (e.g., `air export cowork --output ./marketplace`)

## [0.0.28] - 2026-04-12

### Fixed
- `air init` no longer misclassifies `*.schema.json` files or unrelated filenames containing artifact keywords as catalogs — `detectSchemaType` now excludes `*.schema.json` and uses word-boundary matching instead of substring matching

## [0.0.27] - 2026-04-12

### Changed
- Rename `←→ tabs` to `←→ types` in the TUI legend since the arrow keys switch between artifact types, not browser-style tabs

### Added
- Context-sensitive key hints in the TUI legend bar: search mode displays `↑↓ navigate` / `Space toggle` (on overridable tabs) / `Enter confirm` / `Esc cancel`; normal mode shows the full legend

## [0.0.26] - 2026-04-11

### Added
- Hooks and plugins are now selectable in the `air start` TUI — previously displayed as read-only, they can now be toggled like MCP servers and skills
- `getMergedDefaults()` unions hook and plugin defaults from subagent roots (in addition to MCP servers and skills)
- `TuiResult` includes `hooks` and `plugins` arrays, passed through to `prepareSession()` as override arrays

## [0.0.25] - 2026-04-11

### Changed
- Transform pipeline is now config-file-agnostic — transforms run on all config files returned by `prepareSession().configFiles` (e.g., `.mcp.json`, `.claude/settings.json`), not just `.mcp.json`
- `McpConfig.mcpServers` is now optional — config files without MCP servers (like `settings.json`) pass through transforms correctly
- `TransformContext` has a new `configFilePath` field pointing to the config file currently being transformed; `mcpConfigPath` is deprecated
- `@pulsemcp/air-secrets-env` and `@pulsemcp/air-secrets-file` guard against undefined `mcpServers` for non-.mcp.json configs
- Unresolved `${VAR}` validation now checks all config files, not just `.mcp.json`

### Fixed
- `${VAR}` patterns in hook `command` and `args` fields are now resolved in `.claude/settings.json` — previously only `.mcp.json` and `HOOK.json` were transformed, so registered hook commands in settings.json retained unresolved patterns

## [0.0.24] - 2026-04-11

### Fixed
- `air update` now discovers cached providers by scanning `~/.air/cache/` even when providers aren't listed in `air.json` extensions — previously reported "No providers with cached data found" despite cached clones existing on disk
- `air update` no longer requires `air.json` to exist — it can refresh cached data based on the cache directory structure alone

### Added
- Known provider auto-discovery in `updateProviderCaches()` — matches cache directory scheme names (e.g., `github/`) to known provider packages
- SDK test suite for the `air update` flow covering provider discovery, cache refresh, stale clone detection, and immutable ref handling

## [0.0.23] - 2026-04-11

### Changed
- `PrepareTransform` interface now receives hook configs alongside MCP server configs via the `McpConfig.hooks` field — transforms that only operate on `mcpServers` continue to work, but the contract is broader
- `TransformContext` now includes an optional `hookPaths` field with paths to injected hook directories
- Transform runner collects `HOOK.json` files from injected hooks, passes them through the transform pipeline, and writes resolved configs back
- `@pulsemcp/air-secrets-env` resolves `${VAR}` and `${VAR:-default}` patterns in hook env fields (in addition to MCP servers)
- `@pulsemcp/air-secrets-file` resolves `${VAR}` patterns in hook env fields (in addition to MCP servers)
- Unresolved `${VAR}` validation now checks both `.mcp.json` and `HOOK.json` files after transforms run

### Added
- `findUnresolvedHookVars()` utility in the SDK for validating hook configs independently
- Documentation for secret resolution in hooks (`docs/guides/hooks.md`)

## [0.0.22] - 2026-04-11

### Fixed
- Claude adapter now registers copied hooks in `.claude/settings.json` — previously hooks were copied to `.claude/hooks/` but never registered, making them inert

## [0.0.21] - 2026-04-11

### Added
- `air update` CLI command to refresh cached provider data (e.g., stale GitHub repository clones)
- `checkFreshness()` and `refreshCache()` optional methods on the `CatalogProvider` interface for cache lifecycle management
- Staleness warnings printed to stderr when `air start` or `air prepare` detects that cached GitHub clones are behind remote
- `CacheFreshnessWarning` and `CacheRefreshResult` types exported from `@pulsemcp/air-core` and `@pulsemcp/air-sdk`
- `updateProviderCaches()` SDK function for programmatic cache refresh
- `checkProviderFreshness()` SDK helper for checking provider cache freshness against remote sources

## [0.0.20] - 2026-04-11

### Changed
- Clarified across documentation that AIR is a single-session configuration layer with no orchestration capabilities
- Added practical tips for running multiple sessions using git clones or worktrees
- Updated TUI documentation to use "types" instead of "tabs" for artifact type navigation

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
