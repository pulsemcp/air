import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "crypto";
import { mkdirSync, existsSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { McpServerEntry } from "../src/types.js";
import {
  isNpxPrewarmEnabled,
  npxCacheKey,
  buildPrewarmArgs,
  npxCacheDirName,
  parseNpxPackageSpecs,
  planNpxPrewarm,
  prewarmNpxPackages,
  prewarmSharedNpxCache,
  type NpxPrewarmGroup,
  type PrewarmRunResult,
} from "../src/npx-cache.js";

function stdio(command: string, args?: string[], env?: Record<string, string>): McpServerEntry {
  return { type: "stdio", command, ...(args && { args }), ...(env && { env }) } as McpServerEntry;
}

/**
 * npm names `_npx/<hash>` with the first 16 hex chars of a sha512 over the
 * sorted package specs joined by newlines. Reproducing it here pins the claim
 * that `npxCacheKey` returns npm's actual key material.
 */
function npmNpxHash(specs: string[]): string {
  return createHash("sha512").update([...specs].sort().join("\n")).digest("hex").slice(0, 16);
}

describe("parseNpxPackageSpecs", () => {
  it("reads the positional spec from a plain npx invocation", () => {
    expect(parseNpxPackageSpecs("npx", ["-y", "some-mcp-server@latest"])).toEqual([
      "some-mcp-server@latest",
    ]);
  });

  it("ignores arguments that belong to the spawned command", () => {
    expect(parseNpxPackageSpecs("npx", ["-y", "pkg@1.2.3", "--port", "3000"])).toEqual([
      "pkg@1.2.3",
    ]);
  });

  it("collects --package specs and skips the --call body", () => {
    expect(
      parseNpxPackageSpecs("npx", ["--yes", "-p", "a@1", "--package=b@2", "-c", "some cmd"])
    ).toEqual(["a@1", "b@2"]);
  });

  it("accepts npm exec and npm x", () => {
    expect(parseNpxPackageSpecs("npm", ["exec", "-y", "pkg@latest"])).toEqual(["pkg@latest"]);
    expect(parseNpxPackageSpecs("npm", ["x", "pkg@latest"])).toEqual(["pkg@latest"]);
  });

  it("accepts npx via an absolute path or a Windows shim", () => {
    expect(parseNpxPackageSpecs("/usr/local/bin/npx", ["-y", "pkg"])).toEqual(["pkg"]);
    expect(parseNpxPackageSpecs("C:\\Program Files\\nodejs\\npx.cmd", ["-y", "pkg"])).toEqual([
      "pkg",
    ]);
  });

  it("takes the token after -- as the spec", () => {
    expect(parseNpxPackageSpecs("npx", ["-y", "--", "pkg@latest", "serve"])).toEqual([
      "pkg@latest",
    ]);
  });

  it("returns null for non-npx commands", () => {
    expect(parseNpxPackageSpecs("uvx", ["some-tool"])).toBeNull();
    expect(parseNpxPackageSpecs("docker", ["run", "img"])).toBeNull();
    expect(parseNpxPackageSpecs("node", ["server.js"])).toBeNull();
    expect(parseNpxPackageSpecs("npm", ["install", "pkg"])).toBeNull();
  });

  it("refuses to guess when an unrecognized flag could take a value", () => {
    // `--registry https://…` would otherwise make the URL look like the spec.
    expect(parseNpxPackageSpecs("npx", ["--registry", "https://r.example", "pkg"])).toBeNull();
  });

  it("returns null when the spec is still an unresolved ${VAR} placeholder", () => {
    expect(parseNpxPackageSpecs("npx", ["-y", "${PKG_NAME}"])).toBeNull();
    expect(parseNpxPackageSpecs("npx", ["-y", "-p", "pkg@${VERSION}", "-c", "x"])).toBeNull();
  });

  it("returns null when there is no spec at all", () => {
    expect(parseNpxPackageSpecs("npx", [])).toBeNull();
    expect(parseNpxPackageSpecs("npx", ["-y"])).toBeNull();
  });
});

describe("npxCacheKey", () => {
  it("is order-insensitive", () => {
    expect(npxCacheKey(["b@1", "a@2"])).toBe(npxCacheKey(["a@2", "b@1"]));
  });

  it("is the material npm hashes into _npx/<hash>", () => {
    // The directory named in the AO session 11638 crash was _npx/dbbb2997d8a4f060.
    const specs = ["pulsemcp-cms-admin-mcp-server@latest"];
    expect(npmNpxHash(specs)).toBe("dbbb2997d8a4f060");
    expect(npmNpxHash([npxCacheKey(specs)])).toBe(npmNpxHash(specs));
  });
});

describe("planNpxPrewarm", () => {
  it("groups servers that differ only by env — the session 11638 shape", () => {
    const groups = planNpxPrewarm({
      "pulse-goodjobs-ro": stdio("npx", ["-y", "pulsemcp-cms-admin-mcp-server@latest"], {
        TOOL_GROUPS: "goodjobs_ro",
      }),
      "pulse-goodjobs-rw": stdio("npx", ["-y", "pulsemcp-cms-admin-mcp-server@latest"], {
        TOOL_GROUPS: "goodjobs_rw",
      }),
    });

    expect(groups).toEqual([
      {
        packages: ["pulsemcp-cms-admin-mcp-server@latest"],
        servers: ["pulse-goodjobs-ro", "pulse-goodjobs-rw"],
      },
    ]);
  });

  it("groups servers whose extra CLI args differ but whose package matches", () => {
    const groups = planNpxPrewarm({
      a: stdio("npx", ["-y", "pkg@latest", "--mode", "read"]),
      b: stdio("npx", ["pkg@latest", "--mode", "write"]),
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].servers).toEqual(["a", "b"]);
  });

  it("does not prewarm a package only one server uses", () => {
    expect(planNpxPrewarm({ solo: stdio("npx", ["-y", "pkg@latest"]) })).toEqual([]);
  });

  it("keeps distinct packages in distinct groups", () => {
    const groups = planNpxPrewarm({
      a1: stdio("npx", ["-y", "alpha@latest"]),
      a2: stdio("npx", ["-y", "alpha@latest"]),
      b1: stdio("npx", ["-y", "beta@latest"]),
      b2: stdio("npx", ["-y", "beta@latest"]),
      c1: stdio("npx", ["-y", "gamma@latest"]),
    });
    expect(groups.map((g) => g.packages)).toEqual([["alpha@latest"], ["beta@latest"]]);
  });

  it("treats different version specs of one package as different cache entries", () => {
    expect(
      planNpxPrewarm({
        a: stdio("npx", ["-y", "pkg@1.0.0"]),
        b: stdio("npx", ["-y", "pkg@2.0.0"]),
      })
    ).toEqual([]);
  });

  it("ignores remote servers, non-npx commands, and unparseable invocations", () => {
    expect(
      planNpxPrewarm({
        remote1: { type: "streamable-http", url: "https://a.example/mcp" } as McpServerEntry,
        remote2: { type: "streamable-http", url: "https://b.example/mcp" } as McpServerEntry,
        uvx1: stdio("uvx", ["tool"]),
        uvx2: stdio("uvx", ["tool"]),
        weird1: stdio("npx", ["--registry", "https://r.example", "pkg"]),
        weird2: stdio("npx", ["--registry", "https://r.example", "pkg"]),
      })
    ).toEqual([]);
  });

  it("is deterministic in group and server order", () => {
    const servers = {
      zeta: stdio("npx", ["-y", "pkg@latest"]),
      alpha: stdio("npx", ["-y", "pkg@latest"]),
      mid: stdio("npx", ["-y", "pkg@latest"]),
    };
    expect(planNpxPrewarm(servers)[0].servers).toEqual(["alpha", "mid", "zeta"]);
  });
});

describe("planNpxPrewarm — npm-sensitive env", () => {
  it("skips a group whose servers redirect npm at a different registry", () => {
    // The prewarm runs before transforms resolve ${VAR}, so it cannot honor a
    // per-server registry. Installing anyway would put a *public* package of
    // the same name into the directory the servers then execute from.
    expect(
      planNpxPrewarm({
        a: stdio("npx", ["-y", "internal-tool@1.0.0"], {
          NPM_CONFIG_REGISTRY: "https://npm.internal.example",
        }),
        b: stdio("npx", ["-y", "internal-tool@1.0.0"]),
      })
    ).toEqual([]);
  });

  it("skips a group whose servers override the npm cache location", () => {
    expect(
      planNpxPrewarm({
        a: stdio("npx", ["-y", "pkg@1.0.0"], { npm_config_cache: "/somewhere/else" }),
        b: stdio("npx", ["-y", "pkg@1.0.0"]),
      })
    ).toEqual([]);
  });

  it("skips a group carrying a registry auth token", () => {
    expect(
      planNpxPrewarm({
        a: stdio("npx", ["-y", "pkg@1.0.0"], { NPM_TOKEN: "${NPM_TOKEN}" }),
        b: stdio("npx", ["-y", "pkg@1.0.0"]),
      })
    ).toEqual([]);
  });

  it("still prewarms groups whose env is unrelated to npm", () => {
    expect(
      planNpxPrewarm({
        a: stdio("npx", ["-y", "pkg@1.0.0"], { TOOL_GROUPS: "ro", API_KEY: "${K}" }),
        b: stdio("npx", ["-y", "pkg@1.0.0"], { TOOL_GROUPS: "rw" }),
      })
    ).toHaveLength(1);
  });

  it("accepts raw agent-config entries, not just McpServerEntry", () => {
    // Adapters pass the merged map they just wrote, which contains untyped
    // user-authored entries alongside AIR-managed ones.
    const groups = planNpxPrewarm({
      "air-managed": { command: "npx", args: ["-y", "pkg@1.0.0"], env: { A: "1" } },
      "user-added": { command: "npx", args: ["-y", "pkg@1.0.0", "--flag"] },
      "not-an-object": "nonsense",
      "no-command": { args: ["-y", "pkg@1.0.0"] },
      "bad-args": { command: "npx", args: [1, 2] },
    });
    expect(groups).toEqual([
      { packages: ["pkg@1.0.0"], servers: ["air-managed", "user-added"] },
    ]);
  });
});

describe("buildPrewarmArgs", () => {
  const group = { packages: ["a@1", "b@2"], servers: ["x", "y"] };

  it("installs every spec and runs a no-op instead of the package bin", () => {
    expect(buildPrewarmArgs(group, "linux")).toEqual([
      "--yes",
      "--package",
      "a@1",
      "--package",
      "b@2",
      "--call",
      "node --version",
    ]);
  });

  it("quotes the --call value on win32, where argv is joined for cmd.exe", () => {
    // Unquoted, cmd.exe splits it and npm sees a bare `--version`, which it
    // answers by printing its version and exiting 0 — installing nothing while
    // reporting success.
    expect(buildPrewarmArgs(group, "win32").at(-1)).toBe('"node --version"');
  });
});

describe("npxCacheDirName", () => {
  it("reproduces the directory npm named in the reported crash", () => {
    expect(npxCacheDirName(["pulsemcp-cms-admin-mcp-server@latest"])).toBe("dbbb2997d8a4f060");
  });

  it("is order-insensitive, like the key it hashes", () => {
    expect(npxCacheDirName(["b@1", "a@2"])).toBe(npxCacheDirName(["a@2", "b@1"]));
  });
});

describe("prewarmNpxPackages", () => {
  const group = (name: string): NpxPrewarmGroup => ({
    packages: [name],
    servers: [`${name}-a`, `${name}-b`],
  });

  /** A cache root in the env keeps reconcileFailure from shelling out to npm. */
  let cacheDir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    cacheDir = join(tmpdir(), `air-npxcache-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(cacheDir, { recursive: true });
    env = { NPM_CONFIG_CACHE: cacheDir };
  });

  afterEach(() => rmSync(cacheDir, { recursive: true, force: true }));

  function installDir(packages: string[]): string {
    return join(cacheDir, "_npx", npxCacheDirName(packages));
  }

  /** Materialize an npx cache entry; `complete` writes the hidden lockfile. */
  function seedInstall(packages: string[], complete: boolean): string {
    const dir = installDir(packages);
    mkdirSync(join(dir, "node_modules", "some-dep"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "some-dep", "index.js"), "//\n");
    if (complete) writeFileSync(join(dir, "node_modules", ".package-lock.json"), "{}");
    return dir;
  }

  it("runs each group once and reports success", async () => {
    const seen: string[][] = [];
    const outcomes = await prewarmNpxPackages([group("alpha"), group("beta")], {
      env,
      runner: async (g) => {
        seen.push(g.packages);
        return { ok: true };
      },
    });
    expect(seen).toEqual([["alpha"], ["beta"]]);
    expect(outcomes.map((o) => o.status)).toEqual(["warmed", "warmed"]);
  });

  it("runs groups serially so two prewarms never share a cache entry", async () => {
    const events: string[] = [];
    await prewarmNpxPackages([group("alpha"), group("beta")], {
      env,
      runner: async (g) => {
        events.push(`start:${g.packages[0]}`);
        await new Promise((r) => setImmediate(r));
        events.push(`end:${g.packages[0]}`);
        return { ok: true };
      },
    });
    expect(events).toEqual(["start:alpha", "end:alpha", "start:beta", "end:beta"]);
  });

  it("reports a failing group without throwing, and keeps going", async () => {
    const outcomes = await prewarmNpxPackages([group("alpha"), group("beta")], {
      env,
      runner: async (g) =>
        g.packages[0] === "alpha" ? { ok: false, error: "ENOTFOUND registry" } : { ok: true },
    });
    expect(outcomes[0]).toMatchObject({ status: "failed", error: "ENOTFOUND registry" });
    expect(outcomes[1].status).toBe("warmed");
  });

  it("converts a thrown runner error into a failed outcome", async () => {
    const outcomes = await prewarmNpxPackages([group("alpha")], {
      env,
      runner: async () => {
        throw new Error("spawn npx ENOENT");
      },
    });
    expect(outcomes[0]).toMatchObject({ status: "failed", error: "spawn npx ENOENT" });
  });

  it("discards a half-written tree left by a killed install", async () => {
    // A prewarm killed at its timeout can leave exactly the partial tree this
    // feature exists to prevent — worse than never having run.
    const dir = seedInstall(["alpha"], false);
    const outcomes = await prewarmNpxPackages([group("alpha")], {
      env,
      runner: async () => ({ ok: false, error: "timed out" }),
    });
    expect(outcomes[0].status).toBe("failed");
    expect(existsSync(dir)).toBe(false);
  });

  it("treats a failure over an already-complete tree as warmed", async () => {
    // Offline `air prepare` against a warm cache: npm cannot resolve the tag,
    // but the servers will still find everything they need.
    const dir = seedInstall(["alpha"], true);
    const outcomes = await prewarmNpxPackages([group("alpha")], {
      env,
      runner: async () => ({ ok: false, error: "ENOTFOUND registry" }),
    });
    expect(outcomes[0].status).toBe("warmed");
    expect(existsSync(dir)).toBe(true);
  });

  it("never removes a path that is not an npx cache entry", async () => {
    const stray = join(cacheDir, "_npx", "not-a-hash");
    mkdirSync(stray, { recursive: true });
    await prewarmNpxPackages([group("alpha")], {
      env,
      runner: async () => ({ ok: false, error: "timed out" }),
    });
    expect(existsSync(stray)).toBe(true);
  });

  it("skips remaining groups once the total time budget is spent", async () => {
    let now = 0;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const outcomes = await prewarmNpxPackages([group("alpha"), group("beta")], {
        env,
        totalTimeoutMs: 100,
        runner: async () => {
          now += 500;
          return { ok: true };
        },
      });
      expect(outcomes.map((o) => o.status)).toEqual(["warmed", "skipped"]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("prewarmSharedNpxCache", () => {
  const colliding = {
    ro: stdio("npx", ["-y", "pkg@latest"], { TOOL_GROUPS: "ro" }),
    rw: stdio("npx", ["-y", "pkg@latest"], { TOOL_GROUPS: "rw" }),
  };
  const env: NodeJS.ProcessEnv = { NPM_CONFIG_CACHE: join(tmpdir(), "air-nonexistent-cache") };

  it("performs no work when nothing collides", async () => {
    const runner = vi.fn(async () => ({ ok: true }));
    const report = await prewarmSharedNpxCache(
      { solo: stdio("npx", ["-y", "pkg@latest"]) },
      { runner, env }
    );
    expect(runner).not.toHaveBeenCalled();
    expect(report).toEqual({ outcomes: [], warnings: [] });
  });

  it("warms a collision group and emits no warnings on success", async () => {
    const runner = vi.fn(async () => ({ ok: true }));
    const report = await prewarmSharedNpxCache(colliding, { runner, env });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(report.outcomes[0].status).toBe("warmed");
    expect(report.warnings).toEqual([]);
  });

  it("names the packages and the affected servers when a prewarm fails", async () => {
    const report = await prewarmSharedNpxCache(colliding, {
      env,
      runner: async () => ({ ok: false, error: "timed out" }),
    });
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toContain("pkg@latest");
    expect(report.warnings[0]).toContain("ro, rw");
    expect(report.warnings[0]).toContain("timed out");
  });

  it("does no I/O when disabled by option or by AIR_NPX_PREWARM", async () => {
    const runner = vi.fn(async () => ({ ok: true }));
    const byOption = await prewarmSharedNpxCache(colliding, { runner, env, enabled: false });
    expect(byOption.outcomes[0].status).toBe("skipped");
    const byEnv = await prewarmSharedNpxCache(colliding, {
      runner,
      env: { ...env, AIR_NPX_PREWARM: "0" },
    });
    expect(byEnv.outcomes[0].status).toBe("skipped");
    expect(runner).not.toHaveBeenCalled();
  });

  it("lets an explicit option override the environment", async () => {
    const runner = vi.fn(async () => ({ ok: true }));
    await prewarmSharedNpxCache(colliding, {
      runner,
      enabled: true,
      env: { ...env, AIR_NPX_PREWARM: "0" },
    });
    expect(runner).toHaveBeenCalledTimes(1);
  });
});

describe("isNpxPrewarmEnabled", () => {
  it("defaults to on", () => {
    expect(isNpxPrewarmEnabled({})).toBe(true);
  });

  it("is off for explicit off values only", () => {
    for (const value of ["0", "false", "off", "no", "FALSE", " off "]) {
      expect(isNpxPrewarmEnabled({ AIR_NPX_PREWARM: value })).toBe(false);
    }
    for (const value of ["1", "true", "on", "yes"]) {
      expect(isNpxPrewarmEnabled({ AIR_NPX_PREWARM: value })).toBe(true);
    }
  });
});
