import { execFileSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "fs";
import { resolve, dirname } from "path";
import lockfile from "proper-lockfile";
import type {
  CatalogProvider,
  CacheFreshnessWarning,
  CacheRefreshResult,
} from "@pulsemcp/air-core";

export interface GitHubUri {
  owner: string;
  repo: string;
  path: string;
  ref?: string;
}

export type GitProtocol = "ssh" | "https";

export interface GitHubProviderOptions {
  /**
   * GitHub personal access token for authenticating git clone.
   * Required for private repositories over HTTPS. Ignored when
   * `gitProtocol === "ssh"` — SSH uses key-based auth.
   *
   * Can also be set via the AIR_GITHUB_TOKEN environment variable.
   */
  token?: string;
  /**
   * Protocol to use when constructing clone URLs. Defaults to "ssh".
   * SSH (`git@github.com:owner/repo.git`) avoids credential prompts in
   * environments where engineers already have keys configured. Set to
   * "https" for CI without SSH keys, corporate networks that block
   * port 22, or token-based auth via `AIR_GITHUB_TOKEN`.
   *
   * Can also be set via the AIR_GIT_PROTOCOL environment variable or
   * the `gitProtocol` field in air.json. The SDK/CLI is responsible for
   * merging those sources and calling `configure({ gitProtocol })`.
   */
  gitProtocol?: GitProtocol;
}

const DEFAULT_GIT_PROTOCOL: GitProtocol = "ssh";

function normalizeGitProtocol(
  value: unknown,
  fallback: GitProtocol
): GitProtocol {
  if (value === "ssh" || value === "https") return value;
  return fallback;
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
 * Supported formats:
 *   github://owner/repo                                  — whole repo (catalogs)
 *   github://owner/repo@ref                              — whole repo at ref (catalogs)
 *   github://owner/repo/path/to/file.json                — file at default branch
 *   github://owner/repo@ref/path/to/file.json            — file at ref (preferred)
 *   github://owner/repo/path/to/file.json@ref            — legacy ref-on-path syntax
 *   github://owner/repo/path                             — subdirectory (catalogs)
 *   github://owner/repo@ref/path                         — subdirectory at ref (catalogs)
 *
 * The repo-level syntax (owner/repo@ref) is preferred because it clearly
 * separates the repository reference from the file path and avoids ambiguity
 * when file paths contain "@" characters. The path-level syntax is supported
 * for backward compatibility.
 *
 * When used as a catalog root, the path may be empty (whole-repo) or point
 * to any directory. `resolve()` separately validates that the path is
 * non-empty before reading the file.
 *
 * Note: refs containing slashes (e.g., feature/branch) cannot be expressed
 * with the repo-level syntax because the URI is split on "/". Use the legacy
 * path-level syntax for such refs: github://owner/repo/path@feature/branch
 */
export function parseGitHubUri(uri: string): GitHubUri {
  const withoutScheme = uri.replace(/^github:\/\//, "");
  const parts = withoutScheme.split("/");

  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error(
      `Invalid github:// URI: "${uri}". Expected format: github://owner/repo[@ref][/path]`
    );
  }

  const owner = parts[0];
  let repoSegment = parts[1];
  let ref: string | undefined;

  // Extract optional @ref from the repo segment (preferred syntax)
  const repoAtIndex = repoSegment.indexOf("@");
  if (repoAtIndex > 0) {
    ref = repoSegment.slice(repoAtIndex + 1);
    repoSegment = repoSegment.slice(0, repoAtIndex);
    if (ref.length === 0) {
      throw new Error(
        `Empty ref after "@" in github:// URI: "${uri}". ` +
          `Either remove the "@" or specify a ref: github://owner/repo@ref[/path]`
      );
    }
  }

  const repo = repoSegment;
  let filePath = parts.slice(2).join("/");

  // If no ref on repo, check for legacy @ref at the end of the path
  if (!ref && filePath) {
    const pathAtIndex = filePath.lastIndexOf("@");
    if (pathAtIndex > 0) {
      ref = filePath.slice(pathAtIndex + 1);
      filePath = filePath.slice(0, pathAtIndex);
    }
  } else if (ref && filePath) {
    // Repo-level ref already found — reject if path also has @ref (ambiguous)
    const pathAtIndex = filePath.lastIndexOf("@");
    if (pathAtIndex > 0) {
      throw new Error(
        `Ambiguous github:// URI: "${uri}". ` +
          `Ref specified on both repo ("@${ref}") and path. Use only one: github://owner/repo@ref/path`
      );
    }
  }

  // Validate all components to prevent shell injection and path traversal
  validateUriComponent(owner, "owner");
  validateUriComponent(repo, "repo");
  if (ref) validateUriComponent(ref, "ref");
  if (filePath) validateUriComponent(filePath, "path");

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
 * Check whether a ref looks like a full commit SHA (40 hex chars).
 * Full SHAs are immutable and never need freshness checking.
 */
function isImmutableRef(ref: string): boolean {
  return /^[0-9a-f]{40}$/i.test(ref);
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
  private gitProtocol: GitProtocol;

  constructor(options?: GitHubProviderOptions) {
    this.token = options?.token || process.env.AIR_GITHUB_TOKEN;
    this.gitProtocol = normalizeGitProtocol(
      options?.gitProtocol ?? process.env.AIR_GIT_PROTOCOL,
      DEFAULT_GIT_PROTOCOL
    );
  }

  /**
   * Apply runtime options merged from air.json and caller overrides. Called
   * by the SDK before `resolve()` / `refreshCache()` runs. Currently honors
   * `gitProtocol: "ssh" | "https"`; unknown keys are ignored.
   */
  configure(options: Record<string, unknown>): void {
    if (options.gitProtocol !== undefined) {
      this.gitProtocol = normalizeGitProtocol(
        options.gitProtocol,
        this.gitProtocol
      );
    }
  }

  /**
   * Return the effective git protocol in use. Exposed for diagnostics and
   * test verification — not part of the CatalogProvider contract.
   */
  getGitProtocol(): GitProtocol {
    return this.gitProtocol;
  }

  async resolve(
    uri: string,
    _baseDir: string
  ): Promise<Record<string, unknown>> {
    const parsed = parseGitHubUri(uri);
    if (!parsed.path) {
      throw new Error(
        `github:// URI must include a file path: "${uri}". ` +
          `Expected format: github://owner/repo[@ref]/path/to/file.json`
      );
    }
    const ref = parsed.ref || "HEAD";
    const cloneDir = await this.ensureClone(parsed.owner, parsed.repo, ref);
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
   * Return the scope used to qualify artifacts contributed by this URI.
   * AIR canonicalizes every artifact as `@scope/id`; for GitHub the scope
   * is the repository identifier (`owner/repo`), independent of ref or
   * subdirectory — two catalogs at different paths in the same repo
   * contribute to the same scope, and a duplicate qualified ID across
   * those catalogs hard-fails at resolution time.
   */
  getScope(uri: string): string {
    const parsed = parseGitHubUri(uri);
    return `${parsed.owner}/${parsed.repo}`;
  }

  /**
   * Resolve a catalog URI to the local clone directory rooted at the URI's
   * path within the clone. Ensures the repository is cloned (performing a
   * shallow clone on first access) before returning. Core then walks the
   * returned directory to discover artifact index files.
   *
   * For a URI like `github://owner/repo@ref/agents`, this returns the
   * absolute path to `<cloneDir>/agents`.
   */
  async resolveCatalogDir(uri: string): Promise<string> {
    const parsed = parseGitHubUri(uri);
    const ref = parsed.ref || "HEAD";
    const cloneDir = await this.ensureClone(parsed.owner, parsed.repo, ref);
    const catalogDir = resolve(cloneDir, parsed.path);
    if (!existsSync(catalogDir)) {
      throw new Error(
        `Catalog path not found in cloned repository: ${parsed.path}\n` +
          `  Repository: ${parsed.owner}/${parsed.repo}\n` +
          `  Ref: ${ref}\n` +
          `  Clone path: ${cloneDir}`
      );
    }
    return catalogDir;
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
   * Check freshness of cached clones for the given URIs.
   * Compares local HEAD SHA against remote for mutable refs.
   * Skips URIs with no local clone or immutable refs (full SHAs).
   */
  async checkFreshness(uris: string[]): Promise<CacheFreshnessWarning[]> {
    // De-duplicate by owner/repo/ref so we only check each clone once
    const seen = new Map<string, string>(); // cacheKey → first URI
    const toCheck: { owner: string; repo: string; ref: string; uri: string }[] = [];

    for (const uri of uris) {
      const parsed = parseGitHubUri(uri);
      const ref = parsed.ref || "HEAD";
      const key = `${parsed.owner}/${parsed.repo}/${ref}`;
      if (seen.has(key)) continue;
      seen.set(key, uri);
      toCheck.push({ owner: parsed.owner, repo: parsed.repo, ref, uri });
    }

    const warnings: CacheFreshnessWarning[] = [];

    for (const { owner, repo, ref, uri } of toCheck) {
      if (isImmutableRef(ref)) continue;

      const cloneDir = getClonePath(owner, repo, ref);
      if (!existsSync(resolve(cloneDir, ".git"))) continue;

      try {
        const localSha = execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: cloneDir,
          encoding: "utf-8",
          stdio: "pipe",
          timeout: 10000,
        }).trim();

        const lsRemoteArgs = ref === "HEAD"
          ? ["ls-remote", "origin", "HEAD"]
          : ["ls-remote", "origin", ref];
        const lsOutput = execFileSync("git", lsRemoteArgs, {
          cwd: cloneDir,
          encoding: "utf-8",
          stdio: "pipe",
          timeout: 15000,
        }).trim();

        if (!lsOutput) continue;

        // ls-remote output: "<sha>\t<refname>" — take first line's SHA
        const remoteSha = lsOutput.split("\n")[0].split("\t")[0];
        if (remoteSha && remoteSha !== localSha) {
          warnings.push({
            uri,
            message:
              `github://${owner}/${repo}@${ref} is behind remote. ` +
              `Run \`air update\` to refresh.`,
          });
        }
      } catch {
        // Network failure, auth issue, etc. — skip silently
      }
    }

    return warnings;
  }

  /**
   * Refresh all cached GitHub clones.
   * Walks ~/.air/cache/github/ and updates each mutable-ref clone.
   */
  async refreshCache(): Promise<CacheRefreshResult[]> {
    const cacheDir = getCacheDir();
    if (!existsSync(cacheDir)) return [];

    const results: CacheRefreshResult[] = [];

    // Walk owner/repo/ref directories
    let owners: string[];
    try {
      owners = readdirSync(cacheDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      return [];
    }

    for (const owner of owners) {
      const ownerDir = resolve(cacheDir, owner);
      let repos: string[];
      try {
        repos = readdirSync(ownerDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name);
      } catch {
        continue;
      }

      for (const repo of repos) {
        const repoDir = resolve(ownerDir, repo);
        let refs: string[];
        try {
          refs = readdirSync(repoDir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);
        } catch {
          continue;
        }

        for (const ref of refs) {
          const label = `${owner}/${repo}@${ref}`;
          const cloneDir = resolve(repoDir, ref);

          if (!existsSync(resolve(cloneDir, ".git"))) continue;

          if (isImmutableRef(ref)) {
            results.push({ label, updated: false, message: "skipped (immutable ref)" });
            continue;
          }

          try {
            // Get current SHA before fetch
            const beforeSha = execFileSync("git", ["rev-parse", "HEAD"], {
              cwd: cloneDir,
              encoding: "utf-8",
              stdio: "pipe",
              timeout: 10000,
            }).trim();

            // Fetch latest
            const fetchArgs = ref === "HEAD"
              ? ["fetch", "--depth", "1", "origin"]
              : ["fetch", "--depth", "1", "origin", ref];
            execFileSync("git", fetchArgs, {
              cwd: cloneDir,
              stdio: "pipe",
              timeout: 60000,
            });

            // Reset to fetched commit
            const resetRef = ref === "HEAD" ? "origin/HEAD" : "FETCH_HEAD";
            execFileSync("git", ["reset", "--hard", resetRef], {
              cwd: cloneDir,
              stdio: "pipe",
              timeout: 10000,
            });

            const afterSha = execFileSync("git", ["rev-parse", "HEAD"], {
              cwd: cloneDir,
              encoding: "utf-8",
              stdio: "pipe",
              timeout: 10000,
            }).trim();

            if (afterSha !== beforeSha) {
              results.push({
                label,
                updated: true,
                message: `updated ${beforeSha.slice(0, 7)} → ${afterSha.slice(0, 7)}`,
              });
            } else {
              results.push({ label, updated: false, message: "already up-to-date" });
            }
          } catch (err) {
            const rawMsg = err instanceof Error ? err.message : String(err);
            const msg = redactToken(rawMsg, this.token);
            results.push({ label, updated: false, message: `failed: ${msg}` });
          }
        }
      }
    }

    return results;
  }

  /**
   * Ensure the repository is cloned locally. Concurrent callers are
   * serialized by an advisory file lock and the clone itself lands via
   * a temp-dir-then-rename dance — so readers either see no `.git` and
   * trigger their own clone, or a complete clone, never a partial one.
   *
   * Returns the path to the clone directory.
   */
  private async ensureClone(
    owner: string,
    repo: string,
    ref: string
  ): Promise<string> {
    const cloneDir = getClonePath(owner, repo, ref);

    // Fast path: a fully-populated clone already exists. Because clones
    // land via tmp-dir-then-rename, the presence of `.git` implies the
    // working tree is complete.
    if (existsSync(resolve(cloneDir, ".git"))) {
      return cloneDir;
    }

    // Make sure the parent directory exists so the lock file has a home.
    mkdirSync(dirname(cloneDir), { recursive: true });

    // Serialize check-and-clone across processes. `realpath: false` lets us
    // lock a path that does not yet exist — proper-lockfile creates a
    // sibling `.lock` directory as the cross-process mutex.
    const release = await lockfile.lock(cloneDir, {
      realpath: false,
      // Wait up to ~2 minutes (480 × 250 ms) for another process to finish
      // cloning. With factor: 1, each retry sleeps minTimeout — the exponential
      // backoff is disabled so waits stay predictable and tight.
      retries: {
        retries: 480,
        minTimeout: 250,
        maxTimeout: 1000,
        factor: 1,
      },
      // Reclaim the lock if the holder crashed and never released it.
      // Significantly longer than the clone timeout below so we don't steal
      // from a slow-but-healthy clone, even on a sluggish filesystem where
      // proper-lockfile's mtime refresh (every stale/2) might lag.
      stale: 180_000,
    });

    try {
      // Re-check under the lock: another process may have won the race.
      if (existsSync(resolve(cloneDir, ".git"))) {
        return cloneDir;
      }

      // Clean up any debris from a crashed clone (e.g., a partial cloneDir
      // left behind by an older version of this code). Safe because we
      // hold the lock.
      if (existsSync(cloneDir)) {
        rmSync(cloneDir, { recursive: true, force: true });
      }

      const repoUrl = this.buildCloneUrl(owner, repo);
      const publicUrl = this.buildPublicUrl(owner, repo);
      // Sibling of cloneDir so the final renameSync is a same-directory
      // rename — atomic on local filesystems (ext4, xfs, apfs, ntfs).
      // mkdtempSync guarantees a unique suffix even if two clones in the
      // same process hit the same millisecond.
      const tmpDir = mkdtempSync(`${cloneDir}.tmp-`);

      try {
        // git clone refuses a non-empty target; mkdtempSync gave us an
        // empty directory which git accepts.
        const args =
          ref === "HEAD"
            ? ["clone", "--depth", "1", repoUrl, tmpDir]
            : ["clone", "--depth", "1", "--branch", ref, repoUrl, tmpDir];

        execFileSync("git", args, { stdio: "pipe", timeout: 60_000 });

        // Atomic publish: readers only ever see a complete clone at
        // cloneDir, never a half-populated one.
        renameSync(tmpDir, cloneDir);
      } catch (err) {
        // Best-effort cleanup of the partial tmp dir so it does not pile up.
        if (existsSync(tmpDir)) {
          try {
            rmSync(tmpDir, { recursive: true, force: true });
          } catch {
            // ignore — the clone itself is the error worth reporting
          }
        }

        const rawMsg = err instanceof Error ? err.message : String(err);
        const msg = redactToken(rawMsg, this.token);
        const authHint =
          this.gitProtocol === "ssh"
            ? " (SSH auth failed — ensure a key is registered with GitHub, " +
              'or switch to HTTPS: set "gitProtocol": "https" in air.json or pass --git-protocol=https)'
            : " (repository may be private — set AIR_GITHUB_TOKEN or pass token option)";
        const hint =
          msg.includes("Authentication failed") ||
          msg.includes("could not read Username") ||
          msg.includes("Permission denied") ||
          msg.includes("publickey")
            ? authHint
            : msg.includes("not found") || msg.includes("Repository not found")
              ? " (repository or ref not found)"
              : "";
        throw new Error(
          `Failed to clone ${owner}/${repo} at ref "${ref}"${hint}\n` +
            `  URL: ${publicUrl}\n` +
            `  Error: ${msg}`
        );
      }
    } finally {
      try {
        await release();
      } catch {
        // release() can throw if proper-lockfile detected the lock was
        // compromised (e.g., stale-reclaimed by another process). The clone
        // itself has already been atomically published via renameSync, so
        // there is nothing to clean up.
      }
    }

    return cloneDir;
  }

  /**
   * Build the clone URL used to invoke `git clone`. Respects the configured
   * `gitProtocol`. When protocol is HTTPS and a token is available, the
   * token is injected into the URL for authentication; SSH ignores the
   * token and relies on the user's configured SSH keys.
   *
   * Exposed (non-private) for diagnostic and test use.
   */
  buildCloneUrl(owner: string, repo: string): string {
    if (this.gitProtocol === "ssh") {
      return `git@github.com:${owner}/${repo}.git`;
    }
    if (this.token) {
      return `https://${this.token}@github.com/${owner}/${repo}.git`;
    }
    return `https://github.com/${owner}/${repo}.git`;
  }

  /**
   * Return a public, shareable URL for error messages. This always uses
   * the protocol in effect but never embeds a token.
   */
  private buildPublicUrl(owner: string, repo: string): string {
    if (this.gitProtocol === "ssh") {
      return `git@github.com:${owner}/${repo}.git`;
    }
    return `https://github.com/${owner}/${repo}.git`;
  }
}
