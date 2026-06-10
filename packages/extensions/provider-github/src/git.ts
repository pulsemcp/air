import { spawn } from "child_process";

/**
 * Resilient git execution for the GitHub catalog provider.
 *
 * The provider shells out to `git clone` / `git fetch` against github.com to
 * materialize catalog repos. Those network calls have two failure modes that
 * must be bounded so a single transient github.com hiccup does not fail (or
 * worse, indefinitely hang) every consumer of `air prepare`:
 *
 *   1. A transient TLS stall / `ETIMEDOUT` / connection reset makes git exit
 *      non-zero. A retry seconds later usually succeeds.
 *   2. A half-open HTTPS connection that never sends a TCP reset makes git's
 *      fetch-pack hang forever with no output and no recovery.
 *
 * {@link runBounded} addresses (2) by running git as its own process-group
 * leader and SIGKILLing the entire group on a wall-clock deadline — git spawns
 * helper processes (`git-remote-https`, `index-pack`) that must die too, not
 * just the parent. Node's own `spawnSync`/`child.kill()` timeout only signals
 * the direct child, which can leave those helpers alive and the transfer wedged.
 *
 * {@link withGitRetry} addresses (1) by retrying transient/timeout failures with
 * backoff, surfacing a clear error only after retries are exhausted.
 */

/** Error raised when a git command exits non-zero. Carries stderr/stdout/code. */
export class GitError extends Error {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;

  constructor(message: string, opts: { stdout?: string; stderr?: string; code?: number | null } = {}) {
    super(message);
    this.name = "GitError";
    this.stdout = opts.stdout ?? "";
    this.stderr = opts.stderr ?? "";
    this.code = opts.code ?? null;
  }
}

/**
 * Raised when a bounded subprocess exceeds its timeout and its process group
 * is killed. Always treated as transient by {@link withGitRetry} — a hung clone
 * that we killed has no deterministic cause, so a fresh retry is warranted.
 */
export class GitTimeoutError extends GitError {
  constructor(message: string) {
    super(message);
    this.name = "GitTimeoutError";
  }
}

/**
 * Belt-and-suspenders environment applied to every network git invocation,
 * before the hard watchdog kicks in:
 *   - `GIT_HTTP_LOW_SPEED_LIMIT` / `GIT_HTTP_LOW_SPEED_TIME`: ask git itself to
 *     abort an HTTP transfer that drops below ~1 KB/s for 60s, so a stalled
 *     fetch fails fast with a transient error instead of crawling up to the
 *     full timeout.
 *   - `GIT_TERMINAL_PROMPT=0`: a missing-credential case fails immediately
 *     instead of blocking forever on an interactive username/password prompt.
 * All overridable via the corresponding env vars on the parent process.
 */
export const GIT_STALL_ENV: Record<string, string> = {
  GIT_HTTP_LOW_SPEED_LIMIT: process.env.GIT_HTTP_LOW_SPEED_LIMIT ?? "1000",
  GIT_HTTP_LOW_SPEED_TIME: process.env.GIT_HTTP_LOW_SPEED_TIME ?? "60",
  GIT_TERMINAL_PROMPT: "0",
};

/** Wall-clock cap (ms) for a single network git invocation (clone/fetch). */
export const CLONE_TIMEOUT_MS = readIntEnv("AIR_GIT_CLONE_TIMEOUT_MS", 60_000);

/** Wall-clock cap (ms) for a local git invocation (init/remote/checkout/...). */
export const LOCAL_GIT_TIMEOUT_MS = readIntEnv("AIR_GIT_LOCAL_TIMEOUT_MS", 30_000);

/**
 * Backoff (ms) between clone retries on transient failures. The number of
 * retries is the list length (so the default makes up to 4 attempts total).
 * Overridable via a comma-separated `AIR_GIT_CLONE_RETRY_DELAYS_MS` list.
 */
export const CLONE_RETRY_DELAYS_MS: number[] = readIntListEnv(
  "AIR_GIT_CLONE_RETRY_DELAYS_MS",
  [5000, 10000, 20000]
);

/**
 * Signatures of transient github.com failures worth retrying — network blips
 * and 5xx responses, as opposed to deterministic errors (auth failure, missing
 * repo/ref) that would fail identically on every retry.
 */
const TRANSIENT_GIT_ERROR_PATTERNS: RegExp[] = [
  /ETIMEDOUT/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /EAI_AGAIN/i,
  /ENETUNREACH/i,
  /ENOTFOUND/i,
  /Could not resolve host/i,
  /Connection timed out/i,
  /Connection reset by peer/i,
  /early EOF/i,
  /unexpected EOF/i,
  /RPC failed/i,
  /Couldn't connect to server/i,
  /fetch-pack: unexpected disconnect/i,
  /remote: Internal Server Error/i,
  /The requested URL returned error: 5\d\d/i,
  /unable to access .* 5\d\d/i,
  // A TLS *connection* that drops mid-transfer is transient; deterministic TLS
  // problems (cert verification failures, etc.) phrase differently and are not
  // matched here, so we don't pointlessly retry them.
  /TLS connection/i,
  /SSL_ERROR/i,
  /gnutls_handshake/i,
];

