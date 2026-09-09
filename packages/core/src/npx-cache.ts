import { spawnSync } from "child_process";
import type { McpServerEntry } from "./types.js";

/**
 * npx installs each distinct package-spec set into a shared, content-addressed
 * directory: `<npm cache>/_npx/<hash>`, where `<hash>` is derived from the
 * sorted package specs alone. Two MCP servers whose launch commands resolve to
 * the same specs therefore target the *same* directory, even when they differ
 * in every other way (env vars, server name, extra CLI args).
 *
 * When an agent starts those servers concurrently against a cold cache, two
 * `npm install`s reify the same tree at once and one process rmdir's a
 * directory the other is still writing:
 *
 *   npm error code ENOTEMPTY
 *   npm error syscall rmdir
 *   npm error path .../_npx/dbbb2997d8a4f060/node_modules/<pkg>/shared/<dep>
 *
 * The whole cohort dies, not just one server. Isolating the npm cache per
 * working directory does not help — the colliding servers live in the *same*
 * working directory.
 *
 * The fix is to install each shared spec set exactly once, before any server
 * process starts. `planNpxPrewarm` finds the collision groups and
 * `prewarmNpxPackages` installs them serially; afterwards every server's own
 * `npx` invocation finds a satisfying tree and installs nothing.
 *
 * ## The prewarm and the servers must share one npm cache
 *
 * npx derives `_npx/<hash>` from `NPM_CONFIG_CACHE` (npm's `cache` config).
 * The prewarm runs in the `prepareSession` process, so it warms whatever cache
 * *that* process is configured with. An orchestrator that starts the agent
 * with a different `NPM_CONFIG_CACHE` than it ran `air prepare` with warms one
 * directory and reads another, and the prewarm silently does nothing.
 *
 * Orchestrators must therefore run `air prepare` and the agent with the same
 * npm cache. See `docs/guides/configuring-mcp-servers.md`.
 */

/** npx flags that take no value. Anything else is treated as unrecognized. */
const NPX_BOOLEAN_FLAGS = new Set([
  "-y",
  "--yes",
  "-n",
  "--no",
  "--no-yes",
  "--no-install",
  "--ignore-existing",
  "-s",
  "--silent",
  "-q",
  "--quiet",
  "--offline",
  "--prefer-offline",
  "--prefer-online",
]);

/** npx flags whose value is the next argument (or `--flag=value`). */
const NPX_PACKAGE_FLAGS = new Set(["-p", "--package"]);
const NPX_CALL_FLAGS = new Set(["-c", "--call"]);

/** True when `command` invokes npx, allowing absolute paths and `.cmd`/`.exe`. */
function isNpxCommand(command: string): boolean {
  const base = command.split(/[/\\]/).pop() ?? command;
  return base === "npx" || base === "npx.cmd" || base === "npx.exe";
}

/** True when `command` invokes npm, allowing absolute paths and `.cmd`/`.exe`. */
function isNpmCommand(command: string): boolean {
  const base = command.split(/[/\\]/).pop() ?? command;
  return base === "npm" || base === "npm.cmd" || base === "npm.exe";
}

/**
 * Extract the npm package specs an `npx` (or `npm exec`) invocation will
 * install, in npm's own terms: every `--package` spec, or the first positional
 * argument when no `--package` is given.
 *
 * Returns `null` when the command is not an npx invocation, or when it uses a
 * flag this parser does not recognize. npx forwards arbitrary npm config as
 * `--key value`, which cannot be parsed without npm's own option table, so an
 * unrecognized flag makes the whole invocation unparseable rather than
 * silently mis-grouped. `null` simply means "not prewarmed" — the caller falls
 * back to today's behavior, which is safe.
 */
