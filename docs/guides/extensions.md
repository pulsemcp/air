# Extensions System

Extensions are how AIR grows without bloating the core. Adapters, catalog providers, and transforms are all delivered as extension packages.

## Extension types

| Type | Purpose | Example |
|------|---------|---------|
| **Adapter** | Translate AIR config to agent-specific formats | `@pulsemcp/air-adapter-claude` |
| **Provider** | Resolve remote URIs in artifact paths | `@pulsemcp/air-provider-github` |
| **Transform** | Modify `.mcp.json` after session preparation | Custom secrets injection extension |

A single extension package can provide any combination of these.

## Declaring extensions

List extensions in your `air.json`:

```json
{
  "name": "my-config",
  "extensions": [
    "@pulsemcp/air-adapter-claude",
    "@pulsemcp/air-provider-github"
  ]
}
```

Extensions can be:
- **npm packages** — e.g., `"@pulsemcp/air-adapter-claude"`
- **Local paths** — e.g., `"./my-extension"` (relative to `air.json`)

## Installing extensions

Install all declared extensions:

```bash
air install
```

Or install manually:

```bash
npm install @pulsemcp/air-adapter-claude @pulsemcp/air-provider-github
```

See [Installing Extensions](installing-extensions.md) for details.

## Adapters

Adapters translate AIR's agent-agnostic configuration into the format a specific agent understands.

### What adapters do

When `air start` or `air prepare` runs, the adapter:

1. Filters artifacts based on root defaults and overrides
2. Translates MCP server configs to the agent's format
3. Writes the agent's config file (e.g., `.mcp.json` for Claude Code)
4. Copies skills into the agent's workspace
5. Copies referenced documents into skill directories
6. Builds the command to start the agent

### Claude adapter specifics

The `@pulsemcp/air-adapter-claude` adapter:

- Writes `.mcp.json` with servers wrapped in `{ "mcpServers": { ... } }`
- Strips `title` and `description` from server entries (Claude doesn't use them)
- Translates `streamable-http` type to `http` (Claude Code's naming)
- Converts OAuth `redirectUri` to `callbackPort` (extracts port number)
- Copies skills into `.claude/skills/{skill-id}/`
- Copies referenced documents into `.claude/skills/{skill-id}/references/`
- Does not overwrite skills that already exist locally

### Adapter discovery

AIR finds adapters by:
1. Checking loaded extensions for an adapter matching the requested name
2. Trying to import `@pulsemcp/air-adapter-{name}` from `node_modules`

## Providers

Providers resolve remote URIs in artifact path arrays, enabling shared configuration across teams.

### How providers work

When `air.json` references a remote URI:

```json
{
  "skills": [
    "./skills/local-skills.json",
    "github://acme/shared-config/skills/team-skills.json"
  ]
}
```

The provider for the `github://` scheme fetches and parses the remote file, returning artifact entries that get merged with local ones.

### GitHub provider

The `@pulsemcp/air-provider-github` provider resolves `github://` URIs:

```
github://owner/repo/path/to/file.json
github://owner/repo@ref/path/to/file.json
```

The `@ref` is appended to the repo name (preferred). You can specify a branch, tag, or commit SHA. Without `@ref`, the default branch is used.

The legacy syntax `github://owner/repo/path/to/file.json@ref` is also supported for backward compatibility, and is required for refs containing slashes (e.g., `feature/branch`).

It does a shallow clone of the repository to `~/.air/cache/github/{owner}/{repo}/{ref}/` and reads the file from the local clone.

**Authentication:** Set `AIR_GITHUB_TOKEN` for private repositories:

```bash
export AIR_GITHUB_TOKEN=ghp_xxxxxxxxxxxx
```

**Cache:** Clones are cached locally. Delete `~/.air/cache/github/` to force re-fetching.

## Transforms

Transforms modify `.mcp.json` after the adapter writes it, enabling post-processing like secrets injection.

### How transforms work

During `air prepare`:

1. The adapter writes `.mcp.json`
2. Each transform runs sequentially in declaration order
3. Each transform receives the current config and returns a modified version
4. The final result is written back to `.mcp.json`

### Transform context

Transforms receive a context object with:

| Field | Description |
|-------|-------------|
| `targetDir` | Directory being prepared |
| `root` | Active root entry (if any) |
| `artifacts` | All resolved artifacts |
| `options` | CLI options contributed by this extension |
| `mcpConfigPath` | Path to the `.mcp.json` file |

### Extension-contributed CLI flags

Extensions can declare CLI options that appear on `air prepare`. For example, a secrets extension might add `--secrets-file`:

```bash
air prepare --secrets-file /path/to/secrets.env
```

The flag's value is passed to the transform via `context.options`.

## Extension loading order

Extensions load in the order they appear in `air.json`. This matters for transforms — they run in declaration order. A secrets extension should typically come after other transforms that might add `${VAR}` patterns.

```json
{
  "extensions": [
    "@pulsemcp/air-adapter-claude",
    "@pulsemcp/air-provider-github",
    "./custom-transform",
    "./secrets-resolver"
  ]
}
```

Here, `custom-transform` runs before `secrets-resolver`, so any `${VAR}` patterns it introduces will be resolved by the secrets transform.

## The prepareSession flow

Here's the complete flow during `air prepare`:

```
1. Load air.json
2. Load extensions (adapters, providers, transforms)
3. Resolve artifacts
   └── Providers resolve remote URIs (e.g., github://)
4. Detect or validate root
5. Adapter.prepareSession()
   ├── Write .mcp.json
   ├── Copy skills to workspace
   └── Copy referenced documents
6. Run transforms sequentially on .mcp.json
7. Validate no unresolved ${VAR} patterns
8. Return PreparedSession
```

## Next steps

- **[Installing Extensions](installing-extensions.md)** — Install declared extensions.
- **[Composition and Overrides](composition-and-overrides.md)** — Use providers for remote config.
- **[Running Sessions](running-sessions.md)** — See extensions in action during sessions.
