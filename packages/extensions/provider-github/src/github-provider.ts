import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import type { CatalogProvider } from "@pulsemcp/air-core";

export interface GitHubUri {
  owner: string;
  repo: string;
  path: string;
  ref?: string;
}

export interface GitHubProviderOptions {
  /**
   * GitHub personal access token for authenticating API requests.
   * Required for private repositories. Optional for public repos
   * (unauthenticated requests have lower rate limits).
   *
   * Can also be set via the AIR_GITHUB_TOKEN environment variable.
   */
  token?: string;
}

/**
 * Parse a github:// URI into its components.
 *
 * Format: github://owner/repo/path/to/file.json
 * With ref: github://owner/repo/path/to/file.json@ref
 */
export function parseGitHubUri(uri: string): GitHubUri {
  const withoutScheme = uri.replace(/^github:\/\//, "");
  const parts = withoutScheme.split("/");

  if (parts.length < 3) {
    throw new Error(
      `Invalid github:// URI: "${uri}". Expected format: github://owner/repo/path/to/file.json`
    );
  }

  const owner = parts[0];
  const repo = parts[1];
  let filePath = parts.slice(2).join("/");

  // Extract optional @ref from the last segment
  let ref: string | undefined;
  const atIndex = filePath.lastIndexOf("@");
  if (atIndex > 0) {
    ref = filePath.slice(atIndex + 1);
    filePath = filePath.slice(0, atIndex);
  }

  return { owner, repo, path: filePath, ref };
}

/**
 * Get the local cache directory for GitHub content.
 */
export function getCacheDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "~";
  return resolve(home, ".air", "cache", "github");
}

/**
 * GitHub catalog provider — resolves github:// URIs by fetching
 * file content from the GitHub REST API.
 *
 * Works without authentication for public repositories. Pass a token
 * (or set AIR_GITHUB_TOKEN) for private repos or higher rate limits.
 */
export class GitHubCatalogProvider implements CatalogProvider {
  scheme = "github";
  private token: string | undefined;

  constructor(options?: GitHubProviderOptions) {
    this.token = options?.token || process.env.AIR_GITHUB_TOKEN;
  }

  async resolve(
    uri: string,
    _baseDir: string
  ): Promise<Record<string, unknown>> {
    const parsed = parseGitHubUri(uri);
    const ref = parsed.ref || "HEAD";
    const cacheDir = getCacheDir();
    const cacheKey = `${parsed.owner}/${parsed.repo}/${ref}/${parsed.path}`;
    const cachePath = resolve(cacheDir, cacheKey);

    // Check cache first
    if (existsSync(cachePath)) {
      const content = readFileSync(cachePath, "utf-8");
      return JSON.parse(content);
    }

    const content = await this.fetchFromGitHub(parsed);

    // Write to cache
    const cacheFileDir = resolve(cachePath, "..");
    mkdirSync(cacheFileDir, { recursive: true });
    writeFileSync(cachePath, content);

    return JSON.parse(content);
  }

  private async fetchFromGitHub(parsed: GitHubUri): Promise<string> {
    const repoSlug = `${parsed.owner}/${parsed.repo}`;
    let url = `https://api.github.com/repos/${repoSlug}/contents/${parsed.path}`;
    if (parsed.ref) {
      url += `?ref=${encodeURIComponent(parsed.ref)}`;
    }

    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "air-provider-github",
    };
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    let response: Response;
    try {
      response = await fetch(url, { headers });
    } catch (err) {
      throw new Error(
        `Network error fetching ${url}.\n` +
          (err instanceof Error ? `  Error: ${err.message}` : "")
      );
    }

    if (!response.ok) {
      const hint =
        response.status === 404
          ? " (repository may be private — set AIR_GITHUB_TOKEN or pass token option)"
          : response.status === 403
            ? " (rate limit exceeded — set AIR_GITHUB_TOKEN for higher limits)"
            : "";
      throw new Error(
        `GitHub API returned ${response.status} for ${url}${hint}\n` +
          `  Repository: ${repoSlug}\n` +
          `  Path: ${parsed.path}`
      );
    }

    const data = (await response.json()) as { content?: string; encoding?: string };

    if (!data.content || data.encoding !== "base64") {
      throw new Error(
        `Unexpected response format from GitHub API for ${url}.\n` +
          `  Expected base64-encoded content, got encoding="${data.encoding}".`
      );
    }

    return Buffer.from(data.content, "base64").toString("utf-8");
  }
}