export function parseNpxPackageSpecs(command: string, args?: string[]): string[] | null {
  let rest: string[];
  if (isNpxCommand(command)) {
    rest = args ?? [];
  } else if (isNpmCommand(command) && args && (args[0] === "exec" || args[0] === "x")) {
    rest = args.slice(1);
  } else {
    return null;
  }

  const packages: string[] = [];
  let positional: string | undefined;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];

    // `--` ends npx's own options; the next token is the package spec.
    if (arg === "--") {
      positional ??= rest[i + 1];
      break;
    }

    if (!arg.startsWith("-")) {
      // First positional is the package spec; everything after it belongs to
      // the spawned command and is irrelevant to the cache key.
      positional = arg;
      break;
    }

    const eq = arg.indexOf("=");
    const flag = eq === -1 ? arg : arg.slice(0, eq);

    if (NPX_PACKAGE_FLAGS.has(flag)) {
      const value = eq === -1 ? rest[++i] : arg.slice(eq + 1);
      if (!value) return null;
      packages.push(value);
      continue;
    }
    if (NPX_CALL_FLAGS.has(flag)) {
      // `--call` replaces the positional command; consume its value.
      if (eq === -1) i++;
      continue;
    }
    if (NPX_BOOLEAN_FLAGS.has(flag)) continue;

    return null; // unrecognized flag — refuse to guess
  }

  const specs = packages.length > 0 ? packages : positional ? [positional] : null;
  if (!specs) return null;

  // `prepareSession` writes MCP config before transforms resolve `${VAR}`
  // patterns, so a spec can still be a placeholder rather than a package name.
  // Installing that would be meaningless (and would poison the cache entry the
  // real spec later uses), so treat it as unparseable.
  if (specs.some((spec) => spec.includes("${"))) return null;

  return specs;
}

/**
 * The cache key npx derives from a package-spec set: the sorted specs. npm
 * hashes exactly this material to name `_npx/<hash>`, so specs that produce
 * equal keys here land in the same directory on disk.
 */
export function npxCacheKey(specs: string[]): string {
  return [...specs].sort().join("\n");
}

/** One set of package specs shared by two or more activated MCP servers. */
export interface NpxPrewarmGroup {
  /** Package specs to install, sorted — npm's own cache-key material. */
  packages: string[];
  /** Names of the activated servers that would race for this cache entry. */
  servers: string[];
}

/**
 * Find the npx package-spec sets that two or more of the given servers share.
 *
 * Only collisions are returned: a package used by exactly one server has no
 * one to race with, so prewarming it would add startup latency for nothing.
 * Groups come back sorted by cache key for deterministic output.
 *
 * @param servers Activated stdio servers keyed by the name they were given.
 */
export function planNpxPrewarm(servers: Record<string, McpServerEntry>): NpxPrewarmGroup[] {
  const byKey = new Map<string, NpxPrewarmGroup>();

  for (const name of Object.keys(servers).sort()) {
    const server = servers[name];
    if (!server || server.type !== "stdio" || !server.command) continue;

    const specs = parseNpxPackageSpecs(server.command, server.args);
    if (!specs) continue;

    const key = npxCacheKey(specs);
    const existing = byKey.get(key);
    if (existing) {
      existing.servers.push(name);
    } else {
      byKey.set(key, { packages: [...specs].sort(), servers: [name] });
    }
  }

  return [...byKey.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, group]) => group)
    .filter((group) => group.servers.length > 1);
}

export interface PrewarmNpxOptions {
  /** Working directory for the npx invocation. Defaults to `process.cwd()`. */
  cwd?: string;
  /**
   * Environment for the npx invocation. Defaults to `process.env` so the
   * prewarm writes to the same `NPM_CONFIG_CACHE` the servers will read.
   */
  env?: NodeJS.ProcessEnv;
  /** Per-group timeout in milliseconds. Defaults to 60_000. */
  timeoutMs?: number;
  /**
   * Total wall-clock budget across all groups in milliseconds. Groups that
   * would start after the budget is spent are reported as `skipped` rather
   * than run. Defaults to 180_000.
   */
  totalTimeoutMs?: number;
  /** Injection seam for tests. Defaults to a real `npx` invocation. */
  runner?: (group: NpxPrewarmGroup, options: PrewarmNpxOptions) => PrewarmRunResult;
}

/** Raw outcome of running one prewarm invocation. */
export interface PrewarmRunResult {
  ok: boolean;
  /** Populated when `ok` is false — the failure to surface to the user. */
  error?: string;
}

export interface NpxPrewarmOutcome extends NpxPrewarmGroup {
  status: "warmed" | "failed" | "skipped";
  /** Populated for `failed` — npm's stderr, trimmed. */
  error?: string;
  durationMs: number;
}

/**
 * Install one package-spec set into the npx cache without running the
 * package's own binary.
 *
 * `--package <spec> --call <cmd>` makes npm install exactly `<spec>` and then
 * run `<cmd>` instead of the package's bin, so the server itself never starts.
 * npm derives `_npx/<hash>` from the `--package` specs alone, so this lands in
 * the same directory the server's own `npx <spec>` would use.
 */
