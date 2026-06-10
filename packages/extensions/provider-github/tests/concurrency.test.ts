import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { EventEmitter } from "events";
import { tmpdir } from "os";
import { resolve } from "path";

// Mock spawn so we never hit the network; the mock simulates a slow `git clone`
// that creates `.git/` first, pauses, and only then writes the requested file —
// the exact timing window that produces the real race. The provider runs git
// via runBounded() (in git.ts), which calls spawn() and listens for stdout/
// stderr 'data' and a 'close' event, so the fake child must emit those.
vi.mock("child_process", async () => {
  const actual = await vi.importActual<typeof import("child_process")>(
    "child_process"
  );
  return { ...actual, spawn: vi.fn() };
});

import { spawn } from "child_process";
import {
  GitHubCatalogProvider,
  getClonePath,
} from "../src/github-provider.js";

const mockedSpawn = spawn as unknown as ReturnType<typeof vi.fn>;

/** Synchronously block the event loop for `ms`. Mirrors the real clone's
 * sync behavior so we can reproduce the "working-tree checkout hasn't
 * finished yet" race window inside the event loop. */
function sleepSync(ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // spin
  }
}

/**
 * Build a fake ChildProcess that runs `work()` on the next tick (after the
 * caller has attached its listeners), emits any stdout/stderr, then emits
 * `close` with the resulting exit code. If `work()` throws, the thrown message
 * is emitted on stderr and the process closes with code 128 — mirroring how a
 * real failed `git clone` surfaces.
 */
function makeFakeChild(work: () => { code?: number; stdout?: string; stderr?: string }) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    pid: number;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 4242;

  setImmediate(() => {
    let result: { code?: number; stdout?: string; stderr?: string };
    try {
      result = work();
    } catch (e) {
      child.stderr.emit("data", Buffer.from(String((e as Error).message ?? e)));
      child.emit("close", 128, null);
      return;
    }
    if (result.stdout) child.stdout.emit("data", Buffer.from(result.stdout));
    if (result.stderr) child.stderr.emit("data", Buffer.from(result.stderr));
    child.emit("close", result.code ?? 0, null);
  });

  return child;
}

