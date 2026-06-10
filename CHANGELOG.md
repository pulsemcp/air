# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.12.1] - 2026-06-10

### Fixed
- **`@pulsemcp/air-provider-github` — catalog `git clone`/`fetch` are now bounded by a hard wall-clock timeout and retried with backoff, so a transient github.com hiccup no longer fails (or indefinitely hangs) every consumer of `air prepare`.** The provider shells out to git to materialize `github://` catalog repos. Previously those invocations went through `execFileSync` with **no bounding timeout and no retry**, which produced two production failure modes: (1) a transient TLS stall / `ETIMEDOUT` / connection reset made git exit non-zero and the whole `air prepare` failed, even though a retry seconds later would have succeeded; and (2) a half-open HTTPS connection that never sends a TCP reset made git's `fetch-pack` hang forever with no output and no recovery, wedging the session. Both modes were amplified by a post-deploy clone stampede when many sessions resolved the same catalog at once. The fix adds a new `git.ts` module with two primitives the provider now routes every git call through:
  - **`runBounded`** runs git as its own **process-group leader** (`detached: true`) and SIGKILLs the *entire group* on a wall-clock deadline (`process.kill(-pid, "SIGKILL")`, falling back to the leader). This is deliberate: git spawns helper processes (`git-remote-https`, `index-pack`) that must die too — Node's `spawnSync`/`child.kill()` timeout only signals the direct child and can leave those helpers alive and the transfer wedged. Network clone/fetch are bounded at 60s (`AIR_GIT_CLONE_TIMEOUT_MS`), local plumbing (init/remote/checkout/rev-parse) at 30s (`AIR_GIT_LOCAL_TIMEOUT_MS`).
  - **`withGitRetry`** retries transient/timeout failures with `5s/10s/20s` backoff (`AIR_GIT_CLONE_RETRY_DELAYS_MS`, up to 4 attempts by default), surfacing a clear error only after retries are exhausted. A watchdog kill (`GitTimeoutError`) is always retried; other failures are retried only when their message matches a transient signature (`ETIMEDOUT`, `ECONNRESET`, `EAI_AGAIN`, `Could not resolve host`, `Connection reset by peer`, `early EOF`, `RPC failed`, `fetch-pack: unexpected disconnect`, HTTP 5xx, TLS/SSL handshake errors, …). Deterministic failures (auth failure, missing repo/ref) raise immediately so we never pointlessly retry an error that would fail identically. Per the logging philosophy, intermediate retries log at info and only the final exhausted failure logs at warn.

  Every network git invocation also now sets `GIT_HTTP_LOW_SPEED_LIMIT=1000` / `GIT_HTTP_LOW_SPEED_TIME=60` (git aborts a transfer that drops below ~1 KB/s for 60s, so a stalled fetch fails fast with a transient error instead of crawling to the full timeout) and `GIT_TERMINAL_PROMPT=0` (a missing-credential case fails immediately instead of blocking forever on an interactive prompt) — all overridable via the corresponding env vars. Every git call across `ensureClone`, `checkFreshness`, and `refreshCache` now runs bounded by the watchdog timeout; transient-retry is applied to `ensureClone` (the incident path: each retry attempt rebuilds a clean temp dir before re-cloning, then atomically renames into place, preserving the existing temp-dir-then-rename concurrency guarantee), while `checkFreshness` (best-effort, silently swallowed) and `refreshCache` (reports per-repo failure) are bounded only. Because clone URLs embed the auth token for HTTPS, the provider wraps its logger to redact the token from any retry/diagnostic line. The provider accepts an optional injectable `logger`; the default writes diagnostics to stderr (stdout is reserved for resolved output). Resolves [#4140](https://github.com/pulsemcp/pulsemcp/issues/4140).

## [0.12.0] - 2026-06-09

### Changed
- **Root membership is now declared on artifacts via `default_in_roots`, inverting the previous root-side `default_*` model.** Previously each root entry in `roots.json` enumerated its members with `default_mcp_servers`, `default_skills`, `default_plugins`, `default_hooks`, and listed subagent roots via `default_subagent_roots`. Now every artifact (skill, reference, MCP server, hook, plugin) — and every subagent root — declares which roots it belongs to with a single `default_in_roots: ["<root-name>", ...]` field, and the special wildcard `default_in_roots: ["*"]` joins **all** roots (e.g. a personal hook that should apply everywhere without editing each root). A root becomes a default subagent of another root by listing the parent in its own `default_in_roots`; a root is never made its own subagent (even under `"*"`). This makes membership composable from the artifact side: a shared catalog can ship an artifact that opts into named (or all) roots without anyone editing the root index. The **resolved output shape is unchanged** — `resolveArtifacts` reads each artifact's `default_in_roots`, inverts it, and computes the same per-root `default_mcp_servers` / `default_skills` / `default_plugins` / `default_hooks` / `default_subagent_roots` arrays the rest of AIR (adapters, SDK, CLI, TUI) already consumes, plus a new computed `default_references` array. The authored `default_in_roots` field is stripped from resolved entries once inverted. `default_in_roots` entries are canonicalized to qualified root IDs with the same warn-and-drop semantics as every other reference (unknown or `exclude`-dropped roots warn and are skipped; ambiguous short references hard-fail). This is a **hard switch with no deprecation period**: legacy root-side `default_*` membership arrays are no longer read at all — any such field is silently ignored and unconditionally overwritten by the computed inverse. **Breaking for catalog authors** (pre-1.0, shipped as a minor): existing `roots.json` files that declare `default_*` arrays must move those declarations onto the artifacts as `default_in_roots`. Downstream consumer catalogs (e.g. `pulsemcp/pulsemcp`'s `agents/` indexes and the Agent Orchestrator Rails app) need a follow-up migration, tracked separately. See the [migration guide](docs/guides/migrating-to-default-in-roots.md) for a step-by-step walkthrough.

## [0.11.0] - 2026-06-04

### Fixed
- **`@pulsemcp/air-cowork` — `air export cowork` now carries each hook's `HOOK.json` (and its `x-config`) into the exported plugin, so config-driven hooks actually run.** Previously the emitter copied a hook's runtime scripts into `scripts/<id>/` but *dropped* its `HOOK.json`, deliberately skipping it during the copy. A hook whose runtime config loader resolves `HOOK.json` relative to its compiled entrypoint — one level up from `dist/`, i.e. `scripts/<id>/HOOK.json` in the exported layout — therefore found no config: the loader returned `null` and the hook fired at runtime but did nothing. This is what kept `agent-transcript-capture` (a `Stop`-event hook whose `x-config` declares its GCS storage backend + privacy settings) from uploading transcripts when distributed via a Co-work plugin, even though the same hook worked under `air prepare` (which already materializes the full `HOOK.json` forward). The emitter now writes each hook's `HOOK.json` into `scripts/<id>/` alongside the scripts — exactly where the hook's loader resolves it — carrying the same fully-composed `x-config` that `air prepare` materializes: the hook author's source `x-config` deep-merged with any consumer-supplied overlay declared in `air.json`. With no overlay the source file is copied byte-for-byte; with one, only `x-config` is replaced by the merged value and all other fields are preserved. Nothing is otherwise injected or stripped, so backend-specific validation rules (e.g. GCS forbidding an S3-only `no_auth.namespace_key`) are preserved by construction.

