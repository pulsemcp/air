# Configuration

This document covers how AIR loads, composes, and resolves configuration.

## Where air.json Lives

`air.json` is a user-level file at `~/.air/air.json`. Each user maintains their own. Orgs and teams provide default `air.json` files as starting points — users copy and customize.

Override the path with the `AIR_CONFIG` environment variable.

## How Composition Works

All composition is expressed in `air.json`. Each artifact property is an array of paths to index files. Every artifact is identified by `@scope/id`, where local entries contribute under `@local/` and remote catalogs use a provider-derived scope (e.g. `@<owner>/<repo>/`). Composition is additive — duplicate qualified IDs hard-fail, and the only way to drop an artifact is `exclude`.

```json
{
  "name": "frontend-team",
  "mcp": [
    "github://acme/air-org/mcp/mcp.json",
    "github://acme/air-frontend/mcp/mcp.json",
    "./mcp/mcp.json"
  ],
  "skills": [
    "github://acme/air-org/skills/skills.json",
    "./skills/skills.json"
  ]
}
```

- **First entries** (org) define the baseline
- **Middle entries** (team) add and override
- **Last entries** (local) make final adjustments

There is no separate CLI config file. `air.json` is the single composition point.

### Whole-catalog composition

The `catalogs` field lets you reference each catalog once instead of listing every artifact type separately:

```json
{
  "name": "frontend-team",
  "catalogs": [
    "github://acme/air-org",
    "./local-catalog"
  ]
}
```

Each entry is treated as a directory (local path or provider URI). AIR walks the catalog up to 3 directory levels deep and picks up any file whose filename or `$schema` identifies it as an AIR artifact index (`skills.json`, `roots.json`, `mcp.json`, `references.json`, `plugins.json`, `hooks.json`, or any filename that contains those keywords as delimited tokens). You are free to organize indexes under whatever folder names suit your repo — `agents/agent-roots/roots.json`, `config/mcp-servers/mcp.json`, and the conventional `<type>/<type>.json` layout all work.

Traversal rules:

- **Depth cap**: 3 levels below the catalog root. Indexes deeper than that must be referenced via explicit per-type arrays.
- **Skipped directories**: `node_modules`, `.git`, `dist`, `build`, `coverage`, `.next`, `.turbo`, `target`, `vendor`, and any directory starting with `.`.
- **`.gitignore` at the catalog root**: honored — ignored paths are not descended into.
- **`$schema` check**: a JSON file whose `$schema` points to a non-AIR schema is skipped even if its filename matches. Files without `$schema` are identified by filename alone.

Within a single catalog, multiple indexes of the same type contribute to the same scope, so they must have disjoint shortnames — duplicates hard-fail. Different catalogs ship under different scopes (`@<owner>/<repo>/...` for `github://`, `@local/...` for local paths), so they never collide. The per-type arrays (`skills`, `mcp`, …) contribute under `@local/...` alongside any local catalogs.

Remote catalog URIs (e.g. `github://owner/repo@ref/path`) are supported when the matching provider can clone or mount the source locally. You can point at the whole repo (`github://owner/repo`), a ref (`github://owner/repo@main`), or a subdirectory (`github://owner/repo@main/agents`).

## Composition Strategy

Every artifact has a qualified identity of the form `@scope/id`. Local indexes contribute under `@local/`; remote catalogs contribute under their provider-derived scope (e.g. `@<owner>/<repo>/`).

For each artifact type:

1. **Different qualified IDs** accumulate (additive union)
2. **Duplicate qualified IDs** hard-fail — you cannot silently override an artifact
3. **Cross-scope shortname collisions** warn but keep both — disambiguate with the qualified form
4. **`exclude`** is the only way to drop an artifact. Provide an object keyed by artifact type (`skills`, `references`, `mcp`, `plugins`, `roots`, `hooks`); each value is a list of qualified-ID patterns where `*` matches one full segment.

See [Composition and Overrides](guides/composition-and-overrides.md) for the full rules and examples.

### Example

Given this `air.json`:

```json
{
  "name": "my-project",
  "extensions": ["@pulsemcp/air-provider-github"],
  "catalogs": ["github://acme/air-org"],
  "mcp": ["./mcp/mcp.json"]
}
```

The org catalog ships `github` and `slack` MCP servers; your local `mcp.json` ships `postgres`. Resolved:

```
@acme/air-org/github
@acme/air-org/slack
@local/postgres
```

If you want to drop the org's `slack` server:

```json
{
  "catalogs": ["github://acme/air-org"],
  "exclude": {
    "mcp": ["@acme/air-org/slack"]
  }
}
```

`exclude` is an object keyed by artifact type (`skills`, `references`, `mcp`, `plugins`, `roots`, `hooks`); each value is a list of qualified-ID patterns where `*` matches a single segment.

If you want a different `github` configuration, ship it under `@local/`:

```json
{
  "catalogs": ["github://acme/air-org"],
  "mcp": ["./mcp/mcp.json"],
  "exclude": {
    "mcp": ["@acme/air-org/github"]
  }
}
```

— with `./mcp/mcp.json` defining `github` (which becomes `@local/github`).

## Git Protocol

Remote catalog URIs like `github://owner/repo/...` are resolved by cloning the repository locally. By default, AIR uses **SSH** (`git@github.com:owner/repo.git`) so clones pick up the SSH keys most engineers already have registered with GitHub — no credential prompts, no token needed for public repos.

Set `gitProtocol` to opt back into HTTPS when the environment calls for it:

```json
{
  "name": "my-project",
  "gitProtocol": "https",
  "catalogs": ["github://acme/air-org"]
}
```

Common reasons to use HTTPS:

- **CI runners without SSH keys** — set `gitProtocol` to `"https"` and provide `AIR_GITHUB_TOKEN` for any private repos in the catalog list.
- **Corporate networks that block port 22** — HTTPS on port 443 is almost always allowed.
- **Token-based automation** — when you already manage a GitHub token via a secrets manager, HTTPS lets you use it directly.

### Precedence

A session's effective protocol is decided in this order (highest first):

1. `--git-protocol <ssh|https>` on `air start` / `air prepare` / `air update`
2. The `AIR_GIT_PROTOCOL` environment variable
3. The `gitProtocol` field in `air.json`
4. Default: `"ssh"`

Tokens are only injected into the clone URL when protocol is HTTPS; in SSH mode the token is ignored and clones rely on your configured keys.

## Minimal Configuration

A minimal AIR setup needs just an `air.json`:

```json
{
  "name": "my-project",
  "mcp": ["./mcp/mcp.json"]
}
```

You only need to include the artifact types you use. No need to create empty index files for types you don't need.

## Resolving a Root

When you start a session with `--root`, AIR resolves the root's dependencies:

1. Load and merge all artifact arrays from `air.json`
2. Find the root by name in the merged roots
3. Resolve `default_mcp_servers` against the merged MCP servers
4. Resolve `default_skills` against the merged skills
5. For each skill, resolve its `references` against the merged references
6. Resolve `default_plugins` against the merged plugins
7. Resolve `default_hooks` against the merged hooks
8. Translate everything to the target agent's format
