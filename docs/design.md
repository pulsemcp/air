# AIR Design Document

This is the canonical AIR design document. It exists so new contributors can read one file and come away with two things:

1. **Who AIR is for.** The team and org shapes adopting it, what their failure modes look like, and what AIR's defaults need to do for each.
2. **Why AIR works the way it does.** The trade-offs behind composition rules, override semantics, scope identity, and extension architecture.

The two halves feed each other: scenarios are the input that decisions reason about; decisions cite the scenarios they serve. When a decision changes, this document is updated in place — there is no per-decision status field. Treat what's written here as AIR's current canonical state.

Issue tracking and historical context live in the linked GitHub issues. This document captures the *shape* of each decision; the issues capture the negotiation.

## Contents

- [User scenarios](#user-scenarios)
  - [1. Small startup, single repo](#1-small-startup-single-repo)
  - [2. Mid-size org with a Developer Experience team](#2-mid-size-org-with-a-developer-experience-team)
  - [3. External catalog composition (vendor / customer)](#3-external-catalog-composition-vendor--customer)
  - [4. Open-source / community catalog](#4-open-source--community-catalog)
- [Design decisions](#design-decisions)
  - [AIR core](#air-core)
    - [Full replacement by ID, no deep merge](#full-replacement-by-id-no-deep-merge)
    - [Always-scoped artifact identity](#always-scoped-artifact-identity)
    - [Exclude-only composition](#exclude-only-composition)
    - [Schemas live at the repo root, copied into core at build time](#schemas-live-at-the-repo-root-copied-into-core-at-build-time)
    - [`resolveArtifacts` is async-only](#resolveartifacts-is-async-only)
    - [Extension interfaces — `AgentAdapter`, `CatalogProvider`, `PrepareTransform`, `PluginEmitter`](#extension-interfaces--agentadapter-catalogprovider-preparetransform-pluginemitter)
  - [AIR CLI](#air-cli)
    - [`air init` is idempotent via top-up mode](#air-init-is-idempotent-via-top-up-mode)
    - [Deprecated plural flags hard-error](#deprecated-plural-flags-hard-error)
    - [Manifest tracking and cleanup of stale artifacts](#manifest-tracking-and-cleanup-of-stale-artifacts)
    - [Catalog auto-discovery up to 3 levels deep](#catalog-auto-discovery-up-to-3-levels-deep)

## User scenarios

These are the team and org shapes AIR's defaults are designed for. They're a starting point, not the final list — candidates worth considering later include large enterprises with multiple orgs sharing a meta-catalog, agent-platform vendors shipping AIR-as-config, and individual-developer + employer-org composition.

### 1. Small startup, single repo

A handful of engineers, one or two repos, no formal DevEx team. Coordination is social — collisions get resolved by walking over to a colleague's desk.

- **Collision risk:** low.
- **Value of scoping:** marginal.
- **Failure mode that matters most:** silent last-wins. A teammate adds a same-ID artifact that quietly shadows yours and nothing surfaces it; the agent now does the wrong thing in production with no visible signal.

The team probably keeps everything local — no remote catalog, no providers. A fully local `air.json` is a supported first-class shape:

```json
{
  "name": "garage-startup",
  "description": "Local-only AIR config for the team",
  "extensions": ["@pulsemcp/air-adapter-claude"],
  "skills": ["./skills/skills.json"],
  "mcp": ["./mcp/mcp.json"],
  "hooks": ["./hooks/hooks.json"]
}
```

What AIR's defaults need to do here: catch accidental name clashes loudly enough that the fix is "rename one of them" instead of "argue about resolution order."

### 2. Mid-size org with a Developer Experience team

A platform / DevEx team owns a shared cross-company catalog. Several product teams own their own project-level catalogs and compose the org catalog plus their own. Most artifacts don't collide. Some intentionally do — a product team writes a more specific version of an org skill for their stack.

- **Collision risk:** medium (intentional + accidental).
- **Value of scoping:** significant — provenance matters when an agent does something unexpected and someone has to ask "where did that come from?"
- **Failure mode that matters most:** silent merge in unexpected order. Two layers contribute the same shortname, the agent picks one, and there's no visible record of which won or why.

The platform team's `air.json` typically composes one or more remote catalogs alongside their own:

```json
{
  "name": "platform-team",
  "description": "Platform team — composes org catalog + team-local catalog",
  "extensions": ["@pulsemcp/air-provider-github"],
  "catalogs": [
    "github://acme/air-org",
    "./platform-team-catalog"
  ]
}
```

A common directory layout for the local catalog:

```
~/.air/
├── air.json                     # the file above
└── platform-team-catalog/
    ├── skills/skills.json       # team skills (some may shadow org skills)
    ├── mcp/mcp.json             # team MCP servers
    └── plugins/plugins.json     # team-specific plugin bundles
```

What AIR's defaults need to do here: make provenance obvious and surface intentional-vs-accidental collisions distinctly. Agents reading descriptions need enough context to pick the right artifact; humans reviewing config need to see who contributed what.

### 3. External catalog composition (vendor / customer)

A consumer composes a catalog they don't own — for example, a customer's `air.json` shipped alongside an integration. Some artifacts apply, some don't, and there's no upstream commit access.

- **Collision risk:** variable.
- **Value of scoping:** high — `@customer/repo/...` is obviously not yours, and an agent reading descriptions can tell which entries are customer-specific.
- **Failure mode that matters most:** an external artifact silently shadowing a local one (or vice versa), with no way for the consumer to express "I want this catalog *minus* these items" without forking it.

The consumer pulls in the customer's catalog, then drops the entries that don't apply. Composition is declarative — no fork, no shadowing tricks:

```json
{
  "name": "vendor-side-config",
  "description": "Our config, composed with a customer's catalog",
  "extensions": ["@pulsemcp/air-provider-github"],
  "catalogs": [
    "github://customer-co/their-air-config",
    "./local-catalog"
  ],
  "exclude": [
    "@customer-co/their-air-config/legacy-deploy",
    "@customer-co/their-air-config/internal-only-mcp"
  ]
}
```

> The `exclude` field and the `@scope/id` qualified-identifier syntax ship with the next major bump (see [Always-scoped artifact identity](#always-scoped-artifact-identity) and [Exclude-only composition](#exclude-only-composition) below). Today, the closest workaround is to fork or shadow upstream entries — exactly the friction this scenario describes.

What AIR's defaults need to do here: make exclusion declarative (so it shows up in PR review) and keep scope visible in the qualified ID so an agent or human can tell at a glance which entries came from the customer's catalog.

### 4. Open-source / community catalog

A user pulls a published public catalog. Several OSS catalogs may overlap because everyone is inventing names in parallel.

- **Collision risk:** high.
- **Value of scoping:** highest — without scope, OSS composition is fundamentally fragile; two `code-review` skills from two different authors are not the same artifact and can't safely be treated as such.
- **Failure mode that matters most:** silent resolution-order winner with no way to tell what you got, or no way to opt out of one entry without dropping the whole catalog.

A user composing two community catalogs plus their own local layer:

```json
{
  "name": "indie-developer",
  "extensions": ["@pulsemcp/air-provider-github"],
  "catalogs": [
    "github://oss-author-1/air-skills",
    "github://oss-author-2/air-toolkit",
    "./my-local-catalog"
  ],
  "exclude": [
    "@oss-author-2/air-toolkit/aggressive-cleanup-hook"
  ]
}
```

> Same caveat as scenario 3: `exclude` and the `@scope/id` qualified-identifier syntax ship with the next major bump.

What AIR's defaults need to do here: make scope mandatory so two same-shortname artifacts don't get conflated, surface cross-scope shortname collisions as a warning so an agent doesn't silently confuse two different `code-review` skills, and keep the per-artifact opt-out as the only required composition lever.

## Design decisions

Decisions are split into **AIR core** (the framework — schemas, resolution, composition, extension interfaces; load-bearing for every consumer) and **AIR CLI** (the `air` command — UX choices, default behaviors, command shapes; consumers can skip the CLI and use the SDK directly). The split makes it clear which decisions are part of the contract and which are CLI-specific.

Each decision below captures:

- **Decision** — what AIR does, in one paragraph.
- **Context** — what problem this addresses, citing scenarios where relevant.
- **Trade-offs** — what we gave up, in one line.
- **Related decisions** — cross-links within this doc.

### AIR core

#### Full replacement by ID, no deep merge

**Decision.** When two artifact entries share an ID, the winning entry replaces the losing one in full — no field-level merging. This is the only merge semantic AIR offers, and it applies uniformly across `air.json` composition, in-catalog index merging, and provider layering.

**Context.** Deep merge creates ambiguity: when a field is present in the result, you can't tell which layer contributed it. With full replacement, the answer is always "whichever entry won, exactly as written in its source file." This matters in every scenario, but especially in [scenario 2](#2-mid-size-org-with-a-developer-experience-team) and [scenario 3](#3-external-catalog-composition-vendor--customer) where multiple layers actively contribute and provenance has to stay legible.

**Trade-offs.** We gave up deep-merge ergonomics — a consumer who wants one tweaked field on an upstream artifact has to redeclare the whole entry — for predictability.

**Related decisions.** [Always-scoped artifact identity](#always-scoped-artifact-identity), [Exclude-only composition](#exclude-only-composition).

#### Always-scoped artifact identity

**Decision.** Every artifact is canonically addressed as `@scope/id`, where the scope is derived from the catalog the artifact came from (e.g., `org/repo` for a `github://`-resolved catalog, the literal string `local` for a local catalog). This applies uniformly to all six artifact types — there is no per-type special-casing. Inside catalog content, references can use the short form when unambiguous and the qualified form is always allowed; intra-catalog references (a hook in `@a/repo` referencing a skill in `@a/repo`) implicitly scope to their own catalog. Two artifacts with the same fully qualified ID hard-fail at composition; two artifacts with the same shortname in different scopes warn but resolve. Tracked in [#110](https://github.com/pulsemcp/air/issues/110); ships in the next major.

**Context.** Without scope, OSS composition ([scenario 4](#4-open-source--community-catalog)) is fundamentally fragile — two `code-review` skills from two authors are not the same artifact but get conflated by a flat ID space. Mid-size orgs ([scenario 2](#2-mid-size-org-with-a-developer-experience-team)) and vendor composition ([scenario 3](#3-external-catalog-composition-vendor--customer)) need provenance: when an agent reads a description, the qualified ID tells it (and the human reviewing config) where the entry came from. Scoping also turns previously-silent same-ID collisions into a hard-fail with a clear message.

**Trade-offs.** We gave up the npm-style "two `@a/foo` and `@b/foo` happily coexist" property — same qualified ID still hard-fails even within `local` — for a simpler mental model where scope buys provenance and good error messages, not coexistence.

**Related decisions.** [Full replacement by ID, no deep merge](#full-replacement-by-id-no-deep-merge), [Exclude-only composition](#exclude-only-composition).

#### Exclude-only composition

**Decision.** The only declarative composition control consumers get is `exclude` — a list of fully qualified artifact IDs to drop from the composed result. There is no override, no field-patching, no per-source overrides block. If a consumer wants a different artifact with the same shortname as an upstream one, they declare their own under their own scope; if they want the upstream gone, they exclude it. Exclude is uniform across all artifact types — the qualified ID identifies which type it belongs to, AIR resolves the rest. Tracked in [#110](https://github.com/pulsemcp/air/issues/110), absorbing the broader `exclude`-vs-`overrides` design space explored in [#111](https://github.com/pulsemcp/air/issues/111); ships in the next major.

**Context.** Vendor composition ([scenario 3](#3-external-catalog-composition-vendor--customer)) and OSS composition ([scenario 4](#4-open-source--community-catalog)) both need a way to say "I want this catalog *minus* these items" without forking. Forking has its own maintenance cost — you have to track upstream changes manually — and shadowing tricks (declaring a local stub with the same ID) are fragile and intent-hostile. A first-class `exclude` makes the consumer's intent visible in PR review and keeps the composition surface declarative. The earlier `overrides` direction was rejected because it reintroduces the deep-merge ambiguity that [full replacement](#full-replacement-by-id-no-deep-merge) explicitly avoided.

**Trade-offs.** We gave up field-level patching — a consumer who wants an upstream artifact with one tweaked description has to fork it locally and track upstream manually — for a single, predictable composition control.

**Related decisions.** [Always-scoped artifact identity](#always-scoped-artifact-identity), [Full replacement by ID, no deep merge](#full-replacement-by-id-no-deep-merge).

#### Schemas live at the repo root, copied into core at build time

**Decision.** JSON Schema files (Draft 7) live at `schemas/` at the repo root and are copied into `packages/core/schemas/` by core's build step (`npm run copy-schemas`). The repo-root copy is the single source of truth; the core-package copy is a build artifact, not separately maintained. Other packages (SDK, CLI, adapters) consume schemas via core.

**Context.** Schemas are the contract that the entire AIR ecosystem reads — including non-TypeScript consumers (Ruby apps, agent orchestrators). They have to be discoverable from the repo root for editor JSON-schema integrations and for tools that don't depend on `@pulsemcp/air-core`. Duplicating them in the package would create drift; treating the package copy as a build artifact keeps the contract canonical at one location.

**Trade-offs.** We gave up the simpler "everything that ships in the package lives in the package directory" rule for a build-step indirection that keeps the repo-root schemas authoritative.

**Related decisions.** None.

#### `resolveArtifacts` is async-only

**Decision.** The core resolution function `resolveArtifacts(airJsonPath, options?)` is asynchronous and there is no synchronous variant. Local filesystem reads are still done synchronously inside it; the async signature exists so remote URI schemes (`github://` today, future provider-defined schemes such as `s3://`) can be delegated to `CatalogProvider` extensions that need to do network I/O.

**Context.** AIR's composition model permits any `air.json` array entry to be a remote URI. Providers do network calls to resolve them — cloning a GitHub repo, fetching an S3 object, etc. A synchronous core API would force every provider into blocking I/O or a separate async track, splitting the API surface. Async-only keeps one resolution path that handles both local and remote sources. This is what makes the catalog-mixing patterns in [scenario 2](#2-mid-size-org-with-a-developer-experience-team) and [scenario 4](#4-open-source--community-catalog) work uniformly.

**Trade-offs.** We gave up sync ergonomics in fully-local cases — every `resolveArtifacts` call has to be `await`ed even when nothing remote is involved — for a single, provider-friendly API.

**Related decisions.** [Extension interfaces](#extension-interfaces--agentadapter-catalogprovider-preparetransform-pluginemitter).

#### Extension interfaces — `AgentAdapter`, `CatalogProvider`, `PrepareTransform`, `PluginEmitter`

**Decision.** AIR's growth happens through extensions, not core. Core defines four extension interfaces and ships zero implementations of them:

- **`AgentAdapter`** — translates resolved AIR artifacts into agent-specific session config and prepares a working directory. `prepareSession(artifacts, targetDir, options?)` is the single entry point: callers don't need to know about `.mcp.json` formats, skill injection paths, or hook registration. Implementations: `@pulsemcp/air-adapter-claude`, future adapters for OpenCode, Cursor, etc.
- **`CatalogProvider`** — resolves remote URI schemes (`github://`, future `s3://`). Each provider declares a scheme and implements `resolve(uri, baseDir)` (parse a single URI to JSON) and `resolveCatalogDir(uri)` (return a local directory the catalog walker can scan). Implementations: `@pulsemcp/air-provider-github`.
- **`PrepareTransform`** — post-processes the adapter's written config (MCP servers, hooks). Used for secrets resolution, config patching, and other cross-cutting transforms. Implementations: `@pulsemcp/air-secrets-env`, `@pulsemcp/air-secrets-file`.
- **`PluginEmitter`** — builds distributable plugin packages from AIR artifacts (e.g., a Claude Co-work marketplace directory). Used by `air export`, not by live sessions. Implementations: `@pulsemcp/air-cowork`.

**Context.** AIR has to support a moving target: new agents arrive, new catalog sources arrive, new secret backends arrive. Putting any of this in core would lock the whole ecosystem to one set of implementations and require core releases for every adapter or provider change. The interface split lets core stay small and the CLI stay thin while the agent-specific and source-specific logic ships independently. The four-interface taxonomy maps to the four legitimate places AIR needs an extension point: which agent (`AgentAdapter`), which source (`CatalogProvider`), what to mutate post-write (`PrepareTransform`), and what to emit for distribution (`PluginEmitter`).

**Trade-offs.** We gave up the simplicity of a single monorepo with hardcoded agent + provider support for a more rigorous interface boundary that every implementation has to honor.

**Related decisions.** [`resolveArtifacts` is async-only](#resolveartifacts-is-async-only).

### AIR CLI

CLI decisions are product opinions and can move faster than core decisions — a consumer can always skip the CLI and use the SDK directly.

#### `air init` is idempotent via top-up mode

**Decision.** When `air.json` already exists and `--force` isn't set, `air init` runs in **top-up mode**: existing `air.json` is left untouched and only missing scaffold pieces (per-type index files, README) are created. A no-op top-up — everything is already scaffolded — prints a friendly message and exits cleanly. `--force` is the explicit opt-in for regenerating from scratch. Tracked in [#93](https://github.com/pulsemcp/air/issues/93).

**Context.** Before this change, users who initialized on an old AIR version had no clean path to pull in scaffold pieces added later (new index files, README templates) without either deleting `~/.air/` or recreating files manually. Both options are intent-hostile when the user wants to keep their existing config. Top-up mode gives the small startup ([scenario 1](#1-small-startup-single-repo)) and any consumer on an older version a one-command upgrade.

**Trade-offs.** We gave up the simpler "init always means a fresh init" mental model for a more forgiving default that costs an extra CLI message to disambiguate.

**Related decisions.** [Manifest tracking and cleanup of stale artifacts](#manifest-tracking-and-cleanup-of-stale-artifacts).

#### Deprecated plural flags hard-error

**Decision.** When `air start` or `air prepare` is invoked with a deprecated plural artifact-selection flag (`--plugins`, `--skills`, `--mcp-servers`, `--hooks`, or any `--without-*` plural variant), the CLI exits with code 1 and prints a migration error naming the new flag. There is no silent passthrough, no warn-and-continue. Tracked in [#95](https://github.com/pulsemcp/air/issues/95).

**Context.** After the singular-variadic rename in v0.0.32, the old plural flags were silently dropped (`.allowUnknownOption(true)` is on for legitimate extension flags). That meant orchestrators still passing `--plugins screenshots-videos,...` got an exit-0 success, a stderr warning nobody reads, and a `.mcp.json` missing the requested plugins. The agent ran in a degraded state and the failure was invisible upstream. A loud error is the right default when the alternative is invisibly broken sessions — the CLI is mid-pipeline for orchestrators, and stderr is not a reliable signal channel.

**Trade-offs.** We gave up backward compatibility with old callers — every orchestrator on the deprecated flags has to migrate at once — for a fail-fast contract that won't ship a neutered agent without telling anyone.

**Related decisions.** None.

#### Manifest tracking and cleanup of stale artifacts

**Decision.** Each AIR-managed target directory has a manifest stored at `<airHome>/manifests/<sha256(targetDir)>.json` (default `airHome` is `~/.air`, overridable via `AIR_HOME`). The manifest records which skills, hooks, and MCP servers AIR previously wrote into that directory. On every `prepareSession`, the adapter diffs the prior manifest against the new selection and removes artifacts that AIR previously wrote but that aren't selected anymore — `.claude/skills/<id>/`, `.claude/hooks/<id>/`, and the matching `.mcp.json` entries. User-authored entries (anything not in the manifest) are preserved. Tracked in [#87](https://github.com/pulsemcp/air/issues/87).

**Context.** Before this, `air start` and `air prepare` only added files; nothing was ever removed. Re-running with a smaller selection (deselecting a hook, dropping a plugin) left the old artifacts behind, and projects accumulated stale config that nobody remembered enabling. AIR also couldn't distinguish artifacts it had written from artifacts the user had hand-authored, so it couldn't safely clean up. The manifest gives AIR a clean ownership marker — anything in the manifest is AIR's, anything outside it is the user's — and lets re-runs converge on the desired state without trampling user content. Storing the manifest outside the project directory (under `~/.air/manifests/`) means nothing extra appears in the working tree and there's no `.gitignore` line to manage.

**Trade-offs.** We gave up the simpler "AIR only writes, never deletes" rule (and accepted some out-of-tree state under `~/.air/`) for clean re-runs and accurate ownership tracking.

**Related decisions.** [`air init` is idempotent via top-up mode](#air-init-is-idempotent-via-top-up-mode).

#### Catalog auto-discovery up to 3 levels deep

**Decision.** A `catalogs[]` entry in `air.json` no longer requires the rigid `<type>/<type>.json` layout. AIR walks each catalog root up to 3 directory levels deep and picks up any file that looks like an AIR artifact index — either by filename (`skills.json`, `roots.json`, `mcp.json`, `references.json`, `plugins.json`, `hooks.json`, or any filename containing those tokens as delimited segments) or by its `$schema` URL pointing at an AIR schema. Files whose `$schema` points at a non-AIR schema are skipped even if the filename matches. `node_modules`, `.git`, `dist`, `build`, `coverage`, `.next`, `.turbo`, `target`, `vendor`, and any directory starting with `.` are skipped; `.gitignore` at the catalog root is honored. Within a single catalog, multiple indexes of the same type merge in sorted relative-path order with later-wins by ID. Across catalogs, earlier entries merge first; later catalogs override. Tracked in [#108](https://github.com/pulsemcp/air/issues/108) and [#109](https://github.com/pulsemcp/air/issues/109).

**Context.** Real catalogs use whatever directory naming makes sense in their repo — `agents/agent-roots/roots.json`, `config/mcp-servers/mcp.json` — and predate AIR's conventions. The rigid layout silently dropped every artifact that didn't sit at the conventional path, which hid ~60 agent roots and ~88 MCP servers in `pulsemcp/pulsemcp` from `air resolve`. Mid-size orgs ([scenario 2](#2-mid-size-org-with-a-developer-experience-team)) and OSS composers ([scenario 4](#4-open-source--community-catalog)) need to point at catalogs as-they-are without forking the directory layout to satisfy the tool. A bounded recursive walk keeps discovery cheap (depth cap, ignore-list, `.gitignore` honored) while accepting whatever folder names the catalog author picked.

**Trade-offs.** We gave up the "exactly one path per artifact type" guarantee and accepted the ambiguity of multiple indexes in one catalog (resolved with sorted-order last-wins) for catalog-author flexibility.

**Related decisions.** [Full replacement by ID, no deep merge](#full-replacement-by-id-no-deep-merge), [Extension interfaces](#extension-interfaces--agentadapter-catalogprovider-preparetransform-pluginemitter).
