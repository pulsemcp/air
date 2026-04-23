import { execFileSync } from "child_process";
import {
  readFileSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
} from "fs";
import { resolve, dirname } from "path";
import {
  getDefaultAirJsonPath,
  detectSchemaType,
  detectSchemaFromValue,
  getAllSchemaTypes,
  type SchemaType,
} from "@pulsemcp/air-core";
import {
  initConfig,
  scaffoldLocalFiles,
  type InitConfigResult,
  type ScaffoldedFile,
} from "./init.js";

/** Artifact types that map to air.json properties (all schema types except "air"). */
const ARTIFACT_TYPES = getAllSchemaTypes().filter(
  (t): t is Exclude<SchemaType, "air"> => t !== "air"
);

/** Error codes for `initFromRepo` failures. */
export type InitFromRepoErrorCode =
  | "EXISTS"
  | "NO_GIT"
  | "NO_REMOTE"
  | "NO_GITHUB"
  | "NO_ARTIFACTS";

/**
 * Typed error thrown by `initFromRepo` for classifiable failure conditions.
 * Consumers can switch on `code` instead of matching error messages.
 */
export class InitFromRepoError extends Error {
  constructor(
    message: string,
    public readonly code: InitFromRepoErrorCode
  ) {
    super(message);
    this.name = "InitFromRepoError";
  }
}

export interface InitFromRepoOptions {
  /** Working directory (must be inside a git repo). Defaults to process.cwd(). */
  cwd?: string;
  /** Path for the generated air.json. Defaults to ~/.air/air.json. */
  path?: string;
  /** Overwrite existing air.json if it exists. */
  force?: boolean;
}

export interface DiscoveredArtifact {
  /** Artifact type (skills, references, mcp, etc.) */
  type: SchemaType;
  /** Path relative to repo root. */
  repoPath: string;
  /** Generated github:// URI. */
  uri: string;
}

export interface InitFromRepoResult {
  /** Absolute path to the created air.json. */
  airJsonPath: string;
  /** Absolute path to the AIR config directory. */
  airDir: string;
  /** GitHub owner/repo detected from git remote. */
  repo: string;
  /** Branch used for github:// URIs. */
  branch: string;
  /** Discovered artifact files grouped by type. */
  discovered: DiscoveredArtifact[];
  /** Whether an existing config was overwritten. */
  overwritten: boolean;
  /** Local index files and README scaffolded into `airDir` alongside the discovered remote URIs. */
  scaffolded: ScaffoldedFile[];
}

/**
 * Get the git repository root directory.
 */
function getRepoRoot(cwd: string): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf-8",
  }).trim();
}

/**
 * Parse a git remote URL and extract the GitHub owner/repo.
 * Supports HTTPS and SSH formats.
 *
 * @returns "owner/repo" string
 * @throws Error if the URL is not a github.com URL
 */
export function parseGitHubRemote(remoteUrl: string): string {
  const trimmed = remoteUrl.trim();

  // SSH: git@github.com:owner/repo.git
  const sshMatch = trimmed.match(/^git@github\.com:(.+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];

  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = trimmed.match(
    /^https?:\/\/github\.com\/(.+?)(?:\.git)?$/
  );
  if (httpsMatch) return httpsMatch[1];

  throw new Error(
    `Could not parse GitHub owner/repo from remote URL: "${trimmed}"\n` +
      `Expected a github.com URL (HTTPS or SSH).`
  );
}

/**
 * Get the git remote URL for the given remote name.
 */
function getRemoteUrl(cwd: string, remote = "origin"): string {
  return execFileSync("git", ["remote", "get-url", remote], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf-8",
  }).trim();
}

/**
 * Detect the default branch name for the remote.
 *
 * Tries `git symbolic-ref refs/remotes/origin/HEAD` first,
 * then checks for common branch names (main, master).
 * Falls back to "main".
 */