describe("ensureClone concurrency", () => {
  let tempHome: string;
  let origHome: string | undefined;

  beforeEach(() => {
    tempHome = mkdtempSync(resolve(tmpdir(), "air-race-"));
    origHome = process.env.HOME;
    process.env.HOME = tempHome;
    mockedSpawn.mockReset();
  });

  afterEach(() => {
    if (origHome !== undefined) {
      process.env.HOME = origHome;
    } else {
      delete process.env.HOME;
    }
    rmSync(tempHome, { recursive: true, force: true });
  });

  /** Install a mock that mimics a real `git clone` — creates `.git/` first,
   * pauses to simulate checkout, then writes the requested file. */
  function mockSlowGitClone(payload = { "some-skill": {} }) {
    mockedSpawn.mockImplementation((cmd: string, args: readonly string[]) => {
      if (cmd !== "git" || args[0] !== "clone") {
        throw new Error(`unexpected spawn: ${cmd} ${args.join(" ")}`);
      }
      const dest = args[args.length - 1];
      return makeFakeChild(() => {
        // Simulate git's own sequencing: .git appears early, working tree later.
        mkdirSync(resolve(dest, ".git"), { recursive: true });
        writeFileSync(resolve(dest, ".git", "config"), "");
        sleepSync(150);
        writeFileSync(resolve(dest, "skills.json"), JSON.stringify(payload));
        return { code: 0 };
      });
    });
  }

  it("serializes concurrent resolve() calls — exactly one git clone runs", async () => {
    mockSlowGitClone();
    const provider = new GitHubCatalogProvider({ gitProtocol: "https" });

    const results = await Promise.all([
      provider.resolve("github://acme/repo/skills.json", "/tmp"),
      provider.resolve("github://acme/repo/skills.json", "/tmp"),
      provider.resolve("github://acme/repo/skills.json", "/tmp"),
      provider.resolve("github://acme/repo/skills.json", "/tmp"),
      provider.resolve("github://acme/repo/skills.json", "/tmp"),
    ]);

    expect(results).toHaveLength(5);
    for (const r of results) {
      expect(r).toHaveProperty("some-skill");
    }
    expect(mockedSpawn).toHaveBeenCalledTimes(1);

    const cloneDir = getClonePath("acme", "repo", "HEAD");
    expect(existsSync(resolve(cloneDir, ".git"))).toBe(true);
    expect(existsSync(resolve(cloneDir, "skills.json"))).toBe(true);
  });

  it("never publishes a partial clone at cloneDir (temp-dir-then-rename)", async () => {
    let observedPartialAtCloneDir = false;
    const cloneDir = getClonePath("acme", "racy", "HEAD");

    mockedSpawn.mockImplementation((cmd: string, args: readonly string[]) => {
      if (cmd !== "git" || args[0] !== "clone") {
        throw new Error(`unexpected spawn: ${cmd} ${args.join(" ")}`);
      }
      const dest = args[args.length - 1];
      expect(dest).not.toBe(cloneDir); // must clone into a temp dir, not cloneDir
      return makeFakeChild(() => {
        mkdirSync(resolve(dest, ".git"), { recursive: true });
        writeFileSync(resolve(dest, ".git", "config"), "");
        // If a partial clone ever showed up at cloneDir during the "checkout"
        // window, a concurrent reader would see it and crash with the real-world
        // "File not found in cloned repository" error. Assert it never does.
        if (existsSync(resolve(cloneDir, ".git"))) {
          observedPartialAtCloneDir = true;
        }
        sleepSync(100);
        writeFileSync(resolve(dest, "skills.json"), JSON.stringify({}));
        return { code: 0 };
      });
    });

    const provider = new GitHubCatalogProvider({ gitProtocol: "https" });
    await provider.resolve("github://acme/racy/skills.json", "/tmp");

    expect(observedPartialAtCloneDir).toBe(false);
    expect(existsSync(resolve(cloneDir, ".git"))).toBe(true);
  });

  it("reuses the clone on a second call (no extra git invocation)", async () => {
    mockSlowGitClone();
    const provider = new GitHubCatalogProvider({ gitProtocol: "https" });

    await provider.resolve("github://acme/repo/skills.json", "/tmp");
    await provider.resolve("github://acme/repo/skills.json", "/tmp");

    expect(mockedSpawn).toHaveBeenCalledTimes(1);
  });

  it("cleans up a pre-existing partial cloneDir without .git", async () => {
    mockSlowGitClone();
    const provider = new GitHubCatalogProvider({ gitProtocol: "https" });
    const cloneDir = getClonePath("acme", "orphaned", "HEAD");

    // Simulate a crashed-previous-run state: cloneDir exists but no .git
    mkdirSync(cloneDir, { recursive: true });
    writeFileSync(resolve(cloneDir, "leftover.txt"), "stale");

    const result = await provider.resolve(
      "github://acme/orphaned/skills.json",
      "/tmp"
    );

    expect(result).toEqual({ "some-skill": {} });
    expect(existsSync(resolve(cloneDir, ".git"))).toBe(true);
    expect(existsSync(resolve(cloneDir, "leftover.txt"))).toBe(false);
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
  });

  it("cleans up the tmp dir when git clone fails", async () => {
    mockedSpawn.mockImplementation(() =>
      makeFakeChild(() => {
        throw new Error("fatal: Repository not found");
      })
    );
    const provider = new GitHubCatalogProvider({ gitProtocol: "https" });

    await expect(
      provider.resolve("github://acme/missing/skills.json", "/tmp")
    ).rejects.toThrow("Failed to clone acme/missing");

    const cloneDir = getClonePath("acme", "missing", "HEAD");
    // cloneDir itself must not exist (clone never succeeded)
    expect(existsSync(cloneDir)).toBe(false);

    // No leftover .tmp-* siblings
    const parent = resolve(cloneDir, "..");
    if (existsSync(parent)) {
      const entries = readdirSync(parent);
      const tmpLeftovers = entries.filter((e) => e.includes(".tmp-"));
      expect(tmpLeftovers).toEqual([]);
    }
  });

  it("concurrent calls all see the failure (none observe a partial clone)", async () => {
    mockedSpawn.mockImplementation(() =>
      makeFakeChild(() => {
        throw new Error("fatal: Authentication failed");
      })
    );
    const provider = new GitHubCatalogProvider({ gitProtocol: "https" });

    const results = await Promise.allSettled([
      provider.resolve("github://acme/private/skills.json", "/tmp"),
      provider.resolve("github://acme/private/skills.json", "/tmp"),
      provider.resolve("github://acme/private/skills.json", "/tmp"),
    ]);

    for (const r of results) {
      expect(r.status).toBe("rejected");
      if (r.status === "rejected") {
        expect(String(r.reason)).toContain("Failed to clone acme/private");
      }
    }
  });
});
