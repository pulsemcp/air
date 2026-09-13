# AIR — Agent Infrastructure Repository

An open-source framework for organizing and sharing AI agent configuration. AIR defines a file-based, git-native config layer with a thin core and pluggable extensions for agent adapters and catalog providers.

## Folder Hierarchy

```
air/
├── schemas/                          # JSON Schema files (Draft 7) for all artifact types
├── examples/                         # Example air.json and artifact indexes
├── docs/                             # Documentation — concepts, CLI, orchestration, per-artifact guides
├── packages/
│   ├── core/                         # @pulsemcp/air-core — config resolution, validation, extension interfaces
│   ├── sdk/                          # @pulsemcp/air-sdk — programmatic API (adapter discovery, root detection, high-level operations)
│   ├── cli/                          # @pulsemcp/air-cli — CLI commands (validate, list, init, start, prepare)
│   └── extensions/
│       ├── adapter-claude/           # @pulsemcp/air-adapter-claude — Claude Code session setup
│       ├── adapter-codex/            # @pulsemcp/air-adapter-codex — OpenAI Codex CLI session setup
│       ├── adapter-cursor/           # @pulsemcp/air-adapter-cursor — Cursor CLI session setup
│       ├── adapter-pi/               # @pulsemcp/air-adapter-pi — Pi coding agent session setup (skills-only)
│       ├── cowork/                   # @pulsemcp/air-cowork — Claude Co-work plugin emitter
│       └── provider-github/          # @pulsemcp/air-provider-github — github:// URI resolution
├── package.json                      # npm workspaces root
├── tsconfig.base.json                # Shared TypeScript config
└── vitest.workspace.ts               # Workspace-level test runner
```

## Domain Context

AIR is a TypeScript monorepo (npm workspaces, ESM-only, Node 18+). It has six packages:

- **Core** owns config resolution (`resolveArtifacts`), JSON Schema validation, and the extension interfaces (`AgentAdapter`, `CatalogProvider`, `PrepareTransform`, `PluginEmitter`). No agent-specific code.
- **SDK** is the programmatic API layer. It re-exports core and adds adapter discovery, root detection, and high-level operations (`validateFile`, `initConfig`, `listArtifacts`, `startSession`, `prepareSession`, `exportMarketplace`). This is the primary dependency for TypeScript/JavaScript consumers.
- **CLI** is a thin wrapper (Commander.js) that delegates all business logic to the SDK.
- **Adapter extensions** translate AIR artifacts into agent-specific formats. The Claude adapter writes `.mcp.json` and injects skills via `prepareSession()`; the Codex adapter writes `.codex/config.toml` and injects skills into `.agents/skills/`; the Cursor adapter writes `.cursor/mcp.json` + `.cursor/hooks.json` and injects skills into `.cursor/skills/`; the Pi adapter is skills-only and injects skills into `.pi/skills/` with no config file.
- **Provider extensions** resolve remote URIs in `air.json` (e.g., `github://org/repo/path`).

Six artifact types: skills, references, MCP servers, plugins, roots, hooks. All defined as JSON indexes with JSON Schema validation. Every artifact has a qualified identity of the form `@scope/id` — local indexes contribute under `@local/`; remote catalogs use a provider-derived scope (e.g. `@<owner>/<repo>/`). Composition is additive: duplicate qualified IDs hard-fail, cross-scope shortname collisions warn, and `exclude` is the only way to drop an artifact.

## Development

```bash
npm install                          # Install all workspace dependencies
npm run build -w packages/core       # Build core (required before other packages type-check)
npm run build -w packages/sdk        # Build SDK (required before CLI type-checks)
npx vitest run                       # Run all tests across all packages
npx tsc --noEmit -p packages/core/tsconfig.json   # Type-check a specific package
```

Core must be built before SDK, and SDK before CLI, because they import from workspace packages which resolve to `dist/`.

## Core Principles

### Core is the stable center
Schemas and the `ResolvedArtifacts` type are the contract. Changes to these are breaking changes for every consumer. Agent-specific code never goes in core.

### Extensions are the growth path
New agents, new catalog sources, new secret backends — all handled by installing extension packages. The core and CLI stay thin.

### Composition is additive, not later-wins
Every artifact is identified by `@scope/id`. Disjoint qualified IDs union; duplicate qualified IDs hard-fail; cross-scope shortname collisions warn. There is no override path — `exclude` is the only way to drop an artifact. This applies everywhere: `air.json` composition, `mergeArtifacts()`, and provider layering.

### prepareSession is the adapter's main job
The single entry point for setting up a working directory. Callers should not need to know about `.mcp.json` formats or skill injection paths.

## What NOT to Do

- Do not add agent-specific logic to core, SDK, or CLI — it belongs in adapter extensions
- Do not add business logic to the CLI — it belongs in the SDK
- Do not introduce later-wins override or deep merge semantics anywhere — composition is scoped, additive, and exclude-only
- Do not make `resolveArtifacts` synchronous — it must stay async for provider support
- Do not add external CLI dependencies to provider packages — use Node built-ins (`fetch`, `fs`)
- Do not duplicate schema definitions — schemas live at repo root in `schemas/`, core copies them at build time

## FAQ / Learnings

### Extensions load from `<airJsonDir>/node_modules`, never from the global npm tree

