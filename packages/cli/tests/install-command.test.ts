import { describe, it, expect, afterEach } from "vitest";
import { execSync } from "child_process";
import { resolve, join } from "path";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "fs";
import { tmpdir } from "os";

const CLI = resolve(__dirname, "../src/index.ts");
const run = (args: string, env?: Record<string, string>) =>
  execSync(`npx tsx ${CLI} ${args}`, {
    encoding: "utf-8",
    cwd: resolve(__dirname, "../../.."),
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });

const tryRun = (args: string, env?: Record<string, string>) => {
  try {
    return { stdout: run(args, env), exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      exitCode: err.status,
    };
  }
};

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
    `air-install-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

describe("install command", () => {
  it("reports no extensions when air.json has none", () => {
    const catalog = createTemp({
      "air.json": { name: "test" },
    });

    const result = tryRun(
      `install --config ${join(catalog, "air.json")}`
    );
    expect(result.exitCode).toBe(0);

    const output = JSON.parse(result.stdout);
    expect(output.alreadyInstalled).toEqual([]);
    expect(output.installed).toEqual([]);
    expect(output.skipped).toEqual([]);
  });

  it("skips local path extensions", () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        extensions: ["./local-ext.js"],
      },
    });

    const result = tryRun(
      `install --config ${join(catalog, "air.json")}`
    );
    expect(result.exitCode).toBe(0);

    const output = JSON.parse(result.stdout);
    expect(output.skipped).toEqual(["./local-ext.js"]);
    expect(output.installed).toEqual([]);
  });

  it("outputs structured JSON result to stdout", () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        extensions: ["./local.js"],
      },
    });

    const result = tryRun(
      `install --config ${join(catalog, "air.json")}`
    );
    expect(result.exitCode).toBe(0);

    const output = JSON.parse(result.stdout);
    expect(output).toHaveProperty("alreadyInstalled");
    expect(output).toHaveProperty("installed");
    expect(output).toHaveProperty("skipped");
  });

  it("installs a real extension into a prefix directory", () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        extensions: ["@pulsemcp/air-provider-github"],
      },
    });

    const prefix = createTemp({});

    const result = tryRun(
      `install --config ${join(catalog, "air.json")} --prefix ${prefix}`
    );
    expect(result.exitCode).toBe(0);

    const output = JSON.parse(result.stdout);
    expect(output.installed).toEqual(["@pulsemcp/air-provider-github"]);

    // Package should exist on disk
    expect(
      existsSync(join(prefix, "node_modules", "@pulsemcp", "air-provider-github"))
    ).toBe(true);
  }, 60000);

  it("fails gracefully with missing air.json", () => {
    const result = tryRun(
      `install --config /nonexistent/air.json`
    );
    expect(result.exitCode).not.toBe(0);
  });

  it("fails gracefully with nonexistent npm package", () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        extensions: ["@nonexistent-scope/air-extension-99999"],
      },
    });

    const prefix = createTemp({});

    const result = tryRun(
      `install --config ${join(catalog, "air.json")} --prefix ${prefix}`
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("npm install failed");
  }, 30000);
});
