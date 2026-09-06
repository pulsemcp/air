# @pulsemcp/air-provider-github

AIR catalog provider for GitHub. Resolves `github://` URIs in `air.json` by fetching file content from the GitHub REST API.

## Installation

```bash
npm install @pulsemcp/air-provider-github
```

## Usage

### In air.json

Reference remote artifact indexes using `github://` URIs:

```json
{
  "name": "my-team",
  "skills": [
    "github://acme/air-org/skills/skills.json",
    "./skills/skills.json"
  ],
  "mcp": [
    "github://acme/air-org/mcp/mcp.json",
    "./mcp/mcp.json"
  ]
}
```

### Programmatic

```typescript
import { resolveArtifacts } from "@pulsemcp/air-core";
import { GitHubCatalogProvider } from "@pulsemcp/air-provider-github";

const provider = new GitHubCatalogProvider();
// Or with a token for private repos:
// const provider = new GitHubCatalogProvider({ token: "ghp_..." });

const artifacts = await resolveArtifacts("./air.json", {
  providers: [provider],
});
```

## URI Format

```
github://owner/repo/path/to/file.json
github://owner/repo@ref/path/to/file.json
```

| Component | Description |
|-----------|-------------|
| `owner` | GitHub organization or user |
| `repo` | Repository name |
| `@ref` | Optional git ref (branch, tag, commit SHA) — appended to the repo name |
| `path` | Path to the JSON file within the repo |

Examples:
- `github://acme/air-org/skills/skills.json` — latest from default branch
- `github://acme/air-org@v1.0.0/mcp/mcp.json` — pinned to a tag
- `github://acme/air-org@main/mcp/mcp.json` — explicit branch
- `github://acme/air-org@abc123/mcp/mcp.json` — pinned to a commit SHA
- `github://acme/air-org/mcp/mcp.json@feature/branch` — ref with slashes (use legacy syntax)

The legacy syntax `github://owner/repo/path@ref` (ref at end of path) is also supported for backward compatibility.

> **Note:** Refs containing slashes (e.g., `feature/branch`) cannot be expressed with the repo-level `@ref` syntax because the URI is split on `/`. Use the legacy path-level syntax for such refs.

## Authentication

| Scenario | Auth Required? | How |
|----------|---------------|-----|
| Public repository | No | Works out of the box |
| Private repository | Yes | Set `AIR_GITHUB_TOKEN` env var or pass `token` option |
| Higher rate limits | Optional | Authenticated requests get 5,000 req/hr vs 60 |

```bash
export AIR_GITHUB_TOKEN=ghp_your_token_here
```

## Caching

Fetched files are cached locally at `~/.air/cache/github/{owner}/{repo}/{ref}/{path}`.

How long a cache entry is reused depends on whether the ref can move:

| Ref | Reuse | Why |
|-----|-------|-----|
| Full commit SHA (40 hex chars) | Forever | Content-addressed — it can never change upstream |
| `HEAD`, a branch name, or a tag | Up to 5 minutes | The ref can move, so the clone is re-fetched once it goes stale |

Tags count as mutable: git tags can be force-moved, and a moved tag served forever is exactly the staleness this TTL exists to fix. The cost is one cheap `git fetch` per TTL window — the working tree is left untouched when the ref has not actually moved. Pin a full commit SHA if you want zero network traffic after the first clone.

When a mutable-ref clone is past its TTL, the next `resolve()` runs `git fetch --depth 1` on it (under the same lock that serializes clones), and hard-resets it **only if the remote has actually moved**, before serving it — so a long-running process picks up commits pushed after it started. The refresh is best-effort: if the fetch fails (offline, expired auth), the cached clone is served with a warning rather than failing the resolve, and the next attempt is deferred for one TTL window.

Set `AIR_GIT_CACHE_TTL_MS` to tune the window — `0` re-checks on every resolve, a large value effectively pins the cache. `air update` refreshes every cached mutable-ref clone immediately regardless of TTL, and deleting the cache directory forces a clean re-clone.