## [0.10.0] - 2026-06-02

### Fixed
- **`@pulsemcp/air-cowork` — `air export cowork` no longer silently drops hooks whose event has no Co-work mapping, and command paths in `args` are now anchored to `${CLAUDE_PLUGIN_ROOT}`.** Previously the emitter only knew five AIR events (`session_start`, `session_end`, `pre_tool_call`, `post_tool_call`, `notification`); any other event — including the common `Stop` — was *silently skipped*. The export still wrote a `plugin.json`, never wrote `hooks/hooks.json` or copied the hook script, and yet reported `hookCount: 1` and exited `0`, producing a broken/empty plugin directory that looked successful. (This is what kept `agent-transcript-capture`, a `Stop`-event hook resolved via `github://pulsemcp/ai-artifacts`, from exporting.) Three changes fix this: (1) the event map now covers AIR's full lifecycle vocabulary — `stop`/`Stop`, `subagent_stop`/`SubagentStop`, `pre_compact`/`PreCompact`, `user_prompt_submit`/`UserPromptSubmit` in addition to the originals — accepting both snake_case AIR names and PascalCase Claude/Co-work names as identity mappings, mirroring the Claude adapter; (2) any hook that cannot be fully materialized (unknown artifact, missing/malformed `HOOK.json`, unmapped event, or missing `command`) now throws, so the export fails loud with a non-zero exit instead of shipping a broken plugin, and the reported `hookCount` reflects only what was actually written; (3) interpreter-style commands whose relative script path lives in `args` (e.g. `node dist/capture.js`) now anchor that path under `${CLAUDE_PLUGIN_ROOT}/scripts/<id>/` when the file exists in the hook directory — matching the Claude adapter — so the emitted command resolves regardless of cwd.

## [0.9.0] - 2026-05-31

### Fixed
- **`@pulsemcp/air-adapter-codex` — renamed and partial `${VAR}` secret references no longer ship a broken literal to `.codex/config.toml`.** Codex's TOML has no native string interpolation, so the adapter maps AIR `${VAR}` refs onto Codex's host-env forwarding (`env_vars` / `env_http_headers`), which can only express *whole-value, same-named* refs. Previously a renamed stdio env ref (`KEY = "${OTHER}"`) or a partial one (`AUTH = "Bearer ${TOKEN}"`) fell through to the literal `env` table with a `console.warn`, so Codex injected the literal `${…}` string at runtime and the secret broke. The adapter now wraps such launches in a `sh -c` shim that rebinds the key from the forwarded source var(s) right before `exec` hands off to the real MCP binary (`command = "sh"`, `args = ["-c", "KEY=\"…\" exec <orig>"]`), forwarding the source var(s) via `env_vars`. The value is templated as a shell double-quoted string (literal runs escaped, original command/args POSIX single-quoted) so only variable *names* — never values — land in the TOML. For remote-server headers, a `${VAR}` value of any name now forwards via `env_http_headers` (renames included), and `Authorization: "Bearer ${VAR}"` maps to Codex's native `bearer_token_env_var`; only a non-Bearer *partial* header (which has no Codex expression, since remote servers have no launch process to wrap) still falls through to a literal `http_headers` entry with a warning.

### Added
- **`@pulsemcp/air-adapter-codex` — OAuth MCP servers now emit `client_id` and a callback URL into `.codex/config.toml`.** Remote (SSE / streamable-HTTP) servers previously dropped AIR's OAuth config entirely, so Codex fell back to OAuth dynamic client registration (RFC 7591), which some providers reject. The adapter now maps `oauth.clientId` to Codex's per-server `[mcp_servers.<id>.oauth]` table (`client_id = "…"`) and collects every server's `oauth.redirectUri` into the single global top-level `mcp_oauth_callback_url` (Codex has no per-server redirect URI). When servers declare distinct redirect URIs the adapter keeps the first and warns, since Codex honors only one.

## [0.8.0] - 2026-05-29

### Added
- **`@pulsemcp/air-adapter-cursor` — first-class Cursor CLI support, at parity with the Claude and Codex adapters.** A new adapter extension that translates AIR artifacts into Cursor's native config formats so `air start cursor` / `air prepare cursor` launch the Cursor CLI (`cursor-agent`) with skills, MCP servers, references, and hooks loaded. The adapter writes two JSON files: `.cursor/mcp.json` (a top-level `mcpServers` map) and `.cursor/hooks.json` (a `hooks.<event>` map with a required `version: 1`), and injects skills into `.cursor/skills/<id>/`. MCP servers map to `mcpServers.<name>` entries with transport auto-detected from the shape: stdio servers emit `command`/`args`/`env`, and remote servers emit `url`/`headers` (Cursor auto-detects `sse` vs. `streamable-http` from the URL). Secrets are handled Cursor-natively: every AIR `${VAR}` reference is rewritten to Cursor's `${env:VAR}` form, which Cursor expands from the host environment at launch *anywhere in a string*. Because interpolation isn't restricted to whole-value, same-named refs, every secret shape forwards cleanly — whole-value, renamed, and partial alike — so the adapter never warns about secrets (unlike Codex). Cursor's own built-in tokens (`${userHome}`, `${workspaceFolder}`, `${workspaceFolderBasename}`, `${pathSeparator}`) and already-`${env:…}` refs are left untouched so they are not double-wrapped. Hooks map to Cursor lifecycle events (`session_start`→`sessionStart`, `pre_tool_call`→`preToolUse`, etc.; AIR snake_case and Cursor camelCase names both accepted; unrecognized events like `notification` warn-and-skip), with command paths anchored to the repo root so they survive mid-session `cd`. The adapter participates in the per-target AIR manifest, so `air clean` removes exactly what it wrote and preserves user-authored entries. Empty configs are not persisted (and a previously-emptied `.cursor/mcp.json` / `.cursor/hooks.json` is removed). Wired into SDK adapter discovery (`@pulsemcp/air-adapter-cursor`), the `air init` default extension set, and CLI help for `air start` / `air prepare`. Verified end-to-end against the real Cursor CLI (`cursor-agent mcp list`).

