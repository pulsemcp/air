import { describe, it, expect, afterEach } from "vitest";
import { resolve, join } from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { listArtifacts } from "../src/list.js";

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
    `air-sdk-list-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

describe("listArtifacts", () => {
  it("resolves skills from air.json", async () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
      },
      "skills.json": {
        deploy: {
          id: "deploy",
          description: "Deploy to staging",
          path: "./skills/deploy",
        },
      },
    });

    const artifacts = await listArtifacts("skills", {
      config: join(catalog, "air.json"),
    });

    expect(Object.keys(artifacts.skills)).toContain("deploy");
    expect(artifacts.skills.deploy.description).toBe("Deploy to staging");
  });

  it("resolves mcp servers from air.json", async () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        mcp: ["./mcp.json"],
      },
      "mcp.json": {
        github: { type: "stdio", command: "npx", args: ["gh"] },
      },
    });

    const artifacts = await listArtifacts("mcp", {
      config: join(catalog, "air.json"),
    });

    expect(artifacts.mcp.github).toBeDefined();
    expect(artifacts.mcp.github.type).toBe("stdio");
  });

  it("throws for invalid artifact type", async () => {
    await expect(listArtifacts("invalid")).rejects.toThrow(
      "Unknown artifact type"
    );
  });

  it("returns empty artifacts when no config found", async () => {
    // When no config is provided and AIR_CONFIG is not set and default doesn't exist,
    // getAirJsonPath returns null, so we get empty artifacts
    const oldEnv = process.env.AIR_CONFIG;
    const oldHome = process.env.HOME;
    const dir = createTemp({});
    process.env.HOME = dir;
    delete process.env.AIR_CONFIG;

    try {
      const artifacts = await listArtifacts("skills");
      expect(Object.keys(artifacts.skills)).toHaveLength(0);
    } finally {
      if (oldEnv !== undefined) process.env.AIR_CONFIG = oldEnv;
      else delete process.env.AIR_CONFIG;
      if (oldHome !== undefined) process.env.HOME = oldHome;
      else delete process.env.HOME;
    }
  });
});
