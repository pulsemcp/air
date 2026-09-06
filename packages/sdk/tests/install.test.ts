import { describe, it, expect, afterEach } from "vitest";
import { resolve, join } from "path";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "fs";
import { tmpdir } from "os";
import { installExtensions } from "../src/install.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  tempDirs.length = 0;
});

function createTemp(files: Record<string, unknown>): string {
  const dir = resolve(
    tmpdir(),
    `air-sdk-install-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    const path = resolve(dir, name);
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(
      path,
      typeof content === "string" ? content : JSON.stringify(content, null, 2)
    );
  }
  return dir;
}

/** Write a fake installed package into `<prefix>/node_modules/<name>`. */
function installFake(prefix: string, name: string, version: string): void {
  const pkgDir = join(prefix, "node_modules", name);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({ name, version, type: "module", main: "index.js" })
  );
  writeFileSync(join(pkgDir, "index.js"), "export default {};\n");
}

describe("installExtensions", () => {
  it("returns empty result when no extensions are declared", async () => {
    const catalog = createTemp({
      "air.json": { name: "test" },
    });

    const result = await installExtensions({
      config: join(catalog, "air.json"),
    });

    expect(result.alreadyInstalled).toEqual([]);
    expect(result.installed).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("returns empty result when extensions array is empty", async () => {
    const catalog = createTemp({
      "air.json": { name: "test", extensions: [] },
    });

    const result = await installExtensions({
      config: join(catalog, "air.json"),
    });

    expect(result.alreadyInstalled).toEqual([]);
    expect(result.installed).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("skips local path extensions", async () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        extensions: ["./local-ext.js", "../other-ext.js", "/absolute/ext.js"],
      },
    });

    const result = await installExtensions({
      config: join(catalog, "air.json"),
    });

    expect(result.skipped).toEqual([
      "./local-ext.js",
      "../other-ext.js",
      "/absolute/ext.js",
    ]);
    expect(result.alreadyInstalled).toEqual([]);
    expect(result.installed).toEqual([]);
  });

  it("detects already-installed packages", async () => {
    // Use a package that's always available in the monorepo (vitest itself)
    const catalog = createTemp({
      "air.json": {
        name: "test",
        extensions: ["vitest"],
      },
    });

    // Use the monorepo root as the prefix so vitest is resolvable
    const monorepoRoot = resolve(__dirname, "../../..");
    const result = await installExtensions({
      config: join(catalog, "air.json"),
      prefix: monorepoRoot,
    });

    expect(result.alreadyInstalled).toEqual(["vitest"]);
    expect(result.installed).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("categorizes mixed extensions correctly", async () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        extensions: [
          "./local-transform.js",
          "vitest",
        ],
      },
    });

    const monorepoRoot = resolve(__dirname, "../../..");
    const result = await installExtensions({
      config: join(catalog, "air.json"),
      prefix: monorepoRoot,
    });

    expect(result.skipped).toEqual(["./local-transform.js"]);
    expect(result.alreadyInstalled).toEqual(["vitest"]);
    expect(result.installed).toEqual([]);
  });

  it("deduplicates extension specifiers", async () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        extensions: ["./local.js", "./local.js", "vitest", "vitest"],
      },
    });

    const monorepoRoot = resolve(__dirname, "../../..");
    const result = await installExtensions({
      config: join(catalog, "air.json"),
      prefix: monorepoRoot,
    });

    expect(result.skipped).toEqual(["./local.js"]);
    expect(result.alreadyInstalled).toEqual(["vitest"]);
  });

  it("detects already-installed scoped package with a satisfied version suffix", async () => {
    const prefix = createTemp({});
    installFake(prefix, "@pulsemcp/air-provider-github", "0.13.1");
    const catalog = createTemp({
      "air.json": {
        name: "test",
        extensions: ["@pulsemcp/air-provider-github@~0.13.0"],
      },
    });

    const result = await installExtensions({
      config: join(catalog, "air.json"),
      prefix,
    });

    expect(result.alreadyInstalled).toEqual([
      "@pulsemcp/air-provider-github@~0.13.0",
    ]);
    expect(result.installed).toEqual([]);
    expect(result.mismatched).toEqual([]);
  });

  it("skips non-string entries in extensions array", async () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        extensions: ["./local.js", 123, null, "vitest"],
      },
    });

    const monorepoRoot = resolve(__dirname, "../../..");
    const result = await installExtensions({
      config: join(catalog, "air.json"),
      prefix: monorepoRoot,
    });

    expect(result.skipped).toEqual(["./local.js"]);
    expect(result.alreadyInstalled).toEqual(["vitest"]);
  });

  it("throws when air.json does not exist", async () => {
    await expect(
      installExtensions({ config: "/nonexistent/air.json" })
    ).rejects.toThrow();
  });

  it("throws when npm install fails for missing packages", async () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        extensions: ["@nonexistent-scope/air-extension-99999"],
      },
    });

    // Use temp dir as prefix — the package won't resolve there
    await expect(
      installExtensions({
        config: join(catalog, "air.json"),
        prefix: catalog,
      })
    ).rejects.toThrow("npm install failed");
  }, 30000);

  it("installs a real package into a prefix directory", async () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        extensions: ["@pulsemcp/air-provider-github"],
      },
    });

    const prefix = createTemp({});

    const result = await installExtensions({
      config: join(catalog, "air.json"),
      prefix,
    });

    expect(result.installed).toEqual(["@pulsemcp/air-provider-github"]);
    expect(result.alreadyInstalled).toEqual([]);

    // The package should now be resolvable from the prefix
    expect(
      existsSync(join(prefix, "node_modules", "@pulsemcp", "air-provider-github"))
    ).toBe(true);
  }, 60000);

  it("detects already-installed extension after install", async () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        extensions: ["@pulsemcp/air-provider-github"],
      },
    });

    const prefix = createTemp({});

    // First install
    const first = await installExtensions({
      config: join(catalog, "air.json"),
      prefix,
    });
    expect(first.installed).toEqual(["@pulsemcp/air-provider-github"]);

    // Second install — should detect as already installed
    const second = await installExtensions({
      config: join(catalog, "air.json"),
      prefix,
    });
    expect(second.alreadyInstalled).toEqual(["@pulsemcp/air-provider-github"]);
    expect(second.installed).toEqual([]);
  }, 60000);
  describe("version-aware installed check", () => {
    it("reinstalls a stale tree that package.json pins to a newer range (issue #131)", async () => {
      // The exact starting state from issue #131: a 0.0.25 tree that the old
      // existence-only check happily reported as "Already installed", plus the
      // ~0.13.0 constraint `air upgrade` writes into <prefix>/package.json.
      const prefix = createTemp({
        "package.json": {
          name: "air-extensions",
          private: true,
          dependencies: { "@pulsemcp/air-provider-github": "~0.13.0" },
        },
      });
      installFake(prefix, "@pulsemcp/air-provider-github", "0.0.25");
      const catalog = createTemp({
        "air.json": {
          name: "test",
          extensions: ["@pulsemcp/air-provider-github"],
        },
      });

      const result = await installExtensions({
        config: join(catalog, "air.json"),
        prefix,
      });

      expect(result.mismatched).toEqual([
        {
          specifier: "@pulsemcp/air-provider-github",
          packageName: "@pulsemcp/air-provider-github",
          installedVersion: "0.0.25",
          requiredRange: "~0.13.0",
          source: "package.json",
        },
      ]);
      expect(result.installed).toEqual(["@pulsemcp/air-provider-github"]);
      expect(result.alreadyInstalled).toEqual([]);

      // npm was asked for the manifest's range, so the tree now satisfies it.
      const installed = JSON.parse(
        readFileSync(
          join(
            prefix,
            "node_modules",
            "@pulsemcp",
            "air-provider-github",
            "package.json"
          ),
          "utf-8"
        )
      );
      expect(installed.version).toMatch(/^0\.13\./);
    }, 60000);

    it("keeps existence-only behaviour when no range is declared anywhere", async () => {
      const prefix = createTemp({});
      installFake(prefix, "@pulsemcp/air-provider-github", "0.0.25");
      const catalog = createTemp({
        "air.json": {
          name: "test",
          extensions: ["@pulsemcp/air-provider-github"],
        },
      });

      const result = await installExtensions({
        config: join(catalog, "air.json"),
        prefix,
      });

      expect(result.alreadyInstalled).toEqual([
        "@pulsemcp/air-provider-github",
      ]);
      expect(result.installed).toEqual([]);
      expect(result.mismatched).toEqual([]);
    });

    it("does not reinstall on a range it cannot model", async () => {
      const prefix = createTemp({
        "package.json": {
          name: "air-extensions",
          private: true,
          dependencies: { "@pulsemcp/air-provider-github": ">=0.1.0 <1.0.0" },
        },
      });
      installFake(prefix, "@pulsemcp/air-provider-github", "0.0.25");
      const catalog = createTemp({
        "air.json": {
          name: "test",
          extensions: ["@pulsemcp/air-provider-github"],
        },
      });

      const result = await installExtensions({
        config: join(catalog, "air.json"),
        prefix,
      });

      expect(result.alreadyInstalled).toEqual([
        "@pulsemcp/air-provider-github",
      ]);
      expect(result.installed).toEqual([]);
    });

    it("does not reinstall when the installed version satisfies the manifest range", async () => {
      const prefix = createTemp({
        "package.json": {
          name: "air-extensions",
          private: true,
          dependencies: { "@pulsemcp/air-provider-github": "~0.13.0" },
        },
      });
      installFake(prefix, "@pulsemcp/air-provider-github", "0.13.9");
      const catalog = createTemp({
        "air.json": {
          name: "test",
          extensions: ["@pulsemcp/air-provider-github"],
        },
      });

      const result = await installExtensions({
        config: join(catalog, "air.json"),
        prefix,
      });

      expect(result.alreadyInstalled).toEqual([
        "@pulsemcp/air-provider-github",
      ]);
      expect(result.installed).toEqual([]);
    });
  });
});
