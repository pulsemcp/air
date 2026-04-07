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

Fetched files are cached locally at `~/.air/cache/github/{owner}/{repo}/{ref}/{path}`. Delete the cache directory to force a re-fetch.