export function detectDefaultBranch(cwd: string): string {
  // Try symbolic-ref (works when remote HEAD is set)
  try {
    const ref = execFileSync(
      "git",
      ["symbolic-ref", "refs/remotes/origin/HEAD"],
      {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        encoding: "utf-8",
      }
    ).trim();
    const branch = ref.replace(/^refs\/remotes\/origin\//, "");
    if (branch) return branch;
  } catch {
    // Ignore — try fallbacks
  }

  // Probe common branch names
  for (const branch of ["main", "master"]) {
    try {
      execFileSync("git", ["rev-parse", "--verify", `origin/${branch}`], {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        encoding: "utf-8",
      });
      return branch;
    } catch {
      // continue
    }
  }

  return "main";
}

/**
 * Discover AIR artifact index files in the git repository.
 *
 * Lists tracked JSON files via `git ls-files`, detects their schema type
 * by filename, and confirms they are parseable JSON objects. Returns files
 * that are plausible artifact indexes (full schema validation is deferred
 * to `air validate`).
 */
export function discoverArtifacts(
  repoRoot: string,
  repo: string,
  branch: string
): DiscoveredArtifact[] {
  let output: string;
  try {
    output = execFileSync("git", ["ls-files", "--", "*.json"], {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    }).trim();
  } catch {
    return [];
  }

  if (!output) return [];

  const jsonFiles = output.split("\n").filter(Boolean);
  const discovered: DiscoveredArtifact[] = [];

  for (const file of jsonFiles) {
    // Skip files in node_modules or hidden directories (root or nested)
    if (file.includes("node_modules/") || /(?:^|\/)\./.test(file)) continue;

    const schemaType = detectSchemaType(file);

    // Skip non-artifact files and air.json configs
    if (!schemaType || schemaType === "air") continue;
    if (!ARTIFACT_TYPES.includes(schemaType)) continue;

    // Confirm the file is parseable JSON with object structure.
    // We intentionally do NOT reject files that fail full schema validation,
    // because a single entry with e.g. a too-long description would cause the
    // entire file to be silently skipped from discovery.
    const filePath = resolve(repoRoot, file);
    try {
      const content = readFileSync(filePath, "utf-8");
      const data = JSON.parse(content);
      if (typeof data !== "object" || data === null || Array.isArray(data)) {
        continue;
      }
      // If the file declares a $schema, it must point to a known AIR schema.
      // This rejects JSON Schema definitions, OpenAPI schemas, and any other
      // structured JSON that happens to match an artifact keyword in its filename.
      if (
        typeof data.$schema === "string" &&
        !detectSchemaFromValue(data.$schema)
      ) {
        continue;
      }
    } catch {
      continue;
    }

    discovered.push({
      type: schemaType,
      repoPath: file,
      uri: `github://${repo}@${branch}/${file}`,
    });
  }

  return discovered;
}

/**
 * Initialize an AIR config from artifact files discovered in a git repository.
 *
 * Scans the git repo for artifact index files (skills.json, mcp.json, etc.),
 * detects the GitHub remote, and generates an air.json with github:// URIs
 * pointing to the repository's default branch. Only artifact types that have
 * existing index files in the repo are included — nothing is auto-generated.
 *
 * @throws Error if not in a git repo, no GitHub remote, no artifacts found,
 *         or air.json already exists (unless force is true).
 */
export function initFromRepo(
  options?: InitFromRepoOptions
): InitFromRepoResult {
  const cwd = options?.cwd ?? process.cwd();
  const airJsonPath = options?.path ?? getDefaultAirJsonPath();
  const force = options?.force ?? false;
  const airDir = dirname(airJsonPath);

  // Check for existing config
  const overwritten = existsSync(airJsonPath);
  if (overwritten && !force) {
    throw new InitFromRepoError(
      `${airJsonPath} already exists.`,
      "EXISTS"
    );
  }

  // Get repo root
  let repoRoot: string;
  try {
    repoRoot = getRepoRoot(cwd);
  } catch {
    throw new InitFromRepoError(
      "Not inside a git repository. Run this command from within a git repo " +
        "that contains AIR artifact index files.",
      "NO_GIT"
    );
  }

  // Get GitHub remote
  let remoteUrl: string;
  try {
    remoteUrl = getRemoteUrl(cwd);
  } catch {
    throw new InitFromRepoError(
      "No git remote named 'origin' found. " +
        "Add a GitHub remote with: git remote add origin <url>",
      "NO_REMOTE"
    );
  }

  let repo: string;
  try {
    repo = parseGitHubRemote(remoteUrl);
  } catch (err) {
    throw new InitFromRepoError(
      err instanceof Error ? err.message : String(err),
      "NO_GITHUB"
    );
  }

  const branch = detectDefaultBranch(cwd);
  const discovered = discoverArtifacts(repoRoot, repo, branch);

  if (discovered.length === 0) {
    throw new InitFromRepoError(
      "No AIR artifact index files found in this repository.\n" +
        "Expected files like skills.json, mcp.json, references.json, etc.",
      "NO_ARTIFACTS"
    );
  }

  // Group URIs by artifact type
  const grouped: Partial<Record<SchemaType, string[]>> = {};
  for (const artifact of discovered) {
    if (!grouped[artifact.type]) {
      grouped[artifact.type] = [];
    }
    grouped[artifact.type]!.push(artifact.uri);
  }

  // Derive config name from repo name
  const repoName = repo.split("/")[1] || "my-config";
  const configName = repoName.replace(/[^a-zA-Z0-9_-]/g, "-");

  // Build air.json. Every artifact type gets a local index path so users can
  // compose local entries on top of the discovered remote catalog without
  // editing air.json first. Later entries win by ID, so the local path goes
  // last and overrides the github:// URI.
  const airJson: Record<string, unknown> = {
    name: configName,
    extensions: [
      "@pulsemcp/air-adapter-claude",
      "@pulsemcp/air-provider-github",
      "@pulsemcp/air-secrets-env",
      "@pulsemcp/air-secrets-file",
    ],
  };

  for (const type of ARTIFACT_TYPES) {
    const entries: string[] = [];
    if (grouped[type]) {
      entries.push(...grouped[type]!);
    }
    entries.push(`./${type}/${type}.json`);
    airJson[type] = entries;
  }

  mkdirSync(airDir, { recursive: true });
  writeFileSync(airJsonPath, JSON.stringify(airJson, null, 2) + "\n");
  const scaffolded = scaffoldLocalFiles(airDir);

  return {
    airJsonPath,
    airDir,
    repo,
    branch,
    discovered,
    overwritten,
    scaffolded,
  };
}

/** Result from `smartInit` — discriminated by `mode`. */
export type SmartInitResult =
  | ({ mode: "repo" } & InitFromRepoResult)
  | ({ mode: "blank" } & InitConfigResult);

/**
 * High-level init that tries repo-based discovery first and falls back to
 * blank scaffolding when no git context or artifacts are available.
 *
 * @throws InitFromRepoError with code "EXISTS" if config exists and force is false.
 * @throws Error for unexpected failures.
 */
export function smartInit(options?: InitFromRepoOptions): SmartInitResult {
  const force = options?.force ?? false;

  try {
    const result = initFromRepo(options);
    return { mode: "repo", ...result };
  } catch (err) {
    if (!(err instanceof InitFromRepoError)) throw err;

    // Config already exists — don't silently fall back
    if (err.code === "EXISTS") throw err;

    // Fallback conditions: no git, no remote, non-GitHub remote, no artifacts
    if (force) {
      const targetPath = options?.path ?? getDefaultAirJsonPath();
      if (existsSync(targetPath)) {
        unlinkSync(targetPath);
      }
    }

    const result = initConfig({ path: options?.path });
    return { mode: "blank", ...result };
  }
}
