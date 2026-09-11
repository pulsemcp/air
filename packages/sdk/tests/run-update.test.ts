import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import {
  runUpdate,
  type RunUpdateOptions,
  type VersionBump,
} from "../src/run-update.js";

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
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

/**
 * Build an isolated `~/.air`-shaped directory and point HOME at it, so
 * nothing in these tests can reach the developer's real cache or config.
 */
function createAirDir(opts: {
  extensions?: unknown[];
  dependencies?: Record<string, string>;
  installed?: Record<string, string>;
  /**
   * Write the installed packages with no entry point, so loading them fails.
   * Models the stale-extension state that breaks the cache refresh.
   */
  unloadable?: boolean;
}): string {
  const dir = resolve(
    tmpdir(),
    `air-sdk-run-update-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);

  origHome ??= process.env.HOME;
  origAirConfig ??= process.env.AIR_CONFIG ?? "";
  process.env.HOME = dir;
  delete process.env.AIR_CONFIG;

  writeFileSync(
    join(dir, "air.json"),
    JSON.stringify(
      { name: "test", extensions: opts.extensions ?? [] },
      null,
      2
    )
  );
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: "air-extensions",
        private: true,
        dependencies: opts.dependencies ?? {},
      },
      null,
      2
    ) + "\n"
  );

  for (const [name, version] of Object.entries(opts.installed ?? {})) {
    const pkgDir = join(dir, "node_modules", name);
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify(
        opts.unloadable
          ? { name, version }
          : { name, version, type: "module", main: "index.js" }
      )
    );
    if (!opts.unloadable) {
      // A minimal, loadable AirExtension so the cache-refresh step can import
      // it. Without an entry point the loader throws, which a separate test
      // covers deliberately.
      writeFileSync(
        join(pkgDir, "index.js"),
        `export default { name: ${JSON.stringify(name)} };\n`
      );
    }
  }

  return dir;
}

/**
 * A stale tree in the shape issue #132 describes: an extension several minors
 * behind a CLI that itself has a newer version published.
 */
function staleAirDir(): string {
  return createAirDir({
    extensions: ["@pulsemcp/air-adapter-claude"],
    dependencies: { "@pulsemcp/air-adapter-claude": "^0.0.25" },
    installed: { "@pulsemcp/air-adapter-claude": "0.0.25" },
  });
}

/** Records every install this run would have performed. */
interface Spy {
  globalInstalls: string[];
  extensionInstalls: string[];
  options: Pick<
    RunUpdateOptions,
    "runNpmInstallGlobal" | "runNpmInstall" | "runNpmInstallLatest"
  >;
}

function createSpy(opts?: { globalOk?: boolean }): Spy {
  const globalInstalls: string[] = [];
  const extensionInstalls: string[] = [];
  return {
    globalInstalls,
    extensionInstalls,
    options: {
      runNpmInstallGlobal: async (specifier) => {
        globalInstalls.push(specifier);
        return opts?.globalOk === false
          ? { ok: false, stderr: "EACCES: permission denied" }
          : { ok: true, stderr: "" };
      },
      runNpmInstall: async (prefix) => {
        extensionInstalls.push(prefix);
        return { ok: true, stderr: "" };
      },
      runNpmInstallLatest: async () => ({ ok: true, stderr: "" }),
    },
  };
}

const latest = (version: string) => async () => version;

describe("runUpdate — the consent gate", () => {
  it("installs nothing when there is no way to ask and no --yes (the CI path)", async () => {
    const dir = staleAirDir();
    const spy = createSpy();

    const result = await runUpdate({
      cliVersion: "0.13.1",
      config: join(dir, "air.json"),
      getLatestVersion: latest("0.14.0"),
      // No `confirm` — this is exactly what the CLI passes when stdin or
      // stdout is not a TTY.
      ...spy.options,
    });

    expect(result.versionCheck.decision).toBe("non-interactive");
    // The whole point of the issue: CI is never surprise-bumped.
    expect(spy.globalInstalls).toEqual([]);
    expect(spy.extensionInstalls).toEqual([]);
    expect(result.versionCheck.cliUpgraded).toBe(false);
    // It still *reported* what it found, so a human reading the log knows.
    expect(result.versionCheck.bumps.map((b) => b.packageName)).toEqual([
      "@pulsemcp/air-cli",
      "@pulsemcp/air-adapter-claude",
    ]);
  });

  it("installs when --yes is passed, without ever calling confirm", async () => {
    const dir = staleAirDir();
    const spy = createSpy();
    let confirmCalls = 0;

    const result = await runUpdate({
      cliVersion: "0.13.1",
      config: join(dir, "air.json"),
      getLatestVersion: latest("0.14.0"),
      assumeYes: true,
      confirm: async () => {
        confirmCalls++;
        return false;
      },
      ...spy.options,
    });

    expect(result.versionCheck.decision).toBe("applied");
    expect(confirmCalls).toBe(0);
    expect(spy.globalInstalls).toEqual(["@pulsemcp/air-cli@latest"]);
    expect(spy.extensionInstalls).toEqual([dir]);
    expect(result.versionCheck.cliUpgraded).toBe(true);
    expect(result.versionCheck.extensions?.upgraded).toEqual([
      "@pulsemcp/air-adapter-claude",
    ]);
  });

  it("installs nothing when the confirmation is declined", async () => {
    const dir = staleAirDir();
    const spy = createSpy();

    const result = await runUpdate({
      cliVersion: "0.13.1",
      config: join(dir, "air.json"),
      getLatestVersion: latest("0.14.0"),
      confirm: async () => false,
      ...spy.options,
    });

    expect(result.versionCheck.decision).toBe("declined");
    expect(spy.globalInstalls).toEqual([]);
    expect(spy.extensionInstalls).toEqual([]);
  });

  it("installs when the confirmation is accepted", async () => {
    const dir = staleAirDir();
    const spy = createSpy();
    let seen: VersionBump[] = [];

    const result = await runUpdate({
      cliVersion: "0.13.1",
      config: join(dir, "air.json"),
      getLatestVersion: latest("0.14.0"),
      confirm: async (bumps) => {
        seen = bumps;
        return true;
      },
      ...spy.options,
    });

    expect(result.versionCheck.decision).toBe("applied");
    expect(spy.globalInstalls).toEqual(["@pulsemcp/air-cli@latest"]);
    // The user was shown exactly what was then installed.
    expect(seen.map((b) => `${b.packageName} ${b.currentVersion}→${b.target}`)).toEqual([
      "@pulsemcp/air-cli 0.13.1→0.14.0",
      "@pulsemcp/air-adapter-claude 0.0.25→~0.14.0",
    ]);
  });

  it("reports the plan before asking, so the prompt describes what is shown", async () => {
    const dir = staleAirDir();
    const spy = createSpy();
    const order: string[] = [];

    await runUpdate({
      cliVersion: "0.13.1",
      config: join(dir, "air.json"),
      getLatestVersion: latest("0.14.0"),
      onCachesRefreshed: () => order.push("caches"),
      onPlan: (plan) => order.push(`plan:${plan.bumps.length}`),
      confirm: async () => {
        order.push("confirm");
        return false;
      },
      ...spy.options,
    });

    expect(order).toEqual(["caches", "plan:2", "confirm"]);
  });

  it("never asks when nothing needs a bump", async () => {
    const dir = createAirDir({
      extensions: ["@pulsemcp/air-adapter-claude"],
      dependencies: { "@pulsemcp/air-adapter-claude": "~0.13.0" },
      installed: { "@pulsemcp/air-adapter-claude": "0.13.1" },
    });
    const spy = createSpy();
    let confirmCalls = 0;

    const result = await runUpdate({
      cliVersion: "0.13.1",
      config: join(dir, "air.json"),
      getLatestVersion: latest("0.13.1"),
      confirm: async () => {
        confirmCalls++;
        return true;
      },
      ...spy.options,
    });

    expect(result.versionCheck.decision).toBe("not-needed");
    expect(result.versionCheck.bumps).toEqual([]);
    expect(confirmCalls).toBe(0);
    expect(spy.globalInstalls).toEqual([]);
  });
});

describe("runUpdate — flags", () => {
  it("--no-upgrade reports the bumps but installs nothing", async () => {
    const dir = staleAirDir();
    const spy = createSpy();
    let confirmCalls = 0;

    const result = await runUpdate({
      cliVersion: "0.13.1",
      config: join(dir, "air.json"),
      getLatestVersion: latest("0.14.0"),
      upgrade: false,
      assumeYes: true,
      confirm: async () => {
        confirmCalls++;
        return true;
      },
      ...spy.options,
    });

    expect(result.versionCheck.decision).toBe("disabled");
    // --no-upgrade beats --yes: the user asked for caches only.
    expect(confirmCalls).toBe(0);
    expect(spy.globalInstalls).toEqual([]);
    expect(spy.extensionInstalls).toEqual([]);
    expect(result.versionCheck.bumps).toHaveLength(2);
  });

  it("--dry-run plans without touching the manifest", async () => {
    const dir = staleAirDir();
    const spy = createSpy();
    const manifestBefore = join(dir, "package.json");

    const result = await runUpdate({
      cliVersion: "0.13.1",
      config: join(dir, "air.json"),
      getLatestVersion: latest("0.14.0"),
      dryRun: true,
      assumeYes: true,
      ...spy.options,
    });

    expect(result.versionCheck.decision).toBe("dry-run");
    expect(spy.globalInstalls).toEqual([]);
    expect(spy.extensionInstalls).toEqual([]);
    expect(result.versionCheck.extensions?.manifestUpdated).toBe(false);
    expect(
      JSON.parse(readFileSync(manifestBefore, "utf-8")).dependencies
    ).toEqual({
      "@pulsemcp/air-adapter-claude": "^0.0.25",
    });
  });

  it("--no-extensions considers only the CLI", async () => {
    const dir = staleAirDir();
    const spy = createSpy();

    const result = await runUpdate({
      cliVersion: "0.13.1",
      config: join(dir, "air.json"),
      getLatestVersion: latest("0.14.0"),
      extensions: false,
      assumeYes: true,
      ...spy.options,
    });

    expect(result.versionCheck.extensionPlans).toEqual([]);
    expect(result.versionCheck.bumps.map((b) => b.packageName)).toEqual([
      "@pulsemcp/air-cli",
    ]);
    expect(spy.globalInstalls).toEqual(["@pulsemcp/air-cli@latest"]);
    expect(spy.extensionInstalls).toEqual([]);
  });
});

describe("runUpdate — the two halves", () => {
  it("upgrades stale extensions even when the CLI is already current", async () => {
    // The #131/#132 report: `air update` succeeded, the CLI was fine, and the
    // extensions that actually run were still on 0.0.x.
    const dir = staleAirDir();
    const spy = createSpy();

    const result = await runUpdate({
      cliVersion: "0.13.1",
      config: join(dir, "air.json"),
      getLatestVersion: latest("0.13.1"),
      assumeYes: true,
      ...spy.options,
    });

    expect(result.versionCheck.decision).toBe("applied");
    expect(result.versionCheck.cliUpgraded).toBe(false);
    expect(spy.globalInstalls).toEqual([]);
    expect(spy.extensionInstalls).toEqual([dir]);
    expect(result.versionCheck.bumps.map((b) => b.packageName)).toEqual([
      "@pulsemcp/air-adapter-claude",
    ]);
  });

  it("skips the version check entirely when the registry is unreachable", async () => {
    const dir = staleAirDir();
    const spy = createSpy();

    const result = await runUpdate({
      cliVersion: "0.13.1",
      config: join(dir, "air.json"),
      getLatestVersion: async () => null,
      assumeYes: true,
      ...spy.options,
    });

    expect(result.versionCheck.decision).toBe("not-needed");
    expect(result.versionCheck.bumps).toEqual([]);
    expect(result.versionCheck.warnings.join("\n")).toContain(
      "Could not reach the npm registry"
    );
    // Never pin extensions to a version line we could not confirm.
    expect(spy.extensionInstalls).toEqual([]);
  });

  it("refreshes caches before the version check, and reports the result", async () => {
    const dir = createAirDir({});
    const spy = createSpy();
    let cacheResults: unknown = null;

    const result = await runUpdate({
      cliVersion: "0.13.1",
      config: join(dir, "air.json"),
      getLatestVersion: latest("0.13.1"),
      onCachesRefreshed: (r) => {
        cacheResults = r;
      },
      ...spy.options,
    });

    // No cache directory under the fake HOME, so there is nothing to refresh —
    // the point is that the step ran and reported cleanly.
    expect(cacheResults).toEqual({});
    expect(result.cacheResults).toEqual({});
    expect(result.cacheRefreshError).toBeNull();
  });

  it("still reaches the version check when the cache refresh throws", async () => {
    // A provider too old or too broken to load is the state the version check
    // exists to repair, so it must not be the thing that blocks reaching it.
    //
    // The package name must be one that resolves nowhere: the extension
    // loader falls back to plain `import(specifier)`, which would find a real
    // `@pulsemcp/air-*` package in this monorepo's own node_modules and load
    // it successfully.
    const missing = "@pulsemcp/air-adapter-does-not-exist";
    const dir = createAirDir({
      extensions: [missing],
      dependencies: { [missing]: "^0.0.25" },
      installed: { [missing]: "0.0.25" },
      unloadable: true,
    });
    const spy = createSpy();

    const result = await runUpdate({
      cliVersion: "0.13.1",
      config: join(dir, "air.json"),
      getLatestVersion: latest("0.14.0"),
      assumeYes: true,
      ...spy.options,
    });

    expect(result.cacheRefreshError).toContain(
      `Failed to load extension "${missing}"`
    );
    // The run carried on regardless, and fixed the stale tree.
    expect(result.versionCheck.decision).toBe("applied");
    expect(spy.globalInstalls).toEqual(["@pulsemcp/air-cli@latest"]);
    expect(spy.extensionInstalls).toEqual([dir]);
  });

  it("throws, and skips the extension step, when the global install fails", async () => {
    const dir = staleAirDir();
    const spy = createSpy({ globalOk: false });

    await expect(
      runUpdate({
        cliVersion: "0.13.1",
        config: join(dir, "air.json"),
        getLatestVersion: latest("0.14.0"),
        assumeYes: true,
        ...spy.options,
      })
    ).rejects.toThrow(/npm install -g @pulsemcp\/air-cli@latest failed/);

    expect(spy.extensionInstalls).toEqual([]);
  });
});