/** Whether a git failure message looks like a transient github.com hiccup. */
export function isTransientGitError(message: string): boolean {
  return TRANSIENT_GIT_ERROR_PATTERNS.some((re) => re.test(message));
}

export interface GitLogger {
  info(message: string): void;
  warn(message: string): void;
}

/** Default logger: writes diagnostics to stderr (stdout is reserved for output). */
export const defaultGitLogger: GitLogger = {
  info: (message) => process.stderr.write(`[air-provider-github] ${message}\n`),
  warn: (message) => process.stderr.write(`[air-provider-github] ${message}\n`),
};

export interface RunBoundedOptions {
  cwd?: string;
  /** Extra environment merged onto the parent process env. */
  env?: Record<string, string>;
  /** Wall-clock deadline in milliseconds before the process group is killed. */
  timeoutMs: number;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
}

/**
 * Run a command as its own process-group leader under a wall-clock timeout,
 * SIGKILLing the entire group on deadline. Resolves with captured
 * stdout/stderr and the exit code/signal (does NOT reject on a non-zero exit —
 * callers decide what a non-zero code means). Rejects with {@link GitTimeoutError}
 * if the deadline is exceeded, or with the spawn error if the binary cannot be
 * launched.
 */
export function runBounded(
  command: string,
  args: string[],
  opts: RunBoundedOptions
): Promise<RunResult> {
  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      // New process group so we can signal the whole tree (git spawns
      // git-remote-https / index-pack helpers that must die with it).
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child.pid);
    }, opts.timeoutMs);
    // Don't let the watchdog timer keep the event loop alive on its own.
    if (typeof timer.unref === "function") timer.unref();

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (timedOut) {
        reject(
          new GitTimeoutError(
            `${command} ${args.join(" ")} timed out after ${opts.timeoutMs}ms (process group killed)`
          )
        );
        return;
      }
      resolve({ stdout, stderr, code, signal });
    });
  });
}

/**
 * SIGKILL an entire process group (negative pid). Best-effort: the process may
 * already have exited, or we may lack permission, in which case we fall back to
 * killing just the leader.
 */
function killGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone — nothing to do.
    }
  }
}

export interface RunGitOptions extends RunBoundedOptions {}

/**
 * Run a single `git` invocation under a bounded timeout. Resolves with
 * stdout/stderr on a zero exit; throws {@link GitError} on a non-zero exit (with
 * stderr/stdout/code attached) or {@link GitTimeoutError} on a watchdog kill.
 */
export async function runGit(
  args: string[],
  opts: RunGitOptions
): Promise<{ stdout: string; stderr: string }> {
  const result = await runBounded("git", args, opts);
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new GitError(
      `git ${args.join(" ")} exited with code ${result.code}${detail ? `: ${detail}` : ""}`,
      { stdout: result.stdout, stderr: result.stderr, code: result.code }
    );
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

export interface WithGitRetryOptions {
  /** Backoff delays (ms); list length is the number of retries. */
  retryDelaysMs?: number[];
  /** Injectable sleep (tests pass a no-op to skip real delays). */
  sleep?: (ms: number) => Promise<void>;
  logger?: GitLogger;
  /** Human-readable label for log lines (e.g. "owner/repo@ref"). */
  label?: string;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof t.unref === "function") t.unref();
  });

/**
 * Run an async git operation, retrying with backoff on transient/timeout
 * failures. A {@link GitTimeoutError} (watchdog kill) is always retried; other
 * errors are retried only when their message matches a transient signature.
 * Non-transient failures (auth, missing repo) raise immediately so we don't
 * pointlessly retry a deterministic error. The final failure after retries are
 * exhausted is logged at warn level; intermediate attempts at info.
 */
export async function withGitRetry<T>(
  operation: () => Promise<T>,
  opts: WithGitRetryOptions = {}
): Promise<T> {
  const retryDelaysMs = opts.retryDelaysMs ?? CLONE_RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? defaultSleep;
  const logger = opts.logger ?? defaultGitLogger;
  const label = opts.label ? ` (${opts.label})` : "";
  const maxAttempts = retryDelaysMs.length + 1;

  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await operation();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const transient = err instanceof GitTimeoutError || isTransientGitError(message);

      if (transient && attempt < maxAttempts) {
        const delay = retryDelaysMs[attempt - 1];
        logger.info(
          `git operation failed transiently${label}, retrying attempt=${attempt} sleep_ms=${delay} error=${message}`
        );
        await sleep(delay);
        continue;
      }

      if (transient) {
        logger.warn(
          `git operation failed after ${attempt} attempts${label}: ${message}`
        );
      }
      throw err;
    }
  }
}

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readIntListEnv(name: string, fallback: number[]): number[] {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = raw
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 0);
  return parsed.length > 0 ? parsed : fallback;
}
