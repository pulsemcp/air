import { describe, it, expect, afterEach } from "vitest";
import { resolve, join } from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { startSession } from "../src/start.js";

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
    `air-sdk-start-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

describe("startSession", () => {
  it("resolves artifacts and generates session config", async () => {
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

    const result = await startSession("claude", {
      config: join(catalog, "air.json"),
    });

    expect(result.sessionConfig.agent).toBe("claude");
    expect(result.adapterDisplayName).toBe("Claude Code");
    expect(result.startCommand.command).toBe("claude");
    expect(result.artifacts.mcp.github).toBeDefined();
  });

  it("resolves root when specified", async () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        mcp: ["./mcp.json"],
        roots: ["./roots.json"],
      },
      "mcp.json": {
        github: { type: "stdio", command: "npx", args: ["gh"] },
        slack: { type: "stdio", command: "npx", args: ["slack"] },
      },
      "roots.json": {
        "web-app": {
          description: "Web app",
          default_mcp_servers: ["github"],
        },
      },
    });

    const result = await startSession("claude", {
      config: join(catalog, "air.json"),
      root: "web-app",
    });

    expect(result.root?.description).toBe("Web app");
  });

  it("returns empty artifacts when no config exists", async () => {
    const oldEnv = process.env.AIR_CONFIG;
    const oldHome = process.env.HOME;
    const dir = createTemp({});
    process.env.HOME = dir;
    delete process.env.AIR_CONFIG;

    try {
      const result = await startSession("claude", {
        checkAvailability: false,
      });
      expect(result.artifacts.skills).toEqual({});
      expect(result.artifacts.mcp).toEqual({});
      expect(result.sessionConfig.agent).toBe("claude");
    } finally {
      if (oldEnv !== undefined) process.env.AIR_CONFIG = oldEnv;
      else delete process.env.AIR_CONFIG;
      if (oldHome !== undefined) process.env.HOME = oldHome;
      else delete process.env.HOME;
    }
  });

  it("skips availability check when checkAvailability is false", async () => {
    const catalog = createTemp({
      "air.json": { name: "test" },
    });

    const result = await startSession("claude", {
      config: join(catalog, "air.json"),
      checkAvailability: false,
    });

    expect(result.agentAvailable).toBeUndefined();
  });

  it("loads extensions and passes providers to resolveArtifacts", async () => {
    const mockExtensionCode = `
export default {
  name: "mock-provider",
  provider: {
    scheme: "mock",
    async resolve(uri) {
      return {
        "remote-server": {
          type: "stdio",
          command: "npx",
          args: ["-y", "@mcp/remote"],
        },
      };
    },
  },
};
`;
    const catalog = createTemp({
      "air.json": {
        name: "test",
        extensions: ["./mock-provider.mjs"],
        mcp: ["mock://some-org/some-repo/mcp.json"],
      },
      "mock-provider.mjs": mockExtensionCode,
    });

    const result = await startSession("claude", {
      config: join(catalog, "air.json"),
    });

    expect(result.artifacts.mcp["remote-server"]).toBeDefined();
    expect(result.artifacts.mcp["remote-server"].command).toBe("npx");
  });

  it("throws for unknown adapter", async () => {
    await expect(startSession("nonexistent")).rejects.toThrow(
      "No adapter found"
    );
  });

  it("throws for unknown root", async () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        roots: ["./roots.json"],
      },
      "roots.json": {},
    });

    await expect(
      startSession("claude", {
        config: join(catalog, "air.json"),
        root: "nonexistent",
      })
    ).rejects.toThrow("not found");
  });
});
