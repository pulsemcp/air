# Configuration

This document covers how AIR loads, composes, and resolves configuration.

## Where air.json Lives

`air.json` is a user-level file at `~/.air/air.json`. Each user maintains their own. Orgs and teams provide default `air.json` files as starting points — users copy and customize.

Override the path with the `AIR_CONFIG` environment variable.

## How Composition Works

All composition is expressed in `air.json`. Each artifact property is an array of paths to index files. The CLI loads every file in the array and merges them sequentially — later entries override earlier ones by ID.

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

When you're layering full catalogs that follow the standard `<type>/<type>.json` layout, the `catalogs` field lets you reference each catalog once instead of listing every artifact type separately:

```json
{
  "name": "frontend-team",
  "catalogs": [
    "github://acme/air-org",
    "./local-catalog"
  ]
}
```

Each entry expands into all six artifact arrays at resolution time; files that aren't present in a given catalog are silently skipped. `catalogs` and the per-type arrays compose — catalogs expand first, per-type arrays layer on top — so you can mix them to pull most artifacts from catalogs and add targeted overrides via the per-type arrays.

## Merging Strategy

For each artifact type, files in the array merge by ID:

1. **New IDs** are added to the merged set
2. **Matching IDs** from a later file **replace** the earlier entry entirely (no deep merge)
3. **The `$schema` property**, if present, is excluded from merging

### Example

Given this `air.json`:

```json
{
  "name": "my-project",
  "mcp": [
    "./org-mcp/mcp.json",
    "./mcp/mcp.json"
  ]
}
```

**org-mcp/mcp.json:**
```json
{
  "github": {
    "title": "GitHub",
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github@0.5.0"]
  }
}
```

**mcp/mcp.json:**
```json
{
  "github": {
    "title": "GitHub (Pinned)",
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github@0.6.2"]
  },
  "postgres": {
    "title": "PostgreSQL",
    "type": "stdio",
    "command": "uvx",
    "args": ["postgres-mcp==0.3.0"]
  }
}
```

**Merged result:**
```json
{
  "github": {
    "title": "GitHub (Pinned)",
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github@0.6.2"]
  },
  "postgres": {
    "title": "PostgreSQL",
    "type": "stdio",
    "command": "uvx",
    "args": ["postgres-mcp==0.3.0"]
  }
}
```

The local `github` entry completely replaces the org's. The local `postgres` entry is new and added.

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