The extension loader builds its resolver from `createRequire(join(airJsonDir, "__placeholder.js"))`, so a globally-installed `@pulsemcp/air-*` package is not the copy that runs. Anything that reasons about "which version of an extension is in use" must look under the air.json directory, not at `npm ls -g`.

### `npm install <pkg>@<range>` rewrites the range you just wrote

Handing npm an explicit spec makes it save its *own* normalization back into `dependencies` — a `~0.13.0` written by AIR comes back as `^0.13.1`. When the manifest is the source of truth, write it first and then run a **bare** `npm install --prefix <dir>`: npm leaves package.json byte-identical and reconciles the tree and lockfile against the ranges already there.

### A selection handed to `prepareSession` uninstalls whatever it leaves out

Each adapter's `prepareSession` diffs the new selection against the per-target manifest (`<airHome>/manifests/<sha256(target)>.json`) and removes manifest entries the selection omits. Anything that builds a selection for a directory AIR has already prepared — the `air start` TUI, a script — must start from what is installed (`getInstalledSelection`), not from root defaults, or a plain "confirm" silently uninstalls the previous run's picks. Skills AIR copied in also sit in the adapter's skills directory, so `listLocalArtifacts` sees them; `startSession` filters manifest-tracked ones out of `localArtifacts`.

### The per-target manifest is a deletion list — record only what the adapter created

Everything in a manifest's `skills` / `hooks` is `rm -rf`'d once it leaves the selection, so an adapter must never record a directory that already existed when it got there — that is how #168 deleted users' checked-in skills. From manifest `version: 2` on, `skills` is trusted as-is. Version 1 manifests may hold such claims, so `previousSkillOwnership` (each adapter's `skill-ownership.ts`, kept byte-identical across the four) re-checks their entries against the catalog. `cleanSession` has no catalog, so it leaves version 1 skills in place. Any code that rewrites a manifest while keeping its old entries must keep its `version` too, or it turns unchecked version 1 claims into trusted version 2 ones. And `prepareSession` ignores a manifest another adapter wrote: its shortnames name that adapter's directories, not this one's.

`mcpServers` is a deletion list too: every key in it is removed from the adapter's MCP config once deselected. So a selected server is written only into a free key or over one the previous manifest owns; a key already in the config that AIR doesn't own is the user's, and is neither overwritten nor recorded (#174). From manifest `version: 3` on, `mcpServers` is trusted as-is. Every earlier manifest, `version: 2` included, may list a user's key, so `previousMcpServerOwnership` (`mcp-ownership.ts` in the Claude, Codex and Cursor adapters, kept byte-identical across the three) keeps an entry only when its config matches the adapter's own translation of a catalog server with that shortname. Placeholders compare exactly, except in Claude's `.mcp.json`, where a `${VAR}` may hold any value because the secrets transforms resolve them there in place (the adapter passes `resolvedPlaceholders: true`); that match is linear on purpose, since a backtracking regex built from catalog strings can stall a run for minutes. `cleanSession` has no catalog, so it leaves those keys in place.

### A plugin's body lives in its manifest, and two layers enforce that

A `plugins.json` entry is a registry record — `description`, `path`, `default_in_roots` — and the body (`skills`, `mcp_servers`, `hooks`, `plugins`, plus distribution metadata) lives in `<path>/.plugin/plugin.json`. Declaring a body field with no sibling `path` was deprecated in 0.13.0 and removed in #157: `plugins.schema.json` rejects it through a `dependencies` map and `resolveArtifacts` throws `CatalogConfigError`, both using the one message in `packages/core/src/plugin-body.ts`. Adding a new body field means adding it to `PLUGIN_MANIFEST_FIELDS` *and* to the schema's `dependencies` — `plugin-body.test.ts` fails if the two lists diverge. Inline fields *alongside* a `path` are the sanctioned per-field override and stay legal, which is why the schema constrains the fields rather than dropping them.

### Any `npm install` in a prefix prunes what the manifest does not declare

This holds for bare installs, explicit-spec installs, and `--no-save` alike. Before running one against a user's directory, make sure `dependencies` describes everything in `node_modules` you intend to keep — otherwise the reconcile deletes it.

### `air update` installs nothing it was not given consent for, and absence of consent is a no

`runUpdate()` (`packages/sdk/src/run-update.ts`) performs a version bump only when handed `assumeYes` or a `confirm` callback that answers yes. Given neither it returns `decision: "non-interactive"` and installs nothing. The CLI supplies `confirm` only when `isInteractiveTTY()`, so a pipeline cannot be surprise-bumped by an unattended `npm install -g` — the property holds by construction, not by a check somewhere remembering to fire. Anything adding a new caller of `runUpdate` inherits that default; do not "fix" it by defaulting `assumeYes` to true.

The cache refresh is the other half and is deliberately *not* gated. It changes no versions, with one named exception: the pre-existing provider auto-heal (`preflightUpgradeProviders` in `update.ts`) runs `npm install <provider>@latest` under `<airJsonDir>` when an installed known provider is below `PROVIDER_MIN_VERSIONS`, because a provider too old to expose `refreshCache()` cannot refresh anything and Node's module cache means the repair must precede the load. It is reported in the output and disabled by `--no-auto-heal`; say "the version check never installs without consent" rather than an unqualified "nothing installs", which that exception makes false. It is also deliberately non-fatal — a provider too old or broken to load is exactly the state the version check repairs, so a refresh failure is recorded in `cacheRefreshError` and the run carries on. The CLI exits 1 only when nothing repaired it.
