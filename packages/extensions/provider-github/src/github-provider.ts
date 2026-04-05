import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import type { CatalogProvider } from "@pulsemcp/air-core";

export interface GitHubUri {
  owner: string;
  repo: string;
  path: string;
  ref?: string;
}

export interface GitHubProviderOptions {
  /**
   * GitHub personal access token for authenticating git clone.
   * Required for private repositories. Optional for public repos.
   *
   * Can also be set via the AIR_GITHUB_TOKEN environment variable.
   */
  token?: string;
}

/**
 * Validate that a URI component contains only safe characters.
 * Prevents path traversal and shell injection via owner/repo/ref values.
 */
function validateUriComponent(value: string, label: string): void {
  // Allow alphanumeric, hyphens, dots, underscores, forward slashes (for paths)
  if (!/^[a-zA-Z0-9._\-/]+$/.test(value)) {
    throw new Error(
      `Invalid ${label} in github:// URI: "${value}". ` +
        `Only alphanumeric characters, hyphens, dots, underscores, and forward slashes are allowed.`
    );
  }
  // Prevent path traversal
  if (value.includes("..")) {
    throw new Error(
      `Invalid ${label} in github:// URI: "${value}". Path traversal ("..") is not allowed.`
    );
  }
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

  // Validate all components to prevent shell injection and path traversal
  validateUriComponent(owner, "owner");
  validateUriComponent(repo, "repo");
  if (ref) validateUriComponent(ref, "ref");
  validateUriComponent(filePath, "path");

  return { owner, repo, path: filePath, ref };
}

/**
 * Get the local cache directory for GitHub clones.
 */
export function getCacheDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "~";
  return resolve(home, ".air", "cache", "github");
}

/**
 * Get the clone path for a specific owner/repo/ref combination.
 */
export function getClonePath(owner: string, repo: string, ref: string): string {
  return resolve(getCacheDir(), owner, repo, ref);
}

/**
 * Redact tokens from a string to prevent leaking credentials in logs.
 */
function redactToken(text: string, token?: string): string {
  if (!token) return text;
  return text.replaceAll(token, "***");
}

/**
 * GitHub catalog provider — resolves github:// URIs by cloning the
 * repository locally (shallow clone) and reading files from the clone.
 *
 * Clones are cached at ~/.air/cache/github/{owner}/{repo}/{ref}/.
 * Subsequent resolves for the same repo+ref reuse the existing clone.
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
    const cloneDir = this.ensureClone(parsed.owner, parsed.repo, ref);
    const filePath = resolve(cloneDir, parsed.path);

    if (!existsSync(filePath)) {
      throw new Error(
        `File not found in cloned repository: ${parsed.path}\n` +
          `  Repository: ${parsed.owner}/${parsed.repo}\n` +
          `  Ref: ${ref}\n` +
          `  Clone path: ${cloneDir}`
      );
    }

    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  }

  /**
   * Return the local clone directory for a given github:// URI.
   * This allows loadAndMerge to resolve relative path/file fields
   * in artifact entries to absolute paths within the clone.
   */
  resolveSourceDir(uri: string): string | undefined {
    const parsed = parseGitHubUri(uri);
    const ref = parsed.ref || "HEAD";
    const cloneDir = getClonePath(parsed.owner, parsed.repo, ref);

    // Return the directory containing the resolved file within the clone,
    // so relative paths in the artifact index resolve correctly.
    const filePath = resolve(cloneDir, parsed.path);
    const sourceDir = dirname(filePath);

    // Only return if the clone already exists (resolve() should be called first)
    if (existsSync(cloneDir)) {
      return sourceDir;
    }
    return undefined;
  }

  /**
   * Ensure the repository is cloned locally. If the clone already exists,
   * reuse it. Returns the path to the clone directory.
   */
  private ensureClone(owner: string, repo: string, ref: string): string {
    const cloneDir = getClonePath(owner, repo, ref);

    if (existsSync(resolve(cloneDir, ".git"))) {
      return cloneDir;
    }

    const repoUrl = this.buildCloneUrl(owner, repo);
    const publicUrl = `https://github.com/${owner}/${repo}.git`;

    try {
      const args = ref === "HEAD"
        ? ["clone", "--depth", "1", repoUrl, cloneDir]
        : ["clone", "--depth", "1", "--branch", ref, repoUrl, cloneDir];

      execFileSync("git", args, { stdio: "pipe", timeout: 60000 });
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      const msg = redactToken(rawMsg, this.token);
      const hint = msg.includes("Authentication failed") || msg.includes("could not read Username")
        ? " (repository may be private — set AIR_GITHUB_TOKEN or pass token option)"
        : msg.includes("not found")
          ? " (repository or ref not found)"
          : "";
      throw new Error(
        `Failed to clone ${owner}/${repo} at ref "${ref}"${hint}\n` +
          `  URL: ${publicUrl}\n` +
          `  Error: ${msg}`
      );
    }

    return cloneDir;
  }

  /**
   * Build the clone URL, injecting token for authentication if available.
   */
  private buildCloneUrl(owner: string, repo: string): string {
    if (this.token) {
      return `https://${this.token}@github.com/${owner}/${repo}.git`;
    }
    return `https://github.com/${owner}/${repo}.git`;
  }
}
