import { describe, it, expect, afterEach } from "vitest";
import { resolve } from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { loadExtensions } from "../src/extension-loader.js";

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
    `air-sdk-extload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

describe("loadExtensions", () => {
  it("resolves npm-style packages from airJsonDir/node_modules", async () => {
    // Simulate a project directory with a fake npm package installed
    // under node_modules/. This mirrors what `air install` does.
    const projectDir = createTemp({
      "node_modules/@fake/air-ext/package.json": {
        name: "@fake/air-ext",
        version: "1.0.0",
        type: "module",
        main: "index.js",
      },
      "node_modules/@fake/air-ext/index.js": `
export default {
  name: "@fake/air-ext",
  transform: {
    transform: async (config) => config,
  },
};
`,
    });

    // loadExtensions should find the package in projectDir/node_modules,
    // NOT in the SDK's own node_modules tree.
    const result = await loadExtensions(["@fake/air-ext"], projectDir);

    expect(result.all).toHaveLength(1);
    expect(result.all[0].name).toBe("@fake/air-ext");
    expect(result.transforms).toHaveLength(1);
  });

  it("resolves unscoped npm packages from airJsonDir/node_modules", async () => {
    const projectDir = createTemp({
      "node_modules/fake-air-ext/package.json": {
        name: "fake-air-ext",
        version: "1.0.0",
        type: "module",
        main: "index.js",
      },
      "node_modules/fake-air-ext/index.js": `
export default {
  name: "fake-air-ext",
  transform: {
    transform: async (config) => config,
  },
};
`,
    });

    const result = await loadExtensions(["fake-air-ext"], projectDir);

    expect(result.all).toHaveLength(1);
    expect(result.all[0].name).toBe("fake-air-ext");
  });

  it("loads local path extensions relative to airJsonDir", async () => {
    const projectDir = createTemp({
      "my-ext.js": `
export default async function(config) {
  return config;
}
`,
    });

    const result = await loadExtensions(["./my-ext.js"], projectDir);

    expect(result.all).toHaveLength(1);
    expect(result.transforms).toHaveLength(1);
  });

  it("throws when npm package is not installed in airJsonDir", async () => {
    const projectDir = createTemp({});

    await expect(
      loadExtensions(["@nonexistent/air-extension-12345"], projectDir)
    ).rejects.toThrow("Failed to load extension");
  });
});
