import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "fs";
import { EventEmitter } from "events";
import { tmpdir } from "os";
import { resolve } from "path";

// Mock spawn so we never hit the network. The mock models a tiny fake remote:
// `clone` materializes the remote's current payload+SHA into the destination,
// `fetch`/`reset` move an existing clone onto the remote's *current* state, and
// `rev-parse` reports whatever SHA the clone is sitting on. That is enough to
// distinguish "served the cached snapshot" from "refreshed and served the newer
// commit", which is the whole point of these tests.
vi.mock("child_process", async () => {
  const actual = await vi.importActual<typeof import("child_process")>(
    "child_process"
  );
  return { ...actual, spawn: vi.fn() };
});

import { spawn } from "child_process";
import {
  DEFAULT_MUTABLE_REF_TTL_MS,
  GitHubCatalogProvider,
  getClonePath,
  getMutableRefTtlMs,
} from "../src/github-provider.js";

const mockedSpawn = spawn as unknown as ReturnType<typeof vi.fn>;

const PINNED_SHA = "0123456789abcdef0123456789abcdef01234567";

/** Synchronously block the event loop for `ms`, to widen a race window. */
function sleepSync(ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // spin
  }
}

function makeFakeChild(
  work: () => { code?: number; stdout?: string; stderr?: string }
) {
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

/** The upstream state the fake git mock materializes into clones. */
interface FakeRemote {
  sha: string;
  payload: Record<string, unknown>;
}

describe("mutable-ref TTL refresh", () => {
  let tempHome: string;
  let origHome: string | undefined;
  let origTtl: string | undefined;

  /** Every `git` argv the provider ran, in order. */
  let gitCalls: string[][];
  let remote: FakeRemote;
  /** Extra sync delay injected into the `fetch` handler, to widen races. */
  let fetchDelayMs: number;
  /** When set, `git fetch` fails with this message. */
  let fetchFailure: string | undefined;
  let logs: { level: "info" | "warn"; message: string }[];

  const logger = {
    info: (message: string) => logs.push({ level: "info", message }),
    warn: (message: string) => logs.push({ level: "warn", message }),
  };

  /** Write the clone's working tree + fake SHA from the remote's current state. */
  function materialize(dest: string) {
    mkdirSync(resolve(dest, ".git"), { recursive: true });
    writeFileSync(resolve(dest, ".git", "config"), "");
    writeFileSync(resolve(dest, ".git", "FAKE_SHA"), remote.sha);
    writeFileSync(resolve(dest, "skills.json"), JSON.stringify(remote.payload));
  }

  beforeEach(() => {
    tempHome = mkdtempSync(resolve(tmpdir(), "air-ttl-"));
    origHome = process.env.HOME;
    origTtl = process.env.AIR_GIT_CACHE_TTL_MS;
    process.env.HOME = tempHome;
    delete process.env.AIR_GIT_CACHE_TTL_MS;

    gitCalls = [];
    logs = [];
    fetchDelayMs = 0;
    fetchFailure = undefined;
    remote = { sha: "aaaaaaa1111111111111111111111111111111111", payload: { v: 1 } };

    mockedSpawn.mockReset();
    mockedSpawn.mockImplementation(
      (cmd: string, args: readonly string[], opts?: { cwd?: string }) => {
        if (cmd !== "git") throw new Error(`unexpected spawn: ${cmd}`);
        gitCalls.push([...args]);
        const sub = args[0];
        const cwd = opts?.cwd;

        return makeFakeChild(() => {
          switch (sub) {
            // --- initial clone of a mutable ref -------------------------
            case "clone": {
              materialize(args[args.length - 1]);
              return { code: 0 };
            }
            // --- initial clone of a pinned SHA (init/remote/fetch/checkout)
            case "init": {
              mkdirSync(resolve(args[2], ".git"), { recursive: true });
              writeFileSync(resolve(args[2], ".git", "config"), "");
              return { code: 0 };
            }
            case "remote":
              return { code: 0 };
            case "checkout": {
              materialize(cwd!);
              return { code: 0 };
            }
            // --- refresh ------------------------------------------------
            case "fetch": {
              if (fetchDelayMs) sleepSync(fetchDelayMs);
              if (fetchFailure) throw new Error(fetchFailure);
              return { code: 0 };
            }
            case "reset": {
              materialize(cwd!);
              return { code: 0 };
            }
            case "rev-parse":
              return {
                code: 0,
                stdout: readFileSync(resolve(cwd!, ".git", "FAKE_SHA"), "utf-8"),
              };
            default:
              throw new Error(`unexpected git subcommand: ${sub}`);
          }
        });
      }
    );
  });

  afterEach(() => {
    if (origHome !== undefined) process.env.HOME = origHome;
    else delete process.env.HOME;
    if (origTtl !== undefined) process.env.AIR_GIT_CACHE_TTL_MS = origTtl;
    else delete process.env.AIR_GIT_CACHE_TTL_MS;
    rmSync(tempHome, { recursive: true, force: true });
  });

  function newProvider() {
    return new GitHubCatalogProvider({ gitProtocol: "https", logger });
  }

  /** Backdate the clone's refresh stamp so it reads as `ms` old. */
  function ageClone(cloneDir: string, ms: number) {
    writeFileSync(
      resolve(cloneDir, ".git", "air-last-fetch"),
      String(Date.now() - ms)
    );
  }

  const subcommands = () => gitCalls.map((c) => c[0]);
  const fetches = () => gitCalls.filter((c) => c[0] === "fetch");
  const resets = () => gitCalls.filter((c) => c[0] === "reset");

  it("serves a full-SHA ref from cache forever — no fetch even with the TTL at 0", async () => {
    const provider = newProvider();
    const uri = `github://acme/pinned@${PINNED_SHA}/skills.json`;

    const first = await provider.resolve(uri, "/tmp");
    expect(first).toEqual({ v: 1 });
    // The pinned-SHA clone path: init + remote add + fetch + checkout.
    expect(subcommands()).toEqual(["init", "remote", "fetch", "checkout"]);

    const cloneDir = getClonePath("acme", "pinned", PINNED_SHA);
    ageClone(cloneDir, 24 * 60 * 60_000); // a day old
    process.env.AIR_GIT_CACHE_TTL_MS = "0"; // "always refresh" — must not apply
    remote = { sha: "bbbbbbb2222222222222222222222222222222222", payload: { v: 2 } };

    gitCalls = [];
    const second = await provider.resolve(uri, "/tmp");

    // Immutable ref: no git ran at all, and the pinned snapshot is preserved.
    expect(gitCalls).toEqual([]);
    expect(second).toEqual({ v: 1 });
  });

  it("serves a HEAD ref from cache while it is inside the TTL", async () => {
    const provider = newProvider();
    const uri = "github://acme/repo/skills.json";

    expect(await provider.resolve(uri, "/tmp")).toEqual({ v: 1 });
    expect(subcommands()).toEqual(["clone"]);

    // Fresh clone, well inside the 5-minute TTL.
    remote = { sha: "bbbbbbb2222222222222222222222222222222222", payload: { v: 2 } };
    gitCalls = [];

    expect(await provider.resolve(uri, "/tmp")).toEqual({ v: 1 });
    expect(gitCalls).toEqual([]);
  });

  it("still short-circuits a HEAD ref one second before the TTL expires", async () => {
    const provider = newProvider();
    const uri = "github://acme/edge/skills.json";
    await provider.resolve(uri, "/tmp");

    ageClone(getClonePath("acme", "edge", "HEAD"), DEFAULT_MUTABLE_REF_TTL_MS - 1000);
    remote = { sha: "bbbbbbb2222222222222222222222222222222222", payload: { v: 2 } };
    gitCalls = [];

    expect(await provider.resolve(uri, "/tmp")).toEqual({ v: 1 });
    expect(gitCalls).toEqual([]);
  });

  it("refreshes a HEAD ref past the TTL and serves the newer commit", async () => {
    const provider = newProvider();
    const uri = "github://acme/repo/skills.json";
    expect(await provider.resolve(uri, "/tmp")).toEqual({ v: 1 });

    const cloneDir = getClonePath("acme", "repo", "HEAD");
    ageClone(cloneDir, DEFAULT_MUTABLE_REF_TTL_MS + 1000);
    remote = { sha: "bbbbbbb2222222222222222222222222222222222", payload: { v: 2 } };
    gitCalls = [];

    expect(await provider.resolve(uri, "/tmp")).toEqual({ v: 2 });

    expect(fetches()).toEqual([["fetch", "--depth", "1", "origin"]]);
    expect(resets()).toEqual([["reset", "--hard", "origin/HEAD"]]);
    expect(logs.some((l) => l.level === "info" && l.message.includes("aaaaaaa → bbbbbbb"))).toBe(true);

    // The refresh restamped the clone, so the next resolve is served from cache.
    gitCalls = [];
    expect(await provider.resolve(uri, "/tmp")).toEqual({ v: 2 });
    expect(gitCalls).toEqual([]);
  });

  it("refreshes a branch ref past the TTL via FETCH_HEAD", async () => {
    const provider = newProvider();
    const uri = "github://acme/repo@release/skills.json";
    expect(await provider.resolve(uri, "/tmp")).toEqual({ v: 1 });
    expect(gitCalls[0]).toContain("--branch");

    ageClone(
      getClonePath("acme", "repo", "release"),
      DEFAULT_MUTABLE_REF_TTL_MS + 1000
    );
    remote = { sha: "bbbbbbb2222222222222222222222222222222222", payload: { v: 2 } };
    gitCalls = [];

    expect(await provider.resolve(uri, "/tmp")).toEqual({ v: 2 });
    expect(fetches()).toEqual([["fetch", "--depth", "1", "origin", "release"]]);
    expect(resets()).toEqual([["reset", "--hard", "FETCH_HEAD"]]);
  });

  it("refreshes resolveCatalogDir() too — the whole read path is covered", async () => {
    const provider = newProvider();
    const uri = "github://acme/catalog";
    await provider.resolveCatalogDir(uri);

    const cloneDir = getClonePath("acme", "catalog", "HEAD");
    ageClone(cloneDir, DEFAULT_MUTABLE_REF_TTL_MS + 1000);
    remote = { sha: "bbbbbbb2222222222222222222222222222222222", payload: { v: 2 } };
    gitCalls = [];

    await provider.resolveCatalogDir(uri);
    expect(fetches()).toHaveLength(1);
    expect(
      JSON.parse(readFileSync(resolve(cloneDir, "skills.json"), "utf-8"))
    ).toEqual({ v: 2 });
  });

  it("collapses concurrent resolves of a stale clone into exactly one fetch", async () => {
    const provider = newProvider();
    const uri = "github://acme/repo/skills.json";
    await provider.resolve(uri, "/tmp");

    ageClone(getClonePath("acme", "repo", "HEAD"), DEFAULT_MUTABLE_REF_TTL_MS + 1000);
    remote = { sha: "bbbbbbb2222222222222222222222222222222222", payload: { v: 2 } };
    gitCalls = [];
    // Hold the working tree in its mid-refresh state long enough that a
    // concurrent resolve would observe it if the lock did not exclude it.
    fetchDelayMs = 120;

    const results = await Promise.all([
      provider.resolve(uri, "/tmp"),
      provider.resolve(uri, "/tmp"),
      provider.resolve(uri, "/tmp"),
      provider.resolve(uri, "/tmp"),
      provider.resolve(uri, "/tmp"),
    ]);

    // One refresh total, and every caller sees a complete, consistent clone.
    expect(fetches()).toHaveLength(1);
    expect(resets()).toHaveLength(1);
    for (const r of results) expect(r).toEqual({ v: 2 });
  });

  it("serves the cached clone when the refresh fails, and backs off for a TTL window", async () => {
    const provider = newProvider();
    const uri = "github://acme/offline/skills.json";
    await provider.resolve(uri, "/tmp");

    ageClone(getClonePath("acme", "offline", "HEAD"), DEFAULT_MUTABLE_REF_TTL_MS + 1000);
    remote = { sha: "bbbbbbb2222222222222222222222222222222222", payload: { v: 2 } };
    fetchFailure = "fatal: unable to access 'https://github.com/': Could not resolve host";
    gitCalls = [];

    // Best-effort: the stale-but-usable clone is served rather than throwing.
    expect(await provider.resolve(uri, "/tmp")).toEqual({ v: 1 });
    expect(fetches()).toHaveLength(1);
    expect(resets()).toHaveLength(0);
    expect(
      logs.some(
        (l) => l.level === "warn" && l.message.includes("serving the cached copy")
      )
    ).toBe(true);

    // A failed attempt still stamps, so an offline machine pays one bounded
    // git call per TTL window instead of one per resolve.
    gitCalls = [];
    expect(await provider.resolve(uri, "/tmp")).toEqual({ v: 1 });
    expect(gitCalls).toEqual([]);
  });

  it("treats a stampless clone (written before TTL support) as stale", async () => {
    const provider = newProvider();
    const uri = "github://acme/legacy/skills.json";
    await provider.resolve(uri, "/tmp");

    // Simulate a cache entry from an older provider version: no stamp file,
    // and a `.git` directory whose mtime is hours old.
    const cloneDir = getClonePath("acme", "legacy", "HEAD");
    rmSync(resolve(cloneDir, ".git", "air-last-fetch"), { force: true });
    const hoursAgo = new Date(Date.now() - 6 * 60 * 60_000);
    utimesSync(resolve(cloneDir, ".git"), hoursAgo, hoursAgo);

    remote = { sha: "bbbbbbb2222222222222222222222222222222222", payload: { v: 2 } };
    gitCalls = [];

    expect(await provider.resolve(uri, "/tmp")).toEqual({ v: 2 });
    expect(fetches()).toHaveLength(1);
    expect(existsSync(resolve(cloneDir, ".git", "air-last-fetch"))).toBe(true);
  });

  it("honors AIR_GIT_CACHE_TTL_MS, including 0 for always-refresh", async () => {
    expect(getMutableRefTtlMs()).toBe(DEFAULT_MUTABLE_REF_TTL_MS);
    process.env.AIR_GIT_CACHE_TTL_MS = "0";
    expect(getMutableRefTtlMs()).toBe(0);
    process.env.AIR_GIT_CACHE_TTL_MS = "not-a-number";
    expect(getMutableRefTtlMs()).toBe(DEFAULT_MUTABLE_REF_TTL_MS);
    process.env.AIR_GIT_CACHE_TTL_MS = "-1";
    expect(getMutableRefTtlMs()).toBe(DEFAULT_MUTABLE_REF_TTL_MS);

    process.env.AIR_GIT_CACHE_TTL_MS = "0";
    const provider = newProvider();
    const uri = "github://acme/hot/skills.json";
    expect(await provider.resolve(uri, "/tmp")).toEqual({ v: 1 });

    remote = { sha: "bbbbbbb2222222222222222222222222222222222", payload: { v: 2 } };
    gitCalls = [];
    expect(await provider.resolve(uri, "/tmp")).toEqual({ v: 2 });
    expect(fetches()).toHaveLength(1);
  });

  it("does not touch the remote at all when nothing is cached yet beyond the clone", async () => {
    const provider = newProvider();
    await provider.resolve("github://acme/fresh/skills.json", "/tmp");
    // A brand-new clone is stamped at publish time, so it must not immediately
    // turn around and refresh itself.
    expect(subcommands()).toEqual(["clone"]);
  });
});
