import { describe, it, expect, afterEach } from "vitest";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import {
  upgradeExtensions,
  type NpmInstallExtensions,
} from "../src/upgrade.js";
import { installExtensions } from "../src/install.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

/**
 * Build a stale `~/.air`-shaped directory: an air.json listing extensions, a
 * package.json pinning them to an old range, and a node_modules tree at that
 * old version. This is the exact starting state reported in issue #131.
 */
function createAirDir(opts: {
  extensions: unknown[];
  dependencies?: Record<string, string>;
  installed?: Record<string, string>;
  /** Omit package.json entirely. */
  noManifest?: boolean;
}): string {
  const dir = resolve(
    tmpdir(),
    `air-sdk-upgrade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);

  writeFileSync(
    join(dir, "air.json"),
    JSON.stringify({ name: "test", extensions: opts.extensions }, null, 2)
  );

  if (!opts.noManifest) {
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
  }

  for (const [name, version] of Object.entries(opts.installed ?? {})) {
    const pkgDir = join(dir, "node_modules", name);
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name, version, type: "module", main: "index.js" })
    );
    writeFileSync(join(pkgDir, "index.js"), "export default {};\n");
  }

  return dir;
}

/**
 * Stand-in for a bare `npm install --prefix <prefix>`: it reads the manifest
 * the caller just wrote and materializes the tree npm would have produced, so
 * these tests never touch the network. Like real npm, it does not rewrite the
 * dependency ranges in package.json.
 */
function fakeNpm(
  resolvedVersions: Record<string, string>,
  log?: { calls: Record<string, string>[] }
): NpmInstallExtensions {
  return async (prefix) => {
    const deps = readDeps(prefix) ?? {};
    log?.calls.push(deps);
    for (const name of Object.keys(deps)) {
      const version = resolvedVersions[name];
      if (!version) continue;
      const pkgDir = join(prefix, "node_modules", name);
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({ name, version, type: "module", main: "index.js" })
      );
    }
    return { ok: true, stderr: "" };
  };
}

const failingNpm: NpmInstallExtensions = async () => ({
  ok: false,
  stderr: "npm ERR! 404 Not Found",
});

function readDeps(dir: string): Record<string, string> | undefined {
  const path = join(dir, "package.json");
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf-8")).dependencies;
}

describe("upgradeExtensions", () => {
  it("upgrades a stale extension tree into lockstep with the CLI (issue #131)", async () => {
    const dir = createAirDir({
      extensions: [
        "@pulsemcp/air-adapter-claude",
        "@pulsemcp/air-provider-github",
      ],
      dependencies: {
        "@pulsemcp/air-adapter-claude": "^0.0.25",
        "@pulsemcp/air-provider-github": "^0.0.25",
      },
      installed: {
        "@pulsemcp/air-adapter-claude": "0.0.25",
        "@pulsemcp/air-provider-github": "0.0.25",
      },
    });

    const log = { calls: [] as Record<string, string>[] };
    const result = await upgradeExtensions({
      config: join(dir, "air.json"),
      cliVersion: "0.13.1",
      runNpmInstall: fakeNpm(
        {
          "@pulsemcp/air-adapter-claude": "0.13.1",
          "@pulsemcp/air-provider-github": "0.13.1",
        },
        log
      ),
    });

    expect(result.targetConstraint).toBe("~0.13.0");
    expect(result.upgraded).toEqual([
      "@pulsemcp/air-adapter-claude",
      "@pulsemcp/air-provider-github",
    ]);
    expect(result.manifestUpdated).toBe(true);
    expect(result.plans.every((p) => p.action === "upgrade")).toBe(true);

    // The manifest no longer pins the stale range...
    expect(readDeps(dir)).toEqual({
      "@pulsemcp/air-adapter-claude": "~0.13.0",
      "@pulsemcp/air-provider-github": "~0.13.0",
    });

    // ...and npm ran once, against a manifest already carrying those ranges,
    // so it had no spec of its own to save back over them.
    expect(log.calls).toEqual([
      {
        "@pulsemcp/air-adapter-claude": "~0.13.0",
        "@pulsemcp/air-provider-github": "~0.13.0",
      },
    ]);
  });

  it("leaves the prefix untouched under dryRun", async () => {
    const dir = createAirDir({
      extensions: ["@pulsemcp/air-provider-github"],
      dependencies: { "@pulsemcp/air-provider-github": "^0.0.25" },
      installed: { "@pulsemcp/air-provider-github": "0.0.25" },
    });

    const log = { calls: [] as Record<string, string>[] };
    const result = await upgradeExtensions({
      config: join(dir, "air.json"),
      cliVersion: "0.13.1",
      dryRun: true,
      runNpmInstall: fakeNpm({}, log),
    });

    expect(result.dryRun).toBe(true);
    expect(result.plans[0].action).toBe("upgrade");
    expect(result.plans[0].targetConstraint).toBe("~0.13.0");
    expect(result.upgraded).toEqual([]);
    expect(result.manifestUpdated).toBe(false);
    expect(log.calls).toEqual([]);
    expect(readDeps(dir)).toEqual({
      "@pulsemcp/air-provider-github": "^0.0.25",
    });
  });

  it("reports up-to-date when the constraint and the tree already match", async () => {
    const dir = createAirDir({
      extensions: ["@pulsemcp/air-provider-github"],
      dependencies: { "@pulsemcp/air-provider-github": "~0.13.0" },
      installed: { "@pulsemcp/air-provider-github": "0.13.1" },
    });

    const log = { calls: [] as Record<string, string>[] };
    const result = await upgradeExtensions({
      config: join(dir, "air.json"),
      cliVersion: "0.13.1",
      runNpmInstall: fakeNpm({}, log),
    });

    expect(result.plans[0].action).toBe("up-to-date");
    expect(result.upgraded).toEqual([]);
    expect(result.manifestUpdated).toBe(false);
    expect(log.calls).toEqual([]);
  });

  it("is idempotent — a second run finds nothing to do", async () => {
    const dir = createAirDir({
      extensions: ["@pulsemcp/air-provider-github"],
      dependencies: { "@pulsemcp/air-provider-github": "^0.0.25" },
      installed: { "@pulsemcp/air-provider-github": "0.0.25" },
    });
    const npm = fakeNpm({ "@pulsemcp/air-provider-github": "0.13.1" });

    const first = await upgradeExtensions({
      config: join(dir, "air.json"),
      cliVersion: "0.13.1",
      runNpmInstall: npm,
    });
    expect(first.upgraded).toEqual(["@pulsemcp/air-provider-github"]);

    const log = { calls: [] as Record<string, string>[] };
    const second = await upgradeExtensions({
      config: join(dir, "air.json"),
      cliVersion: "0.13.1",
      runNpmInstall: fakeNpm({}, log),
    });
    expect(second.plans[0].action).toBe("up-to-date");
    expect(second.upgraded).toEqual([]);
    expect(second.manifestUpdated).toBe(false);
    expect(log.calls).toEqual([]);
  });

  it("accepts a constraint npm itself saved for the same minor line", async () => {
    // npm rewrites `~0.13.0` to `^0.13.1` when it saves a dependency. Both pin
    // to the 0.13 line, so this must not trigger a pointless reinstall.
    const dir = createAirDir({
      extensions: ["@pulsemcp/air-provider-github"],
      dependencies: { "@pulsemcp/air-provider-github": "^0.13.1" },
      installed: { "@pulsemcp/air-provider-github": "0.13.1" },
    });

    const log = { calls: [] as Record<string, string>[] };
    const result = await upgradeExtensions({
      config: join(dir, "air.json"),
      cliVersion: "0.13.1",
      runNpmInstall: fakeNpm({}, log),
    });

    expect(result.plans[0].action).toBe("up-to-date");
    expect(log.calls).toEqual([]);
    expect(readDeps(dir)!["@pulsemcp/air-provider-github"]).toBe("^0.13.1");
  });

  it("rewrites a caret constraint that spans more than the CLI's minor", async () => {
    // Above 1.0, `^1.13.1` allows every 1.x minor — not lockstep.
    const dir = createAirDir({
      extensions: ["@pulsemcp/air-provider-github"],
      dependencies: { "@pulsemcp/air-provider-github": "^1.13.1" },
      installed: { "@pulsemcp/air-provider-github": "1.13.1" },
    });

    const result = await upgradeExtensions({
      config: join(dir, "air.json"),
      cliVersion: "1.13.1",
      runNpmInstall: fakeNpm({ "@pulsemcp/air-provider-github": "1.13.1" }),
    });

    expect(result.plans[0].action).toBe("upgrade");
    expect(readDeps(dir)!["@pulsemcp/air-provider-github"]).toBe("~1.13.0");
  });

  it("installs a declared extension that is missing from the tree", async () => {
    const dir = createAirDir({
      extensions: ["@pulsemcp/air-adapter-codex"],
      dependencies: {},
      installed: {},
    });

    const result = await upgradeExtensions({
      config: join(dir, "air.json"),
      cliVersion: "0.13.1",
      runNpmInstall: fakeNpm({ "@pulsemcp/air-adapter-codex": "0.13.1" }),
    });

    expect(result.plans[0]).toMatchObject({
      action: "upgrade",
      installedVersion: null,
      targetConstraint: "~0.13.0",
    });
    expect(readDeps(dir)!["@pulsemcp/air-adapter-codex"]).toBe("~0.13.0");
  });

  it("creates a manifest when the prefix has none", async () => {
    const dir = createAirDir({
      extensions: ["@pulsemcp/air-provider-github"],
      noManifest: true,
    });

    await upgradeExtensions({
      config: join(dir, "air.json"),
      cliVersion: "0.13.1",
      runNpmInstall: fakeNpm({ "@pulsemcp/air-provider-github": "0.13.1" }),
    });

    const manifest = JSON.parse(
      readFileSync(join(dir, "package.json"), "utf-8")
    );
    expect(manifest.private).toBe(true);
    expect(manifest.dependencies).toEqual({
      "@pulsemcp/air-provider-github": "~0.13.0",
    });
  });

  it("preserves unrelated manifest fields and dependencies", async () => {
    const dir = createAirDir({
      extensions: ["@pulsemcp/air-provider-github"],
      dependencies: {
        "@pulsemcp/air-provider-github": "^0.0.25",
        "some-other-dep": "^1.0.0",
      },
      installed: { "@pulsemcp/air-provider-github": "0.0.25" },
    });
    const before = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    before.description = "hand-written by the user";
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(before, null, 2) + "\n"
    );

    await upgradeExtensions({
      config: join(dir, "air.json"),
      cliVersion: "0.13.1",
      runNpmInstall: fakeNpm({ "@pulsemcp/air-provider-github": "0.13.1" }),
    });

    const after = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    expect(after.description).toBe("hand-written by the user");
    expect(after.dependencies).toEqual({
      "@pulsemcp/air-provider-github": "~0.13.0",
      "some-other-dep": "^1.0.0",
    });
  });

  describe("entries it refuses to touch", () => {
    it("skips local path extensions", async () => {
      const dir = createAirDir({
        extensions: ["./local-ext.js", "../up.js", "/abs/ext.js"],
      });

      const result = await upgradeExtensions({
        config: join(dir, "air.json"),
        cliVersion: "0.13.1",
        runNpmInstall: failingNpm,
      });

      expect(result.plans.map((p) => p.skipReason)).toEqual([
        "local-path",
        "local-path",
        "local-path",
      ]);
      expect(result.upgraded).toEqual([]);
    });

    it("skips packages outside the AIR lockstep namespace", async () => {
      const dir = createAirDir({
        extensions: ["some-community/air-extension", "@other/air-adapter-x"],
        installed: {},
      });

      const result = await upgradeExtensions({
        config: join(dir, "air.json"),
        cliVersion: "0.13.1",
        runNpmInstall: failingNpm,
      });

      expect(result.plans.map((p) => p.skipReason)).toEqual([
        "third-party",
        "third-party",
      ]);
    });

    it("skips specifiers that pin a version in air.json", async () => {
      const dir = createAirDir({
        extensions: ["@pulsemcp/air-provider-github@0.0.25"],
        installed: { "@pulsemcp/air-provider-github": "0.0.25" },
      });

      const result = await upgradeExtensions({
        config: join(dir, "air.json"),
        cliVersion: "0.13.1",
        runNpmInstall: failingNpm,
      });

      expect(result.plans[0].skipReason).toBe("explicitly-pinned");
      expect(result.plans[0].detail).toContain("0.0.25");
    });

    it("refuses to downgrade an extension installed ahead of the CLI", async () => {
      const dir = createAirDir({
        extensions: ["@pulsemcp/air-provider-github"],
        dependencies: { "@pulsemcp/air-provider-github": "~0.14.0" },
        installed: { "@pulsemcp/air-provider-github": "0.14.0" },
      });

      const result = await upgradeExtensions({
        config: join(dir, "air.json"),
        cliVersion: "0.13.1",
        runNpmInstall: failingNpm,
      });

      expect(result.plans[0].skipReason).toBe("ahead-of-cli");
      expect(result.upgraded).toEqual([]);
      // The user's newer pin survives.
      expect(readDeps(dir)!["@pulsemcp/air-provider-github"]).toBe("~0.14.0");
    });

    it("still upgrades a newer patch on the CLI's own minor line", async () => {
      const dir = createAirDir({
        extensions: ["@pulsemcp/air-provider-github"],
        dependencies: { "@pulsemcp/air-provider-github": "^0.0.25" },
        installed: { "@pulsemcp/air-provider-github": "0.13.5" },
      });

      const result = await upgradeExtensions({
        config: join(dir, "air.json"),
        cliVersion: "0.13.1",
        runNpmInstall: fakeNpm({ "@pulsemcp/air-provider-github": "0.13.5" }),
      });

      // 0.13.5 already satisfies ~0.13.0, but the stale ^0.0.25 constraint
      // still needs rewriting so a bare `npm install` does not walk it back.
      expect(result.plans[0].action).toBe("upgrade");
      expect(readDeps(dir)!["@pulsemcp/air-provider-github"]).toBe("~0.13.0");
    });

    it("skips everything when the CLI version is not a plain semver", async () => {
      const dir = createAirDir({
        extensions: ["@pulsemcp/air-provider-github"],
        installed: { "@pulsemcp/air-provider-github": "0.0.25" },
      });

      const result = await upgradeExtensions({
        config: join(dir, "air.json"),
        cliVersion: "0.13.1-rc.1",
        runNpmInstall: failingNpm,
      });

      expect(result.targetConstraint).toBeNull();
      expect(result.plans[0].skipReason).toBe("unknown-cli-version");
      expect(result.upgraded).toEqual([]);
    });

    it("dedupes repeated specifiers and ignores non-strings", async () => {
      const dir = createAirDir({
        extensions: [
          "@pulsemcp/air-provider-github",
          "@pulsemcp/air-provider-github",
          123,
          null,
        ],
        installed: { "@pulsemcp/air-provider-github": "0.0.25" },
      });

      const result = await upgradeExtensions({
        config: join(dir, "air.json"),
        cliVersion: "0.13.1",
        runNpmInstall: fakeNpm({ "@pulsemcp/air-provider-github": "0.13.1" }),
      });

      expect(result.plans).toHaveLength(1);
      expect(result.upgraded).toEqual(["@pulsemcp/air-provider-github"]);
    });
  });

  it("records installed-but-undeclared extensions so npm cannot prune them", async () => {
    // `npm install` deletes anything node_modules holds that package.json
    // does not declare. An extension air.json names and that this upgrade
    // deliberately skips must survive the reconcile.
    const dir = createAirDir({
      extensions: [
        "@pulsemcp/air-provider-github",
        "@pulsemcp/air-adapter-claude@0.9.2",
        "@pulsemcp/air-adapter-codex",
        "some-community/air-extension",
      ],
      dependencies: { "@pulsemcp/air-provider-github": "^0.0.25" },
      installed: {
        "@pulsemcp/air-provider-github": "0.0.25",
        // Pinned in air.json, absent from package.json.
        "@pulsemcp/air-adapter-claude": "0.9.2",
        // Ahead of the CLI, absent from package.json.
        "@pulsemcp/air-adapter-codex": "0.14.0",
        // Third-party, absent from package.json.
        "some-community/air-extension": "3.1.0",
      },
    });

    await upgradeExtensions({
      config: join(dir, "air.json"),
      cliVersion: "0.13.1",
      runNpmInstall: fakeNpm({ "@pulsemcp/air-provider-github": "0.13.1" }),
    });

    expect(readDeps(dir)).toEqual({
      // Upgraded to the lockstep line.
      "@pulsemcp/air-provider-github": "~0.13.0",
      // Preserved at the pin air.json states.
      "@pulsemcp/air-adapter-claude": "0.9.2",
      // Preserved at exactly what is on disk.
      "@pulsemcp/air-adapter-codex": "0.14.0",
      "some-community/air-extension": "3.1.0",
    });
  });

  it("does not invent manifest entries for extensions that are not installed", async () => {
    const dir = createAirDir({
      extensions: [
        "@pulsemcp/air-provider-github",
        "some-community/air-extension",
      ],
      dependencies: {},
      installed: {},
    });

    await upgradeExtensions({
      config: join(dir, "air.json"),
      cliVersion: "0.13.1",
      runNpmInstall: fakeNpm({ "@pulsemcp/air-provider-github": "0.13.1" }),
    });

    expect(readDeps(dir)).toEqual({
      "@pulsemcp/air-provider-github": "~0.13.0",
    });
  });

  it("restores the manifest and throws when npm install fails", async () => {
    const dir = createAirDir({
      extensions: ["@pulsemcp/air-provider-github"],
      dependencies: { "@pulsemcp/air-provider-github": "^0.0.25" },
      installed: { "@pulsemcp/air-provider-github": "0.0.25" },
    });
    const before = readFileSync(join(dir, "package.json"), "utf-8");

    await expect(
      upgradeExtensions({
        config: join(dir, "air.json"),
        cliVersion: "0.13.1",
        runNpmInstall: failingNpm,
      })
    ).rejects.toThrow(/npm install failed for extensions/);

    // No half-applied state: the manifest still describes what is on disk.
    expect(readFileSync(join(dir, "package.json"), "utf-8")).toBe(before);
  });

  it("removes a manifest it created when npm install fails", async () => {
    const dir = createAirDir({
      extensions: ["@pulsemcp/air-provider-github"],
      noManifest: true,
    });

    await expect(
      upgradeExtensions({
        config: join(dir, "air.json"),
        cliVersion: "0.13.1",
        runNpmInstall: failingNpm,
      })
    ).rejects.toThrow(/npm install failed for extensions/);

    expect(existsSync(join(dir, "package.json"))).toBe(false);
  });

  it("reports configFound: false when no air.json can be located", async () => {
    const previous = process.env.AIR_CONFIG;
    process.env.AIR_CONFIG = join(
      resolve(tmpdir(), `air-sdk-upgrade-missing-${Date.now()}`),
      "air.json"
    );
    try {
      const result = await upgradeExtensions({
        cliVersion: "0.13.1",
        runNpmInstall: failingNpm,
      });

      expect(result.configFound).toBe(false);
      expect(result.airJsonPath).toBeNull();
      expect(result.plans).toEqual([]);
      expect(result.manifestUpdated).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.AIR_CONFIG;
      else process.env.AIR_CONFIG = previous;
    }
  });

  it("throws when an explicit --config path does not exist", async () => {
    await expect(
      upgradeExtensions({
        config: "/nonexistent/air-upgrade-test/air.json",
        cliVersion: "0.13.1",
        runNpmInstall: failingNpm,
      })
    ).rejects.toThrow();
  });

  it("honours an explicit prefix separate from the air.json directory", async () => {
    const dir = createAirDir({
      extensions: ["@pulsemcp/air-provider-github"],
    });
    const prefix = createAirDir({ extensions: [] });

    await upgradeExtensions({
      config: join(dir, "air.json"),
      prefix,
      cliVersion: "0.13.1",
      runNpmInstall: fakeNpm({ "@pulsemcp/air-provider-github": "0.13.1" }),
    });

    expect(readDeps(prefix)!["@pulsemcp/air-provider-github"]).toBe("~0.13.0");
    expect(readDeps(dir)).toEqual({});
  });

  it("leaves `air install` with nothing to do afterwards", async () => {
    const dir = createAirDir({
      extensions: ["@pulsemcp/air-provider-github"],
      dependencies: { "@pulsemcp/air-provider-github": "^0.0.25" },
      installed: { "@pulsemcp/air-provider-github": "0.0.25" },
    });

    // Before: `air install` is happy with the stale tree only because the
    // constraint still says ^0.0.25.
    const stale = await installExtensions({
      config: join(dir, "air.json"),
      prefix: dir,
    });
    expect(stale.alreadyInstalled).toEqual(["@pulsemcp/air-provider-github"]);

    await upgradeExtensions({
      config: join(dir, "air.json"),
      cliVersion: "0.13.1",
      runNpmInstall: fakeNpm({ "@pulsemcp/air-provider-github": "0.13.1" }),
    });

    const after = await installExtensions({
      config: join(dir, "air.json"),
      prefix: dir,
    });
    expect(after.alreadyInstalled).toEqual(["@pulsemcp/air-provider-github"]);
    expect(after.installed).toEqual([]);
    expect(after.mismatched).toEqual([]);
  });
});
