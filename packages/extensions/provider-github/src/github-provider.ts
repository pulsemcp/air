import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import type { CatalogProvider } from "@pulsemcp/air-core";

export interface GitHubUri {
  owner: string;
  repo: string;
  path: string;
  ref?: string;
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
 * file content from GitHub repositories using the gh CLI.
 */
export class GitHubCatalogProvider implements CatalogProvider {
  scheme = "github";

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

    // Fetch via gh CLI
    const repoSlug = `${parsed.owner}/${parsed.repo}`;
    const ghRef = parsed.ref ? `--ref ${parsed.ref}` : "";
    const cmd = `gh api repos/${repoSlug}/contents/${parsed.path} ${ghRef} --jq '.content' | base64 -d`;

    let content: string;
    try {
      content = execSync(cmd, {
        stdio: ["pipe", "pipe", "pipe"],
        encoding: "utf-8",
      }).trim();
    } catch (err) {
      throw new Error(
        `Failed to fetch ${uri} via GitHub API. ` +
          `Ensure 'gh' CLI is installed and authenticated.\n` +
          `  Repository: ${repoSlug}\n` +
          `  Path: ${parsed.path}\n` +
          (err instanceof Error ? `  Error: ${err.message}` : "")
      );
    }

    // Write to cache
    const cacheFileDir = resolve(cachePath, "..");
    mkdirSync(cacheFileDir, { recursive: true });
    const { writeFileSync } = await import("fs");
    writeFileSync(cachePath, content);

    return JSON.parse(content);
  }
}
