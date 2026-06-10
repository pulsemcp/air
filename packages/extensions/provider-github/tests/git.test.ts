import { describe, it, expect, vi } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync, readFileSync, rmSync } from "fs";
import {
  GitError,
  GitTimeoutError,
  GitLogger,
  isTransientGitError,
  runBounded,
  runGit,
  withGitRetry,
} from "../src/git.js";

function captureLogger(): GitLogger & { infos: string[]; warns: string[] } {
  const infos: string[] = [];
  const warns: string[] = [];
  return {
    infos,
    warns,
    info: (m: string) => infos.push(m),
    warn: (m: string) => warns.push(m),
  };
}

describe("isTransientGitError", () => {
  it("classifies network/5xx signatures as transient", () => {
    const transient = [
      "fatal: unable to access 'https://github.com/o/r.git/': Failed to connect: ETIMEDOUT",
      "fatal: unable to access '...': Connection reset by peer (ECONNRESET)",
      "ssh: Could not resolve host: github.com",
      "fatal: the remote end hung up unexpectedly\nfetch-pack: unexpected disconnect",
      "error: RPC failed; curl 56 OpenSSL SSL_read: Connection reset",
      "fatal: unable to access '...': The requested URL returned error: 503",
      "remote: Internal Server Error",
      "fatal: early EOF",
      "getaddrinfo EAI_AGAIN github.com",
    ];
    for (const msg of transient) {
      expect(isTransientGitError(msg), msg).toBe(true);
    }
  });

  it("classifies deterministic failures as non-transient", () => {
    const nonTransient = [
      "fatal: Authentication failed for 'https://github.com/o/r.git/'",
      "ERROR: Repository not found.",
      "fatal: could not read Username for 'https://github.com'",
      "git@github.com: Permission denied (publickey).",
      "fatal: Remote branch nope not found in upstream origin",
    ];
    for (const msg of nonTransient) {
      expect(isTransientGitError(msg), msg).toBe(false);
    }
  });
});

describe("withGitRetry", () => {
  it("retries a transient failure and then succeeds", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const logger = captureLogger();

    const result = await withGitRetry(
      async () => {
        calls += 1;
        if (calls < 3) {
          throw new GitError("fatal: unable to access '...': ETIMEDOUT");
        }
        return "ok";
      },
      {
        retryDelaysMs: [1, 1, 1],
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        logger,
      }
    );

    expect(result).toBe("ok");
    expect(calls).toBe(3);
    expect(sleeps).toEqual([1, 1]); // two backoffs before the third attempt
    expect(logger.infos.length).toBe(2); // intermediate retries log at info
    expect(logger.warns.length).toBe(0); // never exhausted, so no warn
  });

  it("raises after exhausting retries on persistent transient failure", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const logger = captureLogger();

    await expect(
      withGitRetry(
        async () => {
          calls += 1;
          throw new GitError("error: RPC failed; Connection reset by peer");
        },
        {
          retryDelaysMs: [1, 1],
          sleep: async (ms) => {
            sleeps.push(ms);
          },
          logger,
        }
      )
    ).rejects.toThrow(/RPC failed/);

    expect(calls).toBe(3); // 1 initial + 2 retries
    expect(sleeps).toEqual([1, 1]);
    expect(logger.warns.length).toBe(1); // final failure logged at warn
  });

  it("does not retry a non-transient failure", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const logger = captureLogger();

    await expect(
      withGitRetry(
        async () => {
          calls += 1;
          throw new GitError("fatal: Authentication failed");
        },
        {
          retryDelaysMs: [1, 1],
          sleep: async (ms) => {
            sleeps.push(ms);
          },
          logger,
        }
      )
    ).rejects.toThrow(/Authentication failed/);

    expect(calls).toBe(1); // raised immediately, no retry
    expect(sleeps).toEqual([]);
    expect(logger.infos.length).toBe(0);
    expect(logger.warns.length).toBe(0);
  });

  it("always treats a timeout (watchdog kill) as transient", async () => {
    let calls = 0;
    const result = await withGitRetry(
      async () => {
        calls += 1;
        if (calls === 1) {
          throw new GitTimeoutError("git fetch ... timed out after 60000ms (process group killed)");
        }
        return "recovered";
      },
      { retryDelaysMs: [1], sleep: async () => {} }
    );

    expect(result).toBe("recovered");
    expect(calls).toBe(2);
  });
});

describe("runBounded", () => {
  it("captures stdout/stderr and exit code on success", async () => {
    const result = await runBounded(
      "sh",
      ["-c", "printf hello; printf oops 1>&2; exit 0"],
      { timeoutMs: 5000 }
    );
    expect(result.stdout).toBe("hello");
    expect(result.stderr).toBe("oops");
    expect(result.code).toBe(0);
  });

  it("returns a non-zero exit code without throwing", async () => {
    const result = await runBounded("sh", ["-c", "exit 7"], { timeoutMs: 5000 });
    expect(result.code).toBe(7);
  });

  it("kills the entire process group on timeout (not just the parent)", async () => {
    const pidFile = join(
      tmpdir(),
      `air-git-grandchild-${process.pid}-${Math.random().toString(36).slice(2)}.pid`
    );
    // Parent shell spawns a long-lived background grandchild and records its
    // PID, then waits. If the watchdog only killed the parent, the grandchild
    // would survive; a process-group kill takes it down too.
    const script = `sleep 30 & echo $! > "${pidFile}"; wait`;

    const start = Date.now();
    await expect(
      runBounded("sh", ["-c", script], { timeoutMs: 700 })
    ).rejects.toBeInstanceOf(GitTimeoutError);
    const elapsed = Date.now() - start;

    // Bounded well under the 30s the grandchild would otherwise sleep.
    expect(elapsed).toBeLessThan(5000);

    expect(existsSync(pidFile)).toBe(true);
    const grandchildPid = Number.parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
    expect(Number.isFinite(grandchildPid)).toBe(true);

    // Give SIGKILL a moment to propagate to the whole group.
    await new Promise((r) => setTimeout(r, 200));

    let alive = true;
    try {
      process.kill(grandchildPid, 0); // signal 0 = liveness probe
    } catch (err) {
      // ESRCH => the process is gone, which is what we want.
      alive = (err as NodeJS.ErrnoException).code !== "ESRCH";
    }
    rmSync(pidFile, { force: true });
    expect(alive).toBe(false);
  });

  it("rejects when the binary cannot be spawned", async () => {
    await expect(
      runBounded("this-binary-does-not-exist-air-test", [], { timeoutMs: 5000 })
    ).rejects.toThrow();
  });
});

describe("runGit", () => {
  it("returns stdout on a zero exit", async () => {
    const { stdout } = await runGit(["--version"], { timeoutMs: 10000 });
    expect(stdout).toMatch(/git version/);
  });

  it("throws GitError with stderr on a non-zero exit", async () => {
    // A bogus subcommand fails fast and offline (no network needed).
    await expect(
      runGit(["definitely-not-a-real-subcommand"], { timeoutMs: 10000 })
    ).rejects.toThrow(GitError);

    try {
      await runGit(["definitely-not-a-real-subcommand"], { timeoutMs: 10000 });
      throw new Error("expected runGit to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(GitError);
      const gitErr = err as GitError;
      expect(gitErr.code).not.toBe(0);
      expect(gitErr.stderr.length).toBeGreaterThan(0);
    }
  });
});
