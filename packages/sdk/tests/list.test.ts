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
          description: "Deploy to staging",
          path: "./skills/deploy",
        },
      },
    });

    const result = await listArtifacts("skills", {
      config: join(catalog, "air.json"),
    });

    expect(result.type).toBe("skills");
    expect(Object.keys(result.entries)).toContain("@local/deploy");
    expect(Object.keys(result.artifacts.skills)).toContain("@local/deploy");
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

    const result = await listArtifacts("mcp", {
      config: join(catalog, "air.json"),
    });

    expect(result.type).toBe("mcp");
    expect(result.entries["@local/github"]).toBeDefined();
  });

  it("resolves roots from air.json", async () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        roots: ["./roots.json"],
      },
      "roots.json": {
        "web-app": {
          description: "Main web app",
          url: "https://github.com/test/repo.git",
        },
      },
    });

    const result = await listArtifacts("roots", {
      config: join(catalog, "air.json"),
    });

    expect(result.type).toBe("roots");
    expect(result.entries["@local/web-app"]).toBeDefined();
  });

  it("resolves plugins from air.json", async () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        plugins: ["./plugins.json"],
      },
      "plugins.json": {
        "code-quality": {
          description: "Linting tools",
          version: "1.0.0",
        },
      },
    });

    const result = await listArtifacts("plugins", {
      config: join(catalog, "air.json"),
    });

    expect(result.type).toBe("plugins");
    expect(result.entries["@local/code-quality"]).toBeDefined();
  });

  it("resolves hooks from air.json", async () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        hooks: ["./hooks.json"],
      },
      "hooks.json": {
        "pre-commit": {
          description: "Lint check",
          event: "pre-commit",
          command: "npx lint-staged",
        },
      },
    });

    const result = await listArtifacts("hooks", {
      config: join(catalog, "air.json"),
    });

    expect(result.type).toBe("hooks");
    expect(result.entries["@local/pre-commit"]).toBeDefined();
  });

  it("resolves references from air.json", async () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        references: ["./references.json"],
      },
      "references.json": {
        "git-workflow": {
          description: "Git workflow guide",
          path: "./docs/git.md",
        },
      },
    });

    const result = await listArtifacts("references", {
      config: join(catalog, "air.json"),
    });

    expect(result.type).toBe("references");
    expect(result.entries["@local/git-workflow"]).toBeDefined();
  });

  it("throws for invalid artifact type", async () => {
    await expect(listArtifacts("invalid")).rejects.toThrow(
      "Unknown artifact type"
    );
  });

  it("returns empty artifacts when no config found", async () => {
    const oldEnv = process.env.AIR_CONFIG;
    const oldHome = process.env.HOME;
    const dir = createTemp({});
    process.env.HOME = dir;
    delete process.env.AIR_CONFIG;

    try {
      const result = await listArtifacts("skills");
      expect(Object.keys(result.entries)).toHaveLength(0);
    } finally {
      if (oldEnv !== undefined) process.env.AIR_CONFIG = oldEnv;
      else delete process.env.AIR_CONFIG;
      if (oldHome !== undefined) process.env.HOME = oldHome;
      else delete process.env.HOME;
    }
  });
});
