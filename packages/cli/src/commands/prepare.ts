import { Command } from "commander";
import { execSync } from "child_process";
import { resolve } from "path";
import {
  getAirJsonPath,
  resolveArtifacts,
  type RootEntry,
} from "@pulsemcp/air-core";
import { findAdapter, listAvailableAdapters } from "../adapter-registry.js";

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

export function prepareCommand(): Command {
  const cmd = new Command("prepare")
    .description(
      "Prepare a target directory for an agent session (write .mcp.json, inject skills) without starting the agent"
    )
    .option(
      "--config <path>",
      "Path to air.json (defaults to AIR_CONFIG env or ~/.air/air.json)"
    )
    .option("--root <name>", "Root to activate (auto-detected from cwd when omitted)")
    .option(
      "--target <dir>",
      "Target directory to prepare (defaults to cwd)",
      process.cwd()
    )
    .option(
      "--adapter <name>",
      "Agent adapter to use (e.g., claude)",
      "claude"
    )
    .option(
      "--skills <ids>",
      "Comma-separated skill IDs (overrides root defaults)"
    )
    .option(
      "--mcp-servers <ids>",
      "Comma-separated MCP server IDs (overrides root defaults)"
    )
    .action(
      async (options: {
        config?: string;
        root?: string;
        target: string;
        adapter: string;
        skills?: string;
        mcpServers?: string;
      }) => {
        // Find the adapter
        const adapter = await findAdapter(options.adapter);
        if (!adapter) {
          const available = await listAvailableAdapters();
          const availableMsg =
            available.length > 0
              ? `Available: ${available.join(", ")}`
              : "No adapters installed";
          console.error(
            `Error: No adapter found for "${options.adapter}". ${availableMsg}.`
          );
          process.exit(1);
        }

        // Resolve air.json path
        const airJsonPath = options.config || getAirJsonPath();
        if (!airJsonPath) {
          console.error(
            "Error: No air.json found. Specify --config or set AIR_CONFIG env var."
          );
          process.exit(1);
        }

        // Load and resolve all artifacts
        const artifacts = await resolveArtifacts(airJsonPath);

        // Resolve root: explicit --root, auto-detect, or none
        let root: RootEntry | undefined;
        if (options.root) {
          root = artifacts.roots[options.root];
          if (!root) {
            console.error(
              `Error: Root "${options.root}" not found. Available roots: ${Object.keys(artifacts.roots).join(", ") || "(none)"}`
            );
            process.exit(1);
          }
        } else {
          // Auto-detect from target directory's git context
          const targetDir = resolve(options.target);
          root = detectRoot(artifacts.roots, targetDir);
          if (root) {
            console.error(`Auto-detected root: ${root.name}`);
          }
        }

        // Parse overrides
        const skillOverrides = options.skills
          ? options.skills.split(",").map((s) => s.trim())
          : undefined;
        const mcpServerOverrides = options.mcpServers
          ? options.mcpServers.split(",").map((s) => s.trim())
          : undefined;

        // Prepare the session
        const result = await adapter.prepareSession(
          artifacts,
          options.target,
          {
            root,
            skillOverrides,
            mcpServerOverrides,
          }
        );

        // Output structured JSON to stdout for orchestrator consumption
        console.log(JSON.stringify(result, null, 2));
      }
    );

  return cmd;
}
