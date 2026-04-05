import { execSync } from "child_process";
import type { RootEntry } from "@pulsemcp/air-core";

/**
 * Normalize a git remote URL to a comparable form: "github.com/owner/repo"
 * Handles HTTPS, SSH (git@), and trailing .git.
 */
export function normalizeGitUrl(url: string): string {
  let normalized = url.trim();

  // SSH format: git@github.com:owner/repo.git → github.com/owner/repo
  const sshMatch = normalized.match(/^git@([^:]+):(.+)$/);
  if (sshMatch) {
    normalized = `${sshMatch[1]}/${sshMatch[2]}`;
  } else {
    // HTTPS format: https://github.com/owner/repo.git → github.com/owner/repo
    normalized = normalized.replace(/^https?:\/\//, "");
  }

  // Strip trailing .git
  normalized = normalized.replace(/\.git$/, "");
  // Strip trailing slash
  normalized = normalized.replace(/\/$/, "");

  return normalized;
}

/**
 * Detect which root matches the current git repository and subdirectory.
 *
 * Algorithm:
 * 1. Get the git remote URL and relative subdirectory from targetDir
 * 2. Normalize the URL and compare against all root URLs
 * 3. Among roots with matching URLs, pick the best subdirectory match:
 *    - Exact match (root.subdirectory === current subdirectory)
 *    - Longest prefix match
 *    - Root-level (no subdirectory / empty subdirectory)
 */
export function detectRoot(
  roots: Record<string, RootEntry>,
  targetDir: string
): RootEntry | undefined {
  let remoteUrl: string;
  let relativeDir: string;

  try {
    remoteUrl = execSync("git remote get-url origin", {
      cwd: targetDir,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    }).trim();
  } catch {
    // Not in a git repo or no remote — can't auto-detect
    return undefined;
  }

  try {
    relativeDir = execSync("git rev-parse --show-prefix", {
      cwd: targetDir,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    }).trim();
    // Remove trailing slash
    relativeDir = relativeDir.replace(/\/$/, "");
  } catch {
    relativeDir = "";
  }

  const normalizedRemote = normalizeGitUrl(remoteUrl);

  // Find all roots whose URL matches this repo
  const matchingRoots: RootEntry[] = [];
  for (const root of Object.values(roots)) {
    if (!root.url) continue;
    const normalizedRootUrl = normalizeGitUrl(root.url);
    if (normalizedRemote === normalizedRootUrl) {
      matchingRoots.push(root);
    }
  }

  if (matchingRoots.length === 0) return undefined;

  // Find best subdirectory match
  // Priority: exact match → longest prefix → root-level (no/empty subdirectory)
  const rootSubdir = (r: RootEntry) => (r.subdirectory || "").replace(/\/$/, "");

  // 1. Exact match
  const exact = matchingRoots.find((r) => rootSubdir(r) === relativeDir);
  if (exact) return exact;

  // 2. Longest prefix match (current dir is within root's subdirectory)
  const prefixMatches = matchingRoots
    .filter((r) => {
      const sub = rootSubdir(r);
      if (!sub) return false;
      return relativeDir.startsWith(sub + "/") || relativeDir === sub;
    })
    .sort((a, b) => rootSubdir(b).length - rootSubdir(a).length);

  if (prefixMatches.length > 0) return prefixMatches[0];

  // 3. Root-level fallback (root with no subdirectory)
  const rootLevel = matchingRoots.find((r) => !rootSubdir(r));
  if (rootLevel) return rootLevel;

  // 4. Any matching root as last resort
  return matchingRoots[0];
}
