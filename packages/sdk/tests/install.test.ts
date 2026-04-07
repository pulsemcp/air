import { describe, it, expect, afterEach } from "vitest";
import { resolve, join } from "path";
import {
  mkdirSync,
  writeFileSync,
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

  it("detects already-installed scoped package with version suffix", async () => {
    // The monorepo has @pulsemcp/air-core in node_modules.
    // Even with a version suffix, isPackageInstalled should strip it.
    const catalog = createTemp({
      "air.json": {
        name: "test",
        extensions: ["@pulsemcp/air-core@0.0.9"],
      },
    });

    const monorepoRoot = resolve(__dirname, "../../..");
    const result = await installExtensions({
      config: join(catalog, "air.json"),
      prefix: monorepoRoot,
    });

    expect(result.alreadyInstalled).toEqual(["@pulsemcp/air-core@0.0.9"]);
    expect(result.installed).toEqual([]);
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
});