function runPrewarm(group: NpxPrewarmGroup, options: PrewarmNpxOptions): PrewarmRunResult {
  const args = ["--yes"];
  for (const spec of group.packages) args.push("--package", spec);
  args.push("--call", "node --version");

  const result = spawnSync("npx", args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    timeout: options.timeoutMs ?? 60_000,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });

  if (result.error) {
    const timedOut = (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
    return { ok: false, error: timedOut ? "timed out" : result.error.message };
  }
  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").trim();
    const tail = stderr.split("\n").slice(-3).join("\n").trim();
    return { ok: false, error: tail || `npx exited with status ${result.status}` };
  }
  return { ok: true };
}

/**
 * Install each group's packages once, serially, so that the servers sharing
 * them find a warm cache and install nothing when they start.
 *
 * Serial execution is the point: two prewarms of the same spec set would
 * reintroduce the race this exists to prevent. Distinct spec sets could safely
 * run in parallel, but the groups are few and the shared work is already done
 * once here rather than N times at launch.
 *
 * Never throws. A prewarm that fails (offline, private registry, timeout)
 * leaves the caller exactly where it would have been without prewarming, so
 * failures are reported for logging and otherwise ignored.
 */
export function prewarmNpxPackages(
  groups: NpxPrewarmGroup[],
  options: PrewarmNpxOptions = {}
): NpxPrewarmOutcome[] {
  const runner = options.runner ?? runPrewarm;
  const budget = options.totalTimeoutMs ?? 180_000;
  const startedAt = Date.now();
  const outcomes: NpxPrewarmOutcome[] = [];

  for (const group of groups) {
    if (Date.now() - startedAt >= budget) {
      outcomes.push({ ...group, status: "skipped", durationMs: 0 });
      continue;
    }

    const groupStartedAt = Date.now();
    let result: PrewarmRunResult;
    try {
      result = runner(group, options);
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    outcomes.push({
      ...group,
      status: result.ok ? "warmed" : "failed",
      ...(result.ok ? {} : { error: result.error }),
      durationMs: Date.now() - groupStartedAt,
    });
  }

  return outcomes;
}

/** Result of the one-call prewarm entry point adapters use. */
export interface NpxPrewarmReport {
  /** One entry per collision group that was found. Empty when there were none. */
  outcomes: NpxPrewarmOutcome[];
  /** Human-readable messages for groups that did not warm. */
  warnings: string[];
}

/**
 * True unless `AIR_NPX_PREWARM` is set to an explicit off value.
 *
 * The escape hatch exists for environments where `air prepare` must not touch
 * the network (air-gapped CI, offline reproducible builds).
 */
export function isNpxPrewarmEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.AIR_NPX_PREWARM;
  if (raw === undefined) return true;
  const value = raw.trim().toLowerCase();
  return !(value === "0" || value === "false" || value === "off" || value === "no");
}

/**
 * Prewarm every npx cache entry that two or more of `servers` would install
 * into concurrently. This is the entry point adapters call from
 * `prepareSession` after writing their MCP config.
 *
 * No-ops (and performs no I/O) when there are no collisions, which is the
 * common case — the cost is paid only by the configurations that would
 * otherwise race.
 *
 * @param enabled Explicit override; falls back to `AIR_NPX_PREWARM`.
 */
export function prewarmSharedNpxCache(
  servers: Record<string, McpServerEntry>,
  options: PrewarmNpxOptions & { enabled?: boolean } = {}
): NpxPrewarmReport {
  const groups = planNpxPrewarm(servers);
  if (groups.length === 0) return { outcomes: [], warnings: [] };

  const enabled = options.enabled ?? isNpxPrewarmEnabled(options.env);
  if (!enabled) {
    return {
      outcomes: groups.map((group) => ({ ...group, status: "skipped" as const, durationMs: 0 })),
      warnings: [],
    };
  }

  const outcomes = prewarmNpxPackages(groups, options);
  const warnings = outcomes
    .filter((outcome) => outcome.status !== "warmed")
    .map(
      (outcome) =>
        `Warning: could not prewarm the npx cache for ${outcome.packages.join(", ")} ` +
        `(shared by ${outcome.servers.join(", ")})` +
        (outcome.error ? `: ${outcome.error}` : " — time budget exhausted") +
        `. Those servers may race on first launch.`
    );
  return { outcomes, warnings };
}
