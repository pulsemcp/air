import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { resolve, join } from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { cleanSession } from "../src/clean.js";
import { prepareSession } from "../src/prepare.js";

const tempDirs: string[] = [];

let airHomeDir: string;
let originalAirHome: string | undefined;
let originalAirConfig: string | undefined;

beforeEach(() => {
  airHomeDir = resolve(
    tmpdir(),
    `air-home-clean-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  originalAirHome = process.env.AIR_HOME;
  originalAirConfig = process.env.AIR_CONFIG;
  process.env.AIR_HOME = airHomeDir;
});

afterEach(() => {
  for (const dir of tempDirs) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  tempDirs.length = 0;
  if (existsSync(airHomeDir)) {
    rmSync(airHomeDir, { recursive: true, force: true });
  }
  if (originalAirHome === undefined) {
    delete process.env.AIR_HOME;
  } else {
    process.env.AIR_HOME = originalAirHome;
  }
  if (originalAirConfig === undefined) {
    delete process.env.AIR_CONFIG;
  } else {
    process.env.AIR_CONFIG = originalAirConfig;
  }
});

function createTemp(files: Record<string, unknown>): string {
  const dir = resolve(
    tmpdir(),
    `air-sdk-clean-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

describe("cleanSession (SDK)", () => {
  it("delegates to the adapter and removes the prepared artifacts", async () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        mcp: ["./mcp.json"],
      },
      "mcp.json": {
        github: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@mcp/github"],
        },
      },
    });

    const target = createTemp({});
    const configPath = join(catalog, "air.json");
    process.env.AIR_CONFIG = configPath;

    await prepareSession({
      adapter: "claude",
      target,
      config: configPath,
      addMcpServers: ["github"],
    });

    expect(existsSync(join(target, ".mcp.json"))).toBe(true);

    const result = await cleanSession({ adapter: "claude", target });

    expect(result.adapterDisplayName).toBe("Claude Code");
    expect(result.removedMcpServers).toEqual(["github"]);
    expect(result.manifestRemoved).toBe(true);
    expect(existsSync(join(target, ".mcp.json"))).toBe(false);
  });

  it("returns manifestExisted=false when no manifest exists yet", async () => {
    const target = createTemp({});
    const result = await cleanSession({ adapter: "claude", target });
    expect(result.manifestExisted).toBe(false);
    expect(result.manifestRemoved).toBe(false);
    expect(result.removedSkills).toEqual([]);
  });

  it("throws a clear error for an unknown adapter", async () => {
    const target = createTemp({});
    await expect(
      cleanSession({ adapter: "no-such-adapter", target })
    ).rejects.toThrow(/No adapter found for "no-such-adapter"/);
  });

  it("dry-run preserves disk state", async () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        mcp: ["./mcp.json"],
      },
      "mcp.json": {
        github: { type: "stdio", command: "gh" },
      },
    });
    const target = createTemp({});
    const configPath = join(catalog, "air.json");
    process.env.AIR_CONFIG = configPath;

    await prepareSession({
      adapter: "claude",
      target,
      config: configPath,
      addMcpServers: ["github"],
    });

    const result = await cleanSession({
      adapter: "claude",
      target,
      dryRun: true,
    });

    expect(result.removedMcpServers).toEqual(["github"]);
    // Full dry-run clean projects manifestRemoved=true even though the file
    // is left intact on disk — see ClaudeAdapter.cleanSession() for rationale.
    expect(result.manifestRemoved).toBe(true);
    // Disk state untouched.
    const mcp = JSON.parse(readFileSync(join(target, ".mcp.json"), "utf-8"));
    expect(mcp.mcpServers.github).toBeDefined();
  });
});