## [0.7.0] - 2026-05-29

### Added
- **`@pulsemcp/air-adapter-pi` — a skills-only adapter for the [Pi coding agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent).** A new adapter extension that injects AIR skills into Pi's native project-skill location so `air start pi` / `air prepare pi` launch Pi with catalog skills loaded. Pi auto-discovers project skills from `<cwd>/.pi/skills/<id>/SKILL.md` (any directory containing a `SKILL.md` is a skill root and Pi stops recursing into it), so the adapter copies each activated skill into `.pi/skills/<id>/` and bundles its references in `<id>/references/`. Because Pi discovers skills purely from the filesystem, `prepareSession()` writes no config file and returns empty `configFiles` and `hookPaths` arrays. The adapter is deliberately **skills-only**: Pi ships with no pre-baked MCP server registry or hook lifecycle, so MCP servers, hooks, and standalone references are intentionally not translated — the non-skill categories are stubbed to satisfy the `AgentAdapter` contract (the per-target manifest records `hooks: []` and `mcpServers: []`, and `cleanSession` reports empty `removedHooks` / `removedMcpServers`). Plugins are honored only as composition sugar: a plugin's declared skills are merged into the activation set while its MCP servers and hooks are ignored. Local `.pi/skills/<id>/` directories always win over catalog versions, and the adapter participates in the per-target AIR manifest so re-running `prepare` and `air clean` reconcile cleanly, removing exactly what AIR wrote. Wired into SDK adapter discovery (`@pulsemcp/air-adapter-pi`), the `air init` default extension set, and CLI help for `air start` / `air prepare`. Verified end-to-end against Pi's own production skill-discovery code (`loadSkills`), which discovers the AIR-injected skill as a project skill with zero diagnostics.

## [0.6.0] - 2026-05-29

