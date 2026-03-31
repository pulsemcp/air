# @pulsemcp/air-provider-github

AIR catalog provider for GitHub. Resolves `github://` URIs in `air.json` by fetching file content from the GitHub REST API using Node's built-in `fetch()`.

## Folder Hierarchy

```
packages/extensions/provider-github/
├── src/
│   ├── index.ts            # AirExtension default export + re-exports
│   └── github-provider.ts  # GitHubCatalogProvider class, URI parser, cache logic
├── tests/
│   └── github-provider.test.ts  # URI parsing, cache paths, API integration
└── package.json
```

## Domain Context

This package implements the `CatalogProvider` interface from `@pulsemcp/air-core`. It handles `github://owner/repo/path/to/file.json` URIs by calling `GET /repos/{owner}/{repo}/contents/{path}` on the GitHub REST API, decoding the base64 response, and caching the result locally at `~/.air/cache/github/`.

Works without authentication for public repos. For private repos or higher rate limits, set `AIR_GITHUB_TOKEN` or pass a `token` option to the constructor.

## Core Principles

### No external CLI dependencies
Uses Node's built-in `fetch()` — no `gh` CLI, no `git` commands, no npm packages beyond `@pulsemcp/air-core`.

### Cache aggressively, invalidate manually
Fetched files are cached by `{owner}/{repo}/{ref}/{path}`. There is no automatic cache invalidation — users delete `~/.air/cache/github/` to force re-fetch.

## What NOT to Do

- Do not shell out to `gh` or `git` — use the REST API via `fetch()`
- Do not require authentication for public repos
- Do not silently swallow API errors — include the HTTP status, repo, and path in error messages
