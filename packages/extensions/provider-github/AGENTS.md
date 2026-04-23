# @pulsemcp/air-provider-github

AIR catalog provider for GitHub. Resolves `github://` URIs in `air.json` by shallow-cloning the repository locally (via `git`) and reading files out of the clone. Clones are cached at `~/.air/cache/github/{owner}/{repo}/{ref}/`.

## Folder Hierarchy

```
packages/extensions/provider-github/
├── src/
│   ├── index.ts            # AirExtension default export + re-exports
│   └── github-provider.ts  # GitHubCatalogProvider class, URI parser, clone/cache logic
├── tests/
│   └── github-provider.test.ts  # URI parsing, cache paths, clone integration
└── package.json
```

## Domain Context

This package implements the `CatalogProvider` interface from `@pulsemcp/air-core`. It handles `github://owner/repo[@ref]/path/to/file.json` URIs by shelling out to `git clone --depth 1` (via `execFileSync`) and then reading the requested file from the local clone. Cache refresh uses `git fetch --depth 1` + `git reset --hard`.

### Git protocol

Clone URLs default to **SSH** (`git@github.com:owner/repo.git`). SSH avoids credential prompts in environments where engineers already have keys configured with GitHub. HTTPS (`https://github.com/owner/repo.git`) is available as an opt-in for CI runners without SSH keys, corporate networks that block port 22, or token-based auth.

**User-facing precedence** (documented in `docs/configuration.md`; merged by `@pulsemcp/air-core`'s `configureProviders` before this provider ever sees a protocol value):
1. `--git-protocol <ssh|https>` CLI flag on `air start` / `air prepare` / `air update`
2. `AIR_GIT_PROTOCOL` environment variable
3. `gitProtocol` field in `air.json`
4. Default: `"ssh"`

**What this provider actually sees.** Merging happens in core; the provider only has two entry points:
1. `configure(options)` — called by core with the already-merged winning value. Overrides whatever the constructor set.
2. Constructor option `gitProtocol`, or `AIR_GIT_PROTOCOL` env var as a fallback when the option is omitted. This path only matters when the provider is instantiated standalone without `configureProviders` running.

### Authentication

- **SSH**: relies on the user's SSH agent / keys. Tokens are ignored.
- **HTTPS**: uses `AIR_GITHUB_TOKEN` (or the `token` constructor option) to inject the token into the clone URL (`https://<token>@github.com/...`). Without a token, only public repos are accessible.

Token values are redacted from error messages before surfacing them.

## Core Principles

### Shell out to `git`, not `gh`
Uses `git` (universally installed) via `execFileSync`. Never depends on the `gh` CLI or a GitHub API client. URI components are strictly validated before being passed as arguments to prevent injection.

### Cache aggressively, invalidate manually
Each `{owner}/{repo}/{ref}` is cloned once and reused. Mutable refs (branches, `HEAD`) are refreshed via `air update`; full-SHA refs are treated as immutable and never refreshed. Users can also delete `~/.air/cache/github/` to force a clean re-clone.

### SSH by default, HTTPS by opt-in
Keep the default ergonomic (no token dance for most engineers) but never force a protocol choice on users who have reasons to prefer the other one.

## What NOT to Do

- Do not add a hard dependency on the `gh` CLI — `git` is sufficient and more portable
- Do not interpolate URI components into shell strings — pass them as argv entries via `execFileSync`
- Do not leak tokens in error messages — run `redactToken()` before rethrowing
- Do not silently swallow clone errors — include the public URL, ref, and `git` stderr in error messages
- Do not change the default protocol without updating the schema description, CHANGELOG, and docs — this is a breaking change for cache paths and CI setup