### Added
- **`roots.schema.json` now declares an optional `default_runtime` field on each root.** A new string property lets a root declare which agent runtime sessions and subagents spawned under it should use. When omitted, it resolves to the default runtime `"claude_code"`. The field is an **open string** with a set of suggested values surfaced via JSON Schema `examples` (`claude_code`, `codex`, `pi`, `opencode`, `amp`, `gemini`, `github_copilot`) rather than a closed `enum` — any runtime identifier a downstream consumer recognizes is accepted, so adding a new coding agent does not require a schema change. This formalizes a field that downstream consumers (notably Agent Orchestrator's `agents/agent-roots/roots.json`, which validates against the published `https://pulsemcp.github.io/air/schemas/roots.schema.json`) had begun emitting for the Codex-runtime rollout. The change is additive and backward-compatible — the field is optional and absent from every `required` array, so existing roots indexes remain valid. The schema ships in `@pulsemcp/air-core`. Docs (`docs/roots.md`, `docs/guides/roots.md`) and the `examples/roots/roots.json` example were updated to cover the field.

## [0.5.1] - 2026-05-28

### Changed
- **`@pulsemcp/air-core` no longer hard-fails resolution when an artifact references an unknown (truly-missing) artifact.** v0.4.3 made references to *excluded* artifacts warn-and-drop, but a reference to something that was never contributed at all — a typo, a not-yet-installed catalog, or an upstream rename — still threw `Reference resolution failed: … references unknown skill "create-pr". Available qualified IDs: …`, blocking resolution of the entire config. A single dangling reference (e.g. a root's `default_skills` pointing at a skill the catalog no longer ships) took down every otherwise-valid artifact. `canonicalizeReferences` in `packages/core/src/config.ts` now treats an unknown reference as a warning, drops the dangling reference from the consumer's resolved list, and continues. The warning names the consumer, the field, the missing reference, and the available qualified IDs, and ends with "Dropping the reference." Applies uniformly to every reference field in the resolver (`skill.references`, `hook.references`, `plugin.{skills,mcp_servers,hooks,plugins}`, `root.{default_skills,default_mcp_servers,default_plugins,default_hooks,default_subagent_roots}`). Ambiguous references (a short ID matching multiple scopes) still hard-fail, since those are resolvable by qualifying the reference rather than by dropping it.

## [0.5.0] - 2026-05-21

### Added
- **`@pulsemcp/air-adapter-codex` — first-class OpenAI Codex CLI support, at parity with the Claude adapter.** A new adapter extension that translates AIR artifacts into Codex's native config formats so `air start codex` / `air prepare codex` launch the Codex CLI with skills, MCP servers, references, and hooks loaded. The adapter writes a single `.codex/config.toml` (TOML, via `smol-toml`) and injects skills into `.agents/skills/<id>/`. MCP servers map to `[mcp_servers.<name>]` tables with transport auto-detected from the shape: stdio servers emit `command`/`args` plus secret forwarding (whole-value, same-named `${VAR}` values become Codex-native `env_vars` host-env injection; literal values go in an `env` table), and remote servers emit `url` with literal headers in `http_headers` and whole-value `${VAR}` headers forwarded via `env_http_headers`. Refs that can't be forwarded natively (renamed `KEY = "${OTHER}"` or partial `"Bearer ${TOKEN}"`) fall through to the literal table and emit a `console.warn`, since Codex's TOML never passes through AIR's `${VAR}` transform pipeline. Hooks map to `[[hooks.<Event>]]` matcher groups (AIR snake_case event names and Codex PascalCase names both accepted; unrecognized events warn-and-skip), with command paths anchored to the repo root so they survive mid-session `cd`. The adapter participates in the per-target AIR manifest, so `air clean` removes exactly what it wrote and preserves user-authored entries. Empty configs are not persisted (and a previously-emptied `.codex/config.toml` is removed). Wired into SDK adapter discovery (`@pulsemcp/air-adapter-codex`), the `air init` default extension set, and CLI help for `air start` / `air prepare`. Verified end-to-end against the real Codex CLI (`codex mcp list`, `codex doctor`).

## [0.4.4] - 2026-05-19

### Fixed
- **`@pulsemcp/air-adapter-claude` logs a warning when a registered hook or skill's source directory does not exist on disk, instead of silently skipping it.** Previously, `prepareSession` materialized the hook/skill loops with `if (!existsSync(sourceDir)) continue;` — a registered artifact whose catalog-declared `path` resolved to a non-existent directory was silently dropped from the result. For hooks this was particularly painful: the dropped hook never appeared in `hookPaths` or `hookActivations`, so `.claude/settings.json` was rewritten with no registration for it and the agent booted with the hook missing — no warning, no error, no breadcrumb in any log. The exact failure mode hid a `transcript-capture` Stop hook that produced zero S3 transcripts across an entire fleet of agent sessions, and tracking the cause down required multiple investigation sessions. Both the hook path (`claude-adapter.ts:307`) and the equivalent skill path (`claude-adapter.ts:281`) now emit a `console.warn` naming the artifact type, the qualified ID (which encodes the declaring catalog's scope), and the unreachable path, with a pointer back to the catalog index file or `air.json#exclude`. The artifact is skipped but the session continues so a single misconfigured catalog entry no longer blocks an otherwise-valid session — matching the existing precedent at `reconcileSettingsHooks` (warn-and-skip on unrecognized hook events). The skipped artifact is also omitted from the per-target manifest so the next run does not claim ownership of something AIR never wrote. Resolves [#3724](https://github.com/pulsemcp/pulsemcp/issues/3724).

## [0.4.3] - 2026-05-17

### Changed
- **`@pulsemcp/air-core` no longer hard-fails resolution when a surviving artifact references an excluded one.** Previously, if `air.json#exclude` dropped an artifact that was still referenced from another artifact's body (a plugin's `mcp_servers`, a root's `default_mcp_servers`, a skill's `references`, etc.), `resolveArtifacts` threw with `Reference resolution failed: … which is removed by air.json#exclude … Drop the exclude entry or also remove every artifact that references it.` That made `exclude` impractical against catalogs whose plugins and default-loaded roots reference one another — adding a single exclude could fan out into rewriting every consumer. The resolver now emits a warning naming the consumer and the dropped reference, drops the reference from the consumer's resolved list, and continues. Downstream behavior follows: a root's `default_mcp_servers` simply omits the excluded server, so adapters like `@pulsemcp/air-adapter-claude` no longer write it into `.mcp.json`. Truly-missing references (not matched by any `exclude` entry of the same type) still hard-fail with the existing unknown-reference error.

## [0.4.2] - 2026-05-16

### Fixed
- **`@pulsemcp/air-adapter-claude` anchors hook command paths with `$CLAUDE_PROJECT_DIR` so hooks survive mid-session `cd` calls.** v0.4.1 rewrote hook-relative `args` and `./`-prefixed `command` paths to project-root form (e.g. `.claude/hooks/<id>/dist/capture.js`), which works only as long as the agent's current working directory at hook-firing time is still the project root. Once the agent `cd`s into a subdirectory (e.g. `.agent-containers/`), Claude Code invokes the hook with that cwd and Node errors out with `MODULE_NOT_FOUND` because the cwd-relative path now points one level too deep. The adapter now wraps rewritten paths as `"$CLAUDE_PROJECT_DIR/.claude/hooks/<id>/<file>"` — Claude Code sets `CLAUDE_PROJECT_DIR` in the hook environment, the double quotes keep paths with spaces safe, and the env var expands at invocation time so the absolute path is correct regardless of cwd. Applies uniformly to every Claude lifecycle event AIR emits (`SessionStart`, `Stop`, `PreToolUse`, etc.). Bare command names (`node`, `lint-staged`), flags, absolute paths, and home-relative paths still pass through unchanged.

## [0.4.1] - 2026-05-15

### Fixed
- **`@pulsemcp/air-adapter-claude` no longer silently drops hooks targeting Claude lifecycle events outside the original 5-event map.** The `AIR_TO_CLAUDE_EVENT` table was missing `Stop`, `SubagentStop`, `PreCompact`, and `UserPromptSubmit`, so any `HOOK.json` declaring one of those events was materialized into `.claude/hooks/<id>/` but never registered in `.claude/settings.json` — the hook would never fire. The table now covers all 9 Claude lifecycle events (`SessionStart`, `SessionEnd`, `PreToolUse`, `PostToolUse`, `Notification`, `Stop`, `SubagentStop`, `PreCompact`, `UserPromptSubmit`) via both snake_case AIR names and PascalCase Claude names (identity mappings), so hook authors targeting Claude can write either form in `HOOK.json`'s `event` field. Resolves [#129](https://github.com/pulsemcp/air/issues/129).
- **`@pulsemcp/air-adapter-claude` warns instead of silently skipping when `HOOK.json` declares an unrecognized event.** Previously `reconcileSettingsHooks` would silently `continue` past any unmapped `event` value, leaving callers (and downstream users) with `{"hooks": {}}` and no indication that anything went wrong. The adapter now logs a `warn`-level message naming the hook id, the unrecognized event, and the list of supported events. `pre_commit` and `post_commit` still have no Claude Code equivalent and continue to be skipped — they now warn loudly rather than silently.
- **`@pulsemcp/air-adapter-claude` rewrites hook-relative `args` paths to project-root form when materializing into `.claude/settings.json`.** Claude Code invokes hook commands from the project root, but hook authors naturally write paths relative to their own hook directory. Previously, only `command` strings starting with `./` were rewritten; `args` entries like `"dist/capture.js"` were left as-is, causing `node dist/capture.js` to fail at runtime because the project-root cwd has no `dist/capture.js`. The adapter now rewrites each `args` entry that looks like a path (contains a `/` or starts with `./`) **and** points at a real file inside the hook directory — bare command names like `lint-staged` and flags like `--quiet` pass through unchanged. The materialized command for the issue's example now becomes `node .claude/hooks/<hook-id>/dist/capture.js`.

## [0.4.0] - 2026-05-14

### Added
- **`x-config` overlay on hook index entries.** `hooks.json` entries can now carry an optional `x-config` object that AIR deep-merges into the materialized `HOOK.json`'s own `x-config` at resolve time. Consumer values win on conflicts; objects merge recursively, arrays replace wholesale, and scalars replace. The merged value flows through `air resolve --json`, gets written into the materialized `HOOK.json` during `air prepare` / `air start`, and runs through the existing transform pipeline (so `${VAR}` interpolation via `@pulsemcp/air-secrets-env` / `-secrets-file` works inside `x-config` values too). The shape is intentionally permissive (`additionalProperties: true` in the schema) — hook authors define and document their own `x-config` schema. New core export `mergeXConfig(base, overlay)` for consumers who want the same deep-merge semantics. Resolves [#127](https://github.com/pulsemcp/air/issues/127).
- **`github://` scheme on the hook `path` field.** A `hooks.json` entry's `path` can now point at a remote hook directory living in another GitHub repo, e.g. `"path": "github://acme/air-org@v1.2.0/hooks/notify-session-start"`. The same `@pulsemcp/air-provider-github` extension that resolves `catalogs` and per-type index URIs handles this lookup; the same `AIR_GITHUB_TOKEN` and `gitProtocol` settings apply. Refs that look like a 40-character SHA are treated as immutable and content-addressed in the cache (`~/.air/cache/github/{owner}/{repo}/{ref}/`); branch and tag refs are mutable and refresh on `air update`. Path-style URIs work for every artifact type with a `path` field, not only hooks (skills can use this too). Resolves [#127](https://github.com/pulsemcp/air/issues/127).

### Changed
- **`@pulsemcp/air-provider-github` now supports SHA-pinned refs.** Previously, the provider always shelled out to `git clone --depth 1 --branch <ref>`, which fails for full 40-character SHAs (Git refuses `--branch <SHA>`). The provider now detects immutable refs and switches to `git init` + `git remote add origin` + `git fetch --depth 1 origin <sha>` + `git checkout FETCH_HEAD`, which works for any ref shape that the remote will resolve. Branch and tag refs continue to use the existing `git clone --branch` path.

## [0.3.0] - 2026-04-28

### Added
- **`air clean [adapter]` command** for explicit teardown of AIR-managed artifacts in a target directory. Reads the prior-run manifest at `~/.air/manifests/<sha>.json` and asks the adapter to remove every tracked skill directory (`.claude/skills/<id>/`), hook directory (`.claude/hooks/<id>/`), AIR-written entries in `.claude/settings.json` (identified by the `_airHookId` marker), and AIR-managed MCP server keys in `.mcp.json`. User-authored entries are preserved — keys AIR did not write to `.mcp.json` and hook entries without the `_airHookId` marker pass through untouched. If `.mcp.json` would be left empty after the prune, the file is deleted entirely. The manifest itself is deleted on a full clean; partial cleans (any `--keep-*` flag set) rewrite the manifest with the kept entries preserved so future `prepare`/`clean` cycles still track them. Items listed in the manifest that no longer exist on disk are silently skipped (handles drift where files were removed manually). Supports `--target <dir>`, `--dry-run`, `--keep-skills`, `--keep-hooks`, `--keep-mcp`, and `--config <path>`. Resolves [#121](https://github.com/pulsemcp/air/issues/121).
- **The adapter argument to `air clean` is optional.** AIR records the writing adapter's name (`AgentAdapter.name`, e.g. `"claude"`) in the manifest during `prepare` / `start`. `air clean` reads that field to decide which adapter to use, so users no longer have to retype it (`air clean` instead of `air clean claude`). Pass an explicit adapter only to override the inferred value or to clean a manifest written by an older AIR version that predates the recorded-adapter field.
- **Optional `cleanSession?(targetDir, options)` method on the `AgentAdapter` interface.** Existing adapters that don't implement it raise a clear "does not support clean" error from the SDK; the Claude adapter (`@pulsemcp/air-adapter-claude`) implements it. Adding a new optional method is non-breaking for third-party adapters compiled against the prior `AgentAdapter` interface.
- **New SDK exports** (re-exported from both `@pulsemcp/air-core` and `@pulsemcp/air-sdk` where appropriate): `cleanSession()`, `CleanSessionOptions` (SDK-flavored shape with optional `adapter` and `config`), `CleanSessionSdkResult`, `CoreCleanSessionOptions` (the adapter-facing shape), `CleanSessionResult`, and `deleteManifest()`.
- **Optional `adapter` field on the on-disk manifest** (`Manifest.adapter`). Adapters that persist the manifest via `buildManifest({ adapter, ... })` get the field written automatically. The field is back-compat: manifests written by older AIR versions still load (with `adapter: undefined`), they just can't drive the new `air clean` inference path.

### Fixed
- **`.claude/settings.json` is no longer rewritten when its content is unparseable.** During cleanup the previous behavior would silently substitute `{}` for a corrupt-or-truncated settings file and overwrite, clobbering user-authored top-level keys (`permissions`, `env`, `model`, …). The clean path now leaves the file byte-for-byte intact when it can't be parsed and reports `settingsPath: null` so callers can see we declined to act.
- **Corrupt manifests no longer make `air clean` silently no-op.** Previously a manifest that failed JSON validation was treated as "no manifest" and the file was left on disk; the result reported `manifestExisted: false` even though a file was sitting there. Now the result honestly reports `manifestExisted: true`, and a full clean removes the corrupt manifest itself (under any `--keep-*` flag the corrupt manifest is preserved so the user can recover it).

## [0.2.2] - 2026-04-29

### Changed
- **README demo videos now play inline.** Replaced the poster-image-links-to-MP4 markup with `<video controls>` tags pointing at GitHub user-attachments URLs, which are the only video-hosting origin allowed by GitHub's README CSP. Previously, clicking a poster opened the GitHub blob viewer for the MP4 — which only offers "Download / View raw" buttons, not an inline player. Removed the now-unused `assets/{with,without}-air.{mp4,jpg}` files from the repo since the videos are hosted on GitHub's user-attachments CDN. No code, schema, or CLI behavior changed.

## [0.2.1] - 2026-04-28

### Changed
- **README repositioning.** The top of the README now opens with a one-paragraph pitch, a side-by-side "Without AIR vs. with AIR" video comparison (linked from `assets/`), a "What's a catalog?" section that walks readers through `examples/`, and a "How does it drop into your workflow?" section showing `~/.air/air.json` plus `air start claude`. The intent is that the first three sections above the fold answer "what is a catalog?" and "how does this drop into my workflow?" before the reader hits the deeper concept material. No code, schema, or CLI behavior changed.

## [0.2.0] - 2026-04-26

### Breaking
- **`air.json#exclude` is now a per-type object with wildcard support.** The previous flat-array shape (`exclude: ["@scope/id"]`) is no longer accepted — resolution hard-fails with a migration error. The new shape is an object keyed by artifact type: `exclude: { skills: [...], references: [...], mcp: [...], plugins: [...], roots: [...], hooks: [...] }`. Each value is a list of qualified-ID patterns where `*` matches one full segment (no boundary spanning). This makes exclusion type-safe — excluding a skill named `github` no longer drops an MCP server with the same shortname — and lets callers drop whole groups (e.g. `@vendor/legacy/*`) without enumerating every entry. Each pattern is matched against its declared type only, and entries that match nothing are surfaced as per-type/per-pattern warnings so typos are easy to catch. **Migration:** replace `"exclude": ["@a/x"]` with `"exclude": { "<type>": ["@a/x"] }`, where `<type>` is the artifact kind that `@a/x` was meant to drop. The schema (`schemas/air.schema.json`) and all docs have been updated. Resolves [#118](https://github.com/pulsemcp/air/issues/118).

## [0.1.1] - 2026-04-25

### Added
- **`air resolve --no-scope` flag** for emitting shortname-keyed output. Pass `--no-scope` to rewrite both top-level keys (`@local/github` → `github`) and reference fields inside entries (`default_skills`, `default_mcp_servers`, `skills.references`, `plugins.{skills,mcp_servers,hooks,plugins}`, `hooks.references`) to bare shortnames. The flag is opt-in and **hard-fails** when a shortname is contributed by more than one scope within the same artifact category — the error lists every colliding qualified ID so you can pick which one to drop via `air.json#exclude`. Useful for single-scope universes (local-only, internal-only, or single private catalog) and for downstream consumers that were built around bare shortnames before 0.1.0. The default qualified output is unchanged. New exports: `stripScopes` and `ShortnameCollisionError` from both `@pulsemcp/air-core` and `@pulsemcp/air-sdk`. Resolves [#116](https://github.com/pulsemcp/air/issues/116).

## [0.1.0] - 2026-04-25

### Added
- **Canonical AIR design document** at [`docs/design.md`](docs/design.md). Single consolidated file covering the five user scenarios AIR's defaults are designed for (solo developer, single team with a centralized catalog, multiple teams with per-team catalogs layered onto a global catalog, vendor / customer composition, OSS catalogs) — each with a concrete `air.json` snippet — and the design decisions behind composition rules, override semantics, scope identity, and extension architecture. Decisions are split into AIR core (atomic artifacts with no deep merge, always-scoped artifact identity, exclude-only composition, schemas at the repo root, async-only `resolveArtifacts`, the four extension interfaces) and AIR CLI (`air init` top-up mode, deprecated plural flags hard-error, manifest tracking, catalog auto-discovery up to 3 levels deep). Linked from `README.md` and `docs/guides/README.md`. Closes [#113](https://github.com/pulsemcp/air/issues/113).

### Breaking
- **Always-scoped artifact identity and exclude-only composition.** Every artifact (skills, references, MCP servers, plugins, roots, hooks) now has a qualified identity of the form `@scope/id`. Local indexes contribute under `@local/`; remote catalogs contribute under their provider-derived scope (for `github://owner/repo`, that is `@<owner>/<repo>/`). Composition is additive — disjoint qualified IDs union, **duplicate qualified IDs hard-fail**, and cross-scope shortname collisions warn but keep both. There is no more "later-wins" override. The new `air.json#exclude` field is the only way to drop an artifact contributed by an upstream catalog; it takes a list of qualified IDs (bare shortnames are rejected). References inside skill, hook, plugin, and root entries accept short, qualified, or intra-catalog forms and are canonicalized to qualified IDs at composition time so adapters and consumers do not need to re-resolve them. `CatalogProvider` gains an optional `getScope(uri) => string` hook that providers implement to declare the scope under which their indexes are emitted; the GitHub provider returns `<owner>/<repo>` derived from the URI. The `ResolvedArtifacts` shape changes — keys are now qualified IDs (`@scope/id`) rather than bare shortnames — which is a breaking change for any consumer reading the structure directly. Resolves [#110](https://github.com/pulsemcp/air/issues/110).

### Changed
- **`mergeArtifacts(base, overlay)` is now an additive union.** Duplicate qualified IDs across base and overlay throw an error — to drop one source, use `air.json#exclude` at the composition level. The old later-wins semantics are removed.
- **`resolveCategoryOverride` canonicalizes user inputs.** When `--add-skill <id>` / `--without-skill <id>` (and the equivalents for mcp, hooks, plugins) are passed shortnames, they are resolved against the merged artifact pool so they match the qualified IDs already in `default_*` lists.
- **Documentation rewritten.** `docs/guides/composition-and-overrides.md` is a full rewrite reflecting the scoped-identity model. `docs/configuration.md`, `docs/concepts.md`, `docs/guides/understanding-air-json.md`, `docs/guides/references.md`, `docs/references.md`, `docs/cli.md`, `docs/guides/quickstart.md`, `docs/guides/README.md`, the root `README.md`, and the package READMEs / AGENTS docs have all been updated to remove "later-wins" / "override by ID" / "deep merge" language.

## [0.0.42] - 2026-04-24

### Changed
- **Loosened catalog introspection.** `catalogs[]` entries in `air.json` now discover AIR artifact indexes anywhere within 3 directory levels of the catalog root, rather than requiring the rigid `<type>/<type>.json` layout. Files are identified by filename (`skills.json`, `roots.json`, `mcp.json`, `references.json`, `plugins.json`, `hooks.json`, or any filename containing those tokens) or by their `$schema`. `.gitignore` at the catalog root is honored; `node_modules`, `.git`, `dist`, `build`, `coverage`, `.next`, `.turbo`, `target`, `vendor`, and hidden directories are skipped. Within a single catalog, duplicate-type indexes merge in sorted relative-path order with later-wins by ID. This unblocks catalogs like `pulsemcp/pulsemcp` that organize indexes under `agents/agent-roots/roots.json` and `agents/mcp-servers/mcp.json`. Fixes [#108](https://github.com/pulsemcp/air/issues/108).
- **`parseGitHubUri` accepts whole-repo URIs.** `github://owner/repo` and `github://owner/repo@ref` are now valid catalog URIs — not just paths with subdirectories — so you can point `catalogs[]` at the repo root.

### Fixed
- **`detectSchemaFromValue` no longer false-matches schema filenames that appear mid-URL.** Previously an unbounded substring check could classify a third-party JSON whose `$schema` URL happened to contain e.g. `"mcp.schema.json"` as an AIR MCP index. The function now matches the last path segment only (ignoring query strings and fragments).

### Breaking
- **`CatalogProvider.fileExists` removed; `resolveCatalogDir(uri) => Promise<string>` added in its place.** Remote catalog providers now return a local directory that AIR walks to discover indexes. Third-party providers must implement the new method. `@pulsemcp/air-provider-github` has been updated — it clones the repo and returns the resolved subdirectory path.

## [0.0.41] - 2026-04-24

### Added
- `air start` and `air prepare` now auto-discover AIR index files (`skills.json`, `mcp.json`, nested `air.json`, full `<type>/<type>.json` catalog layouts) in the target repo and offer a single interactive `[Y/n/d=don't ask again]` prompt to register them with your `~/.air/air.json`. On accept, catalog directories go into `catalogs[]` and loose indexes into the matching per-type array. Missing `air.json` is scaffolded with a minimal structure. The prompt is TTY-only — CI, piped invocations, `--dry-run`, `--skip-confirmation`, and any scripted artifact-selection flag all silently skip discovery.
- New `--no-discover` flag on `air start` and `air prepare` to suppress the auto-discovery prompt even in a TTY.
- New `~/.air/preferences.json` file (and accompanying `schemas/preferences.schema.json`) that records dismissals from the auto-discovery prompt so AIR doesn't re-offer the same paths in the same repo. Load/save helpers exported from `@pulsemcp/air-sdk` as `loadPreferences`, `savePreferences`, `addDismissed`, `isDismissed`.
- New SDK exports: `discoverIndexes`, `resolveAnchor`, `addDiscoveredToAirJson`, `buildRegisteredChecker`, `findOfferableIndexes`, `acceptOffers`, `dismissOffers` and the corresponding types for programmatic integrations that want to drive the discovery flow themselves.
- New docs guide: [Managing Skills in Your Repo](docs/guides/managing-skills-in-your-repo.md) covering the three repo patterns (`.claude/skills/`, in-repo indexes, catalog directories) and the auto-discovery flow end-to-end.
- New optional `authServerMetadataUrl` field on the `mcp.json` `OAuthConfiguration` schema (RFC 8414 / OpenID Connect discovery). Use for servers whose MCP endpoint does not advertise OAuth metadata but whose upstream auth server does (e.g. servers delegating to Google). `ClaudeAdapter` and `CoworkEmitter` pass the value through unchanged — Claude Code reads it inline from `.mcp.json`.
- New optional `clientSecret` field on the `mcp.json` `OAuthConfiguration` schema for confidential OAuth clients. Intended to be sourced via `${ENV_VAR}` interpolation (resolved by `@pulsemcp/air-secrets-env` before `.mcp.json` is written) so the raw value is never checked into the repo. `ClaudeAdapter` and `CoworkEmitter` write the resolved value into `.mcp.json` alongside the other oauth fields.
- New `manifest` module in `@pulsemcp/air-core` that tracks AIR-managed artifact IDs (skills, hooks, MCP servers) per target directory. Persisted at `<airHome>/manifests/<sha256(targetDir)>.json` (default `airHome` is `~/.air`, overridable via `AIR_HOME` for sandboxed tests). Exports `MANIFEST_VERSION`, `buildManifest`, `loadManifest`, `writeManifest`, `diffManifest`, `getManifestPath`, `getDefaultAirHome`, and the `Manifest` / `ManifestSelection` / `ManifestDiff` types. Re-exported from `@pulsemcp/air-sdk`.

### Fixed
- **`@pulsemcp/air-adapter-claude`: `prepareSession` now cleans up stale artifacts between runs.** On every run, the adapter diffs the prior manifest against the new selection and removes artifacts that were previously AIR-written but are no longer selected — `.claude/skills/<id>/`, `.claude/hooks/<id>/`, and the corresponding entry in `.mcp.json`. User-authored entries in `.mcp.json` and user-authored settings hooks are preserved. Previously, selecting a smaller set on a re-run left orphaned artifacts behind.
- **`@pulsemcp/air-adapter-claude`: `.mcp.json` is now merged instead of overwritten.** User-added `mcpServers` keys are preserved across runs; only AIR-managed keys are replaced or removed.
- **`@pulsemcp/air-adapter-claude`: settings.json hook registrations no longer accumulate duplicates.** Each AIR-written hook entry carries an `_airHookId` marker that identifies ownership, so re-runs prune and re-register cleanly without touching user-authored hook entries.

## [0.0.40] - 2026-04-24

### Fixed
- `GitHubCatalogProvider.ensureClone()` in `@pulsemcp/air-provider-github` no longer races when multiple processes hit an empty cache at the same time. Previously, two callers could race on a fresh cache, one would see `.git/` exist while the working-tree checkout was still in flight, and fail with `File not found in cloned repository: …`. This surfaced as ~5–15 sessions failing per deploy in environments that restart in-flight sessions against an empty cache. Fixes [#101](https://github.com/pulsemcp/air/issues/101).
  - Concurrent clones into the same `~/.air/cache/github/{owner}/{repo}/{ref}` path are now serialized by an advisory file lock (`proper-lockfile`).
  - Each clone lands atomically via a same-directory `renameSync` from a sibling temp directory (created with `mkdtempSync`) — so readers either see no `.git` (and acquire the lock themselves) or a complete working tree, never a partial one.
  - A partial `cloneDir` left behind by a crashed older-version process is cleaned up inside the lock before re-cloning.
  - `resolve()` and `fileExists()` signatures are unchanged; the private `ensureClone()` is now `async` (both internal callers already `await` it).
  - New dependency: `proper-lockfile@^4.1.2`.

## [0.0.39] - 2026-04-24

### Changed
- **Breaking:** `air start` and `air prepare` now exit with code 1 and print a migration error when invoked with the deprecated plural artifact-selection flags (`--plugins`, `--skills`, `--mcp-servers`, `--hooks`, `--without-plugins`, `--without-skills`, `--without-mcp-servers`, `--without-hooks`) that were renamed to their singular variadic forms in v0.0.32. Previously these flags were silently dropped after a stderr warning, which let orchestrators believe the call succeeded while writing a `.mcp.json` missing the requested artifacts. Callers must migrate to the singular flag names — e.g., `--plugin a b` or `--plugin a --plugin b` instead of `--plugins a,b`. See [#95](https://github.com/pulsemcp/air/issues/95).

## [0.0.38] - 2026-04-24

### Added
- `air init` is now idempotent: re-running it on an existing `~/.air/` no longer errors. When `air.json` already exists, the command runs in **top-up mode** — your `air.json` is left untouched, and only missing scaffold pieces (index files, `README.md`) are created. This gives users who initialized on an older version a clean upgrade path to fill in newer scaffold files without losing their configuration. Pass `--force` to regenerate `air.json` from scratch.
- New `topUp` option on the SDK's `initConfig` function for invoking this behavior programmatically.
- New `mode: "topup"` variant on `SmartInitResult`'s discriminated union so CLI consumers can tell top-up from fresh blank init.

## [0.0.37] - 2026-04-24

### Added
- New `air resolve --json` CLI command that loads the active `air.json` (respecting `AIR_CONFIG`), runs configured catalog providers, and prints the full merged `ResolvedArtifacts` tree to stdout as JSON. Enables non-Node consumers (Ruby apps, dashboards, orchestrators) to inspect the resolved artifact tree without reimplementing resolution, providers, or `catalogs` / `gitProtocol` handling.
- New `resolveFullArtifacts()` helper in `@pulsemcp/air-sdk` that wires provider loading to `resolveArtifacts()`. Used internally by `air resolve --json`; also the programmatic entry point for the same behavior.

## [0.0.36] - 2026-04-24

### Added
- New optional `listLocalArtifacts(targetDir)` method on the `AgentAdapter` interface. Adapters that implement it can surface filesystem-discovered artifacts that live outside AIR's control (e.g. skills committed under `.claude/skills/`). Core exposes corresponding `LocalArtifacts` and `LocalSkillEntry` types.
- `@pulsemcp/air-adapter-claude` now implements `listLocalArtifacts` by scanning the target directory's `.claude/skills/` tree and parsing each `SKILL.md`'s YAML frontmatter for a description.
- `startSession()` in `@pulsemcp/air-sdk` now returns the discovered `localArtifacts` when the adapter supports scanning. A new `localScanDir` option controls the scan directory (defaults to `process.cwd()`, pass `null` to disable).
- `air start` TUI now shows local skills (those committed under `.claude/skills/`) as read-only entries marked with a 🔒 icon. They are always active and cannot be toggled off — space, `a`, `n`, and `o` skip read-only items. A footer hint explains how to disable one (remove the directory in the repo). When a local skill's ID collides with a catalog skill, the catalog entry is replaced by the read-only local entry in the TUI.

## [0.0.35] - 2026-04-23

### Added
- New `gitProtocol` field on `air.json` (enum `"ssh"` | `"https"`) — selects the protocol used by git-based catalog providers when cloning remote repositories.
- New `--git-protocol <ssh|https>` CLI flag on `air start`, `air prepare`, and `air update`. Takes precedence over the `gitProtocol` field in `air.json`.
- New `AIR_GIT_PROTOCOL` environment variable recognized by `GitHubCatalogProvider`. Acts as a lower-precedence fallback (below explicit constructor options and `configure()` calls).
- New optional `configure(options)` method on the `CatalogProvider` interface. Core calls it from `resolveArtifacts` after merging air.json-level fields with caller-supplied `providerOptions`, giving providers a single place to receive runtime configuration. Unknown keys are ignored.
- New `configureProviders(providers, airConfig, providerOptions?)` helper exported from `@pulsemcp/air-core` for callers that run provider operations outside of `resolveArtifacts` (e.g., the SDK's `updateProviderCaches`).
- New `gitProtocol` option on `prepareSession`, `startSession`, and `updateProviderCaches` in `@pulsemcp/air-sdk` — all three route the value through `configureProviders` so every provider in play sees the same protocol.

### Changed
- **Breaking:** `GitHubCatalogProvider` now defaults to **SSH** for `git clone` URLs (`git@github.com:owner/repo.git`). Previous releases always used HTTPS. SSH avoids credential prompts in interactive environments where engineers already have keys registered with GitHub, but it will fail in environments without SSH keys on the PATH (public CI runners, corporate networks blocking port 22). To restore the old behavior, add `"gitProtocol": "https"` to `air.json`, export `AIR_GIT_PROTOCOL=https`, or pass `--git-protocol=https` on the affected CLI commands. Token-based auth over HTTPS (via `AIR_GITHUB_TOKEN`) continues to work unchanged when `gitProtocol` is `"https"`; tokens are ignored when `gitProtocol` is `"ssh"`.
- `GitHubCatalogProvider` clone-failure messages now include a protocol-aware hint — SSH auth failures suggest registering a key or switching to HTTPS; HTTPS failures suggest setting `AIR_GITHUB_TOKEN`.

## [0.0.34] - 2026-04-21

### Added
- New `catalogs` field on `air.json` — each entry references a whole catalog (directory or provider URI) that follows the standard `<type>/<type>.json` layout, and AIR expands it into all six artifact arrays at resolution time. Makes the common "org catalog + local catalog" setup a two-line config instead of six separate arrays. Missing files inside a catalog are silently skipped, so catalogs can ship only the artifact types they need. Catalogs and the per-type arrays compose: catalogs expand first, per-type arrays layer on top.
- Optional `fileExists(uri)` method on `CatalogProvider` — used during catalog expansion to skip conventional paths a given catalog doesn't provide. Providers without this method fall back to try/catch around `resolve()`.
- `GitHubCatalogProvider` now implements `fileExists(uri)` so catalog expansion surfaces real clone failures (network, auth, missing repo) while still silently skipping artifact files that simply don't exist in a given catalog.

### Changed
- The `air init` scaffolded `README.md` now documents the `catalogs` field as the simplest way to layer on top of the local workspace, alongside the existing per-type array pattern.
- Documentation updates: `README.md`, `docs/configuration.md`, `docs/guides/understanding-air-json.md`, and `docs/guides/composition-and-overrides.md` all cover the new `catalogs` field alongside the existing per-type arrays.

## [0.0.33] - 2026-04-21

### Changed
- `air init` now always scaffolds a ready-to-edit local workspace at `~/.air/` — six `$schema`-referenced index files (one per artifact type) plus a `README.md` with worked examples — regardless of whether a git repo and GitHub catalog are discovered. When a repo catalog *is* discovered, the generated `air.json` lists each type's `github://` URI followed by the local index path (`./<type>/<type>.json`), so local entries override the shared catalog by ID without the user having to edit `air.json` first. `InitFromRepoResult` gains a `scaffolded` field describing the local files created alongside the remote catalog, and `initConfig` continues to return `scaffolded` for the blank branch. A new `scaffoldLocalFiles(airDir)` helper in `@pulsemcp/air-sdk` is shared between blank and repo modes.

## [0.0.32] - 2026-04-18

### Changed
- **Breaking:** CLI artifact selection flags on `air start` / `air prepare` are now singular with variadic cardinality: `--skill`, `--mcp-server`, `--hook`, `--plugin` (and their `--without-*` counterparts). Pass multiple IDs by repeating the flag (`--skill a --skill b`) or listing them after a single flag (`--skill a b`) — the previous comma-separated plural syntax (`--skills a,b`) is no longer supported. The singular naming is clearer and avoids ambiguity with acronyms (e.g., `--mcp-server` vs. `--mcp-servers`), and matches Commander's own conventions for variadic options.
- **Breaking:** `air export cowork --plugins <ids>` is renamed to `--plugin <id...>` for parity — same variadic shape (`--plugin a b` or `--plugin a --plugin b`). The old comma-separated form is no longer accepted; Commander errors out with `unknown option '--plugins'`.
- `air start` and `air prepare` now print a one-line stderr warning when they see any of the old plural flag names in argv (before the `--` passthrough boundary) so scripts upgrading from 0.0.30/0.0.31 get a clear hint instead of a silent drop.

## [0.0.31] - 2026-04-17

### Changed
- Documentation: clarify that `~/.air/air.json` is the single composition surface — purely local artifact directories, remote catalogs, and any mix are all first-class shapes. README's Composition & Layering section now shows local-only, local-catalog + remote-catalog, and stacked-remote examples. `docs/guides/composition-and-overrides.md` gains local-only and local-team-catalog layering patterns. `docs/guides/understanding-air-json.md` explicitly frames `air.json` as the composition point.
- `air init` blank-mode output now explains that each artifact field accepts an array of local and/or remote index paths, includes an inline example, and links to the composition-and-overrides guide.

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
