# @pulsemcp/air-provider-github

AIR catalog provider for GitHub. Resolves `github://` URIs in `air.json` by shallow-cloning the repository locally (via `git`) and reading files out of the clone. Clones are cached at `~/.air/cache/github/{owner}/{repo}/{ref}/`.

## Folder Hierarchy

```
packages/extensions/provider-github/
├── src/
│   ├── index.ts            # AirExtension default export + re-exports
│   ├── git.ts              # bounded/retried git invocation primitives
│   └── github-provider.ts  # GitHubCatalogProvider class, URI parser, clone/cache logic
├── tests/
│   ├── github-provider.test.ts  # URI parsing, cache paths, clone integration
│   ├── concurrency.test.ts      # clone-race serialization, atomic publish
│   ├── ttl-refresh.test.ts      # mutable-ref TTL refresh vs. immutable short-circuit
│   └── git.test.ts              # runBounded / withGitRetry primitives
└── package.json
```

## Domain Context

This package implements the `CatalogProvider` interface from `@pulsemcp/air-core`. It handles `github://owner/repo[@ref]/path/to/file.json` URIs by shelling out to `git clone --depth 1` (via the bounded/retried `runGit` in `git.ts`) and then reading the requested file from the local clone. Cache refresh uses `git fetch --depth 1` + `git reset --hard`.

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
Uses `git` (universally installed) via `runGit`. Never depends on the `gh` CLI or a GitHub API client. URI components are strictly validated before being passed as arguments to prevent injection.

### Cache aggressively, but bound reuse by whether the ref can move
Each `{owner}/{repo}/{ref}` is cloned once and reused. Full-SHA refs are content-addressed, so the clone is correct forever and `ensureClone` short-circuits unconditionally. Mutable refs (`HEAD`, branch names) can move upstream, so reuse is bounded by a TTL (`DEFAULT_MUTABLE_REF_TTL_MS`, 5 minutes, overridable with `AIR_GIT_CACHE_TTL_MS`): past the TTL the next read fetches and hard-resets the clone before serving it. `air update` (`refreshCache()`) refreshes everything immediately regardless of TTL, and users can delete `~/.air/cache/github/` to force a clean re-clone.

The TTL clock is a stamp file at `<clone>/.git/air-last-fetch`, written before every fetch. It lives under `.git` so core's working-tree walk never sees it and `git reset --hard` never deletes it, and it records the last *attempt* so a failing remote costs one bounded git call per TTL window rather than one per resolve.

### One lock, one mutation path
Every mutation of a cache entry — the initial clone, the TTL refresh, and `air update`'s refresh — goes through `withCloneLock()` on the same `${cloneDir}.lock`, and every fetch+reset goes through the single `fetchAndReset()` helper. That is what makes "a refresh can never interleave with another process's clone" true by construction rather than by inspection. The lock is a filesystem mutex and is **not reentrant**: never call a locking method from inside a locked section.

`checkFreshness()` is the deliberate exception — it is a read-only report the SDK calls to surface warnings, and it stays that way. A function named "check" that hard-reset working trees would be a trap.

### SSH by default, HTTPS by opt-in
Keep the default ergonomic (no token dance for most engineers) but never force a protocol choice on users who have reasons to prefer the other one.

## What NOT to Do

- Do not add a hard dependency on the `gh` CLI — `git` is sufficient and more portable
- Do not interpolate URI components into shell strings — pass them as argv entries to `runGit`
- Do not leak tokens in error messages — run `redactToken()` before rethrowing
- Do not silently swallow clone errors — include the public URL, ref, and `git` stderr in error messages
- Do not fail a `resolve()` because a *refresh* failed — the cached clone is still usable; warn and serve it
- Do not add a second lock, a second fetch+reset, or a second freshness clock — extend `withCloneLock()` / `fetchAndReset()` / the stamp instead
- Do not change the default protocol without updating the schema description, CHANGELOG, and docs — this is a breaking change for cache paths and CI setup
