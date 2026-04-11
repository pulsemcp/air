import { describe, it, expect, afterEach } from "vitest";
import { resolve, join, dirname } from "path";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "fs";
import { execFileSync } from "child_process";
import { tmpdir } from "os";
import { updateProviderCaches } from "../src/update.js";

const tempDirs: string[] = [];
let origHome: string | undefined;
let origAirConfig: string | undefined;

afterEach(() => {
  if (origHome !== undefined) {
    process.env.HOME = origHome;
    origHome = undefined;
  }
  if (origAirConfig !== undefined) {
    if (origAirConfig === "") {
      delete process.env.AIR_CONFIG;
    } else {
      process.env.AIR_CONFIG = origAirConfig;
    }
    origAirConfig = undefined;
  }
  for (const dir of tempDirs) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  tempDirs.length = 0;
});

function createTempDir(): string {
  const dir = resolve(
    tmpdir(),
    `air-sdk-update-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

/**
 * Create a bare git repo and a shallow clone of it in the cache directory.
 * This simulates a cached GitHub clone at ~/.air/cache/github/{owner}/{repo}/{ref}.
 */
function createCachedClone(
  fakeHome: string,
  owner: string,
  repo: string,
  ref: string
): string {
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "test",
    GIT_AUTHOR_EMAIL: "test@test.com",
    GIT_COMMITTER_NAME: "test",
    GIT_COMMITTER_EMAIL: "test@test.com",
  };

  // Create a "remote" repo with the desired branch name and one commit
  const remoteDir = join(fakeHome, ".air-remotes", owner, repo);
  mkdirSync(remoteDir, { recursive: true });
  execFileSync("git", ["init", "--initial-branch", ref], { cwd: remoteDir, stdio: "pipe", env: gitEnv });
  writeFileSync(join(remoteDir, "README.md"), "test");
  execFileSync("git", ["add", "."], { cwd: remoteDir, stdio: "pipe", env: gitEnv });
  execFileSync("git", ["commit", "-m", "init"], { cwd: remoteDir, stdio: "pipe", env: gitEnv });

  // Clone into the cache directory structure
  const cacheDir = join(fakeHome, ".air", "cache", "github", owner, repo, ref);
  mkdirSync(join(fakeHome, ".air", "cache", "github", owner, repo), { recursive: true });
  execFileSync("git", ["clone", "--depth", "1", "--branch", ref, remoteDir, cacheDir], { stdio: "pipe", env: gitEnv });

  return cacheDir;
}

function setFakeHome(dir: string): void {
  origHome = process.env.HOME;
  origAirConfig = process.env.AIR_CONFIG ?? "";
  process.env.HOME = dir;
  delete process.env.AIR_CONFIG;
}

describe("updateProviderCaches", () => {
  it("discovers providers from cache directory when air.json has no extensions", async () => {
    const fakeHome = createTempDir();
    setFakeHome(fakeHome);

    // Create air.json with empty extensions
    const airDir = join(fakeHome, ".air");
    mkdirSync(airDir, { recursive: true });
    writeFileSync(
      join(airDir, "air.json"),
      JSON.stringify({ name: "test", extensions: [] })
    );

    // Create a cached clone
    createCachedClone(fakeHome, "test-owner", "test-repo", "main");

    const { results } = await updateProviderCaches({
      config: join(airDir, "air.json"),
    });

    // Provider should be discovered from cache directory
    expect(results).toHaveProperty("github");
    expect(results.github.length).toBeGreaterThan(0);

    const entry = results.github.find((r) =>
      r.label.includes("test-owner/test-repo@main")
    );
    expect(entry).toBeDefined();
    expect(typeof entry!.updated).toBe("boolean");
  }, 30000);

  it("loads provider from air.json extensions (regression)", async () => {
    const fakeHome = createTempDir();
    setFakeHome(fakeHome);

    // Create air.json that lists the GitHub provider in extensions
    const airDir = join(fakeHome, ".air");
    mkdirSync(airDir, { recursive: true });
    writeFileSync(
      join(airDir, "air.json"),
      JSON.stringify({
        name: "test",
        extensions: ["@pulsemcp/air-provider-github"],
      })
    );

    // Create a cached clone
    createCachedClone(fakeHome, "test-owner", "test-repo", "main");

    const { results } = await updateProviderCaches({
      config: join(airDir, "air.json"),
    });

    // Provider should be loaded from air.json extensions
    expect(results).toHaveProperty("github");
    expect(results.github.length).toBeGreaterThan(0);

    const entry = results.github.find((r) =>
      r.label.includes("test-owner/test-repo@main")
    );
    expect(entry).toBeDefined();
    expect(typeof entry!.updated).toBe("boolean");
  }, 30000);

  it("discovers providers from cache directory when air.json does not exist", async () => {
    const fakeHome = createTempDir();
    setFakeHome(fakeHome);

    // Create a cached clone but no air.json
    createCachedClone(fakeHome, "test-owner", "test-repo", "main");

    const { results } = await updateProviderCaches();

    // Provider should be discovered from cache directory even without air.json
    expect(results).toHaveProperty("github");
    expect(results.github.length).toBeGreaterThan(0);
  }, 30000);

  it("returns empty results when no cache directory exists", async () => {
    const fakeHome = createTempDir();
    setFakeHome(fakeHome);

    // No cache directory and no air.json
    const { results } = await updateProviderCaches();

    expect(Object.keys(results)).toEqual([]);
  });

  it("returns empty results when cache directory has no known provider schemes", async () => {
    const fakeHome = createTempDir();
    setFakeHome(fakeHome);

    // Create a cache directory with an unknown scheme
    mkdirSync(join(fakeHome, ".air", "cache", "unknown-provider"), { recursive: true });

    const { results } = await updateProviderCaches();

    expect(Object.keys(results)).toEqual([]);
  });

  it("refreshes cached clone and reports update status", async () => {
    const fakeHome = createTempDir();
    setFakeHome(fakeHome);

    const owner = "test-owner";
    const repo = "test-repo";
    const ref = "main";

    // Create a cached clone
    createCachedClone(fakeHome, owner, repo, ref);

    // Push a new commit to the remote so the clone is stale
    const remoteDir = join(fakeHome, ".air-remotes", owner, repo);
    const gitEnv = {
      ...process.env,
      HOME: fakeHome,
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@test.com",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@test.com",
    };
    writeFileSync(join(remoteDir, "new-file.txt"), "new content");
    execFileSync("git", ["add", "."], { cwd: remoteDir, stdio: "pipe", env: gitEnv });
    execFileSync("git", ["commit", "-m", "update"], { cwd: remoteDir, stdio: "pipe", env: gitEnv });

    const { results } = await updateProviderCaches();

    expect(results).toHaveProperty("github");
    const entry = results.github.find((r) =>
      r.label.includes(`${owner}/${repo}@${ref}`)
    );
    expect(entry).toBeDefined();
    expect(entry!.updated).toBe(true);
    expect(entry!.message).toContain("→");
  }, 30000);

  it("reports already up-to-date when clone matches remote", async () => {
    const fakeHome = createTempDir();
    setFakeHome(fakeHome);

    // Create a cached clone (no new commits pushed)
    createCachedClone(fakeHome, "test-owner", "test-repo", "main");

    const { results } = await updateProviderCaches();

    expect(results).toHaveProperty("github");
    const entry = results.github.find((r) =>
      r.label.includes("test-owner/test-repo@main")
    );
    expect(entry).toBeDefined();
    expect(entry!.updated).toBe(false);
    expect(entry!.message).toContain("up-to-date");
  }, 30000);

  it("auto-heals a stale provider via pre-flight upgrade then refreshes the cache", async () => {
    const fakeHome = createTempDir();
    setFakeHome(fakeHome);

    // Set up <airDir>/node_modules/@pulsemcp/air-provider-github at an
    // older version that lacks refreshCache, mirroring a user whose
    // ~/.air install hasn't kept up with the CLI.
    const airDir = join(fakeHome, ".air");
    const pkgDir = join(
      airDir,
      "node_modules",
      "@pulsemcp",
      "air-provider-github"
    );
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "@pulsemcp/air-provider-github",
        version: "0.0.13",
        type: "module",
        main: "./index.mjs",
      })
    );
    writeFileSync(
      join(pkgDir, "index.mjs"),
      `export default {
  name: "stale-github-provider",
  provider: {
    scheme: "github",
    async resolve() { return { type: "raw", data: {} }; },
  },
};
`
    );

    writeFileSync(
      join(airDir, "air.json"),
      JSON.stringify({
        name: "test",
        extensions: ["@pulsemcp/air-provider-github"],
      })
    );

    // Cached data must exist on disk so the upgrade path is reached.
    createCachedClone(fakeHome, "test-owner", "test-repo", "main");

    // Stub `npm install` — instead of touching the network, overwrite
    // the on-disk package with a fresh "upgraded" version that exposes
    // a working refreshCache method. The pre-flight upgrade runs BEFORE
    // any provider module is loaded, so the SDK loads this version.
    const runNpmInstallLatest = async (
      packageName: string,
      prefix: string
    ): Promise<{ ok: boolean; stderr: string }> => {
      expect(packageName).toBe("@pulsemcp/air-provider-github");
      expect(prefix).toBe(airDir);

      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({
          name: packageName,
          version: "9.9.9",
          type: "module",
          main: "./index.mjs",
        })
      );
      writeFileSync(
        join(pkgDir, "index.mjs"),
        `export default {
  name: "fresh-github-provider",
  provider: {
    scheme: "github",
    async resolve() { return { type: "raw", data: {} }; },
    async refreshCache() {
      return [{ label: "stub/refresh@main", updated: true, message: "stub-refreshed" }];
    },
  },
};
`
      );
      return { ok: true, stderr: "" };
    };

    const { results } = await updateProviderCaches({
      config: join(airDir, "air.json"),
      runNpmInstallLatest,
    });

    expect(results).toHaveProperty("github");
    const entries = results.github;
    // First entry is the upgrade notice, then the refreshCache results.
    expect(entries.length).toBeGreaterThanOrEqual(2);

    const upgrade = entries[0];
    expect(upgrade.updated).toBe(true);
    expect(upgrade.label).toBe("@pulsemcp/air-provider-github");
    expect(upgrade.message).toMatch(/upgraded provider package 0\.0\.13 → 9\.9\.9/);

    const refreshed = entries.find((e) => e.label === "stub/refresh@main");
    expect(refreshed).toBeDefined();
    expect(refreshed!.updated).toBe(true);
    expect(refreshed!.message).toBe("stub-refreshed");
  }, 30000);

  it("does not run pre-flight upgrade when installed provider already meets the minimum version", async () => {
    const fakeHome = createTempDir();
    setFakeHome(fakeHome);

    const airDir = join(fakeHome, ".air");
    const pkgDir = join(
      airDir,
      "node_modules",
      "@pulsemcp",
      "air-provider-github"
    );
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "@pulsemcp/air-provider-github",
        version: "0.0.99",
        type: "module",
        main: "./index.mjs",
      })
    );
    writeFileSync(
      join(pkgDir, "index.mjs"),
      `export default {
  name: "fresh-github-provider",
  provider: {
    scheme: "github",
    async resolve() { return { type: "raw", data: {} }; },
    async refreshCache() {
      return [{ label: "noop", updated: false, message: "ok" }];
    },
  },
};
`
    );

    writeFileSync(
      join(airDir, "air.json"),
      JSON.stringify({
        name: "test",
        extensions: ["@pulsemcp/air-provider-github"],
      })
    );

    createCachedClone(fakeHome, "test-owner", "test-repo", "main");

    let installCalls = 0;
    const runNpmInstallLatest = async () => {
      installCalls += 1;
      return { ok: true, stderr: "" };
    };

    const { results } = await updateProviderCaches({
      config: join(airDir, "air.json"),
      runNpmInstallLatest,
    });

    expect(installCalls).toBe(0);
    expect(results.github).toBeDefined();
    // No upgrade notice — first entry should be the refreshCache result.
    expect(results.github[0].label).toBe("noop");
  }, 30000);

  it("emits a diagnostic when auto-heal is disabled and the provider lacks refreshCache", async () => {
    const fakeHome = createTempDir();
    setFakeHome(fakeHome);

    const airDir = join(fakeHome, ".air");
    const pkgDir = join(
      airDir,
      "node_modules",
      "@pulsemcp",
      "air-provider-github"
    );
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "@pulsemcp/air-provider-github",
        version: "0.0.13",
        type: "module",
        main: "./index.mjs",
      })
    );
    writeFileSync(
      join(pkgDir, "index.mjs"),
      `export default {
  name: "stale-github-provider",
  provider: {
    scheme: "github",
    async resolve() { return { type: "raw", data: {} }; },
  },
};
`
    );

    writeFileSync(
      join(airDir, "air.json"),
      JSON.stringify({
        name: "test",
        extensions: ["@pulsemcp/air-provider-github"],
      })
    );

    createCachedClone(fakeHome, "test-owner", "test-repo", "main");

    const { results } = await updateProviderCaches({
      config: join(airDir, "air.json"),
      autoHeal: false,
    });

    expect(results).toHaveProperty("github");
    expect(results.github).toHaveLength(1);
    const entry = results.github[0];
    expect(entry.updated).toBe(false);
    expect(entry.message).toMatch(/does not support cache refresh/);
    expect(entry.message).toMatch(/@pulsemcp\/air-provider-github@latest/);
  }, 30000);

  it("surfaces failure details when pre-flight upgrade fails", async () => {
    const fakeHome = createTempDir();
    setFakeHome(fakeHome);

    const airDir = join(fakeHome, ".air");
    const pkgDir = join(
      airDir,
      "node_modules",
      "@pulsemcp",
      "air-provider-github"
    );
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "@pulsemcp/air-provider-github",
        version: "0.0.13",
        type: "module",
        main: "./index.mjs",
      })
    );
    writeFileSync(
      join(pkgDir, "index.mjs"),
      `export default {
  name: "stale-github-provider",
  provider: {
    scheme: "github",
    async resolve() { return { type: "raw", data: {} }; },
  },
};
`
    );

    writeFileSync(
      join(airDir, "air.json"),
      JSON.stringify({
        name: "test",
        extensions: ["@pulsemcp/air-provider-github"],
      })
    );

    createCachedClone(fakeHome, "test-owner", "test-repo", "main");

    const runNpmInstallLatest = async () => ({
      ok: false,
      stderr: "EACCES: permission denied",
    });

    const { results } = await updateProviderCaches({
      config: join(airDir, "air.json"),
      runNpmInstallLatest,
    });

    expect(results).toHaveProperty("github");
    expect(results.github.length).toBeGreaterThanOrEqual(2);

    const failureNotice = results.github[0];
    expect(failureNotice.updated).toBe(false);
    expect(failureNotice.label).toBe("@pulsemcp/air-provider-github");
    expect(failureNotice.message).toMatch(/failed to auto-upgrade/);
    expect(failureNotice.message).toMatch(/EACCES/);

    const diagnostic = results.github[1];
    expect(diagnostic.updated).toBe(false);
    expect(diagnostic.message).toMatch(/does not support cache refresh/);
  }, 30000);

  it("does not emit diagnostics for providers without cached data on disk", async () => {
    const fakeHome = createTempDir();
    setFakeHome(fakeHome);

    // Provider listed in air.json (stale), but no cache dir — nothing
    // to refresh, so the command should stay silent (empty results).
    const airDir = join(fakeHome, ".air");
    const pkgDir = join(
      airDir,
      "node_modules",
      "@pulsemcp",
      "air-provider-github"
    );
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "@pulsemcp/air-provider-github",
        version: "0.0.13",
        type: "module",
        main: "./index.mjs",
      })
    );
    writeFileSync(
      join(pkgDir, "index.mjs"),
      `export default {
  name: "stale-github-provider",
  provider: {
    scheme: "github",
    async resolve() { return { type: "raw", data: {} }; },
  },
};
`
    );

    writeFileSync(
      join(airDir, "air.json"),
      JSON.stringify({
        name: "test",
        extensions: ["@pulsemcp/air-provider-github"],
      })
    );

    const { results } = await updateProviderCaches({
      config: join(airDir, "air.json"),
      runNpmInstallLatest: async () => ({ ok: true, stderr: "" }),
    });

    expect(Object.keys(results)).toEqual([]);
  });

  it("skips immutable refs (full SHA)", async () => {
    const fakeHome = createTempDir();
    setFakeHome(fakeHome);

    // Use a 40-char hex string as the ref (simulates a commit SHA)
    const sha = "a".repeat(40);
    createCachedClone(fakeHome, "test-owner", "test-repo", sha);

    const { results } = await updateProviderCaches();

    expect(results).toHaveProperty("github");
    const entry = results.github.find((r) =>
      r.label.includes(`test-owner/test-repo@${sha}`)
    );
    expect(entry).toBeDefined();
    expect(entry!.updated).toBe(false);
    expect(entry!.message).toContain("immutable");
  }, 30000);
});
