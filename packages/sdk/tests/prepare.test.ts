import { describe, it, expect, afterEach } from "vitest";
import { resolve, join } from "path";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from "fs";
import { tmpdir } from "os";
import { prepareSession } from "../src/prepare.js";

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
    `air-sdk-prepare-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

describe("prepareSession", () => {
  it("writes .mcp.json to target directory", async () => {
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
          env: { TOKEN: "abc" },
        },
      },
    });

    const target = createTemp({});

    const result = await prepareSession({
      config: join(catalog, "air.json"),
      target,
    });

    const mcpJsonPath = join(target, ".mcp.json");
    expect(existsSync(mcpJsonPath)).toBe(true);

    const mcpJson = JSON.parse(readFileSync(mcpJsonPath, "utf-8"));
    expect(mcpJson.mcpServers.github).toBeDefined();
    expect(mcpJson.mcpServers.github.command).toBe("npx");
    expect(mcpJson.mcpServers.github.env.TOKEN).toBe("abc");

    expect(result.session.configFiles).toContain(mcpJsonPath);
  });

  it("injects skills from catalog into target", async () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
      },
      "skills.json": {
        "my-skill": {
          id: "my-skill",
          description: "A test skill",
          path: "skills/my-skill",
        },
      },
      "skills/my-skill/SKILL.md": "# My Skill\nDo the thing.",
    });

    const target = createTemp({});

    const result = await prepareSession({
      config: join(catalog, "air.json"),
      target,
    });

    const skillMd = join(target, ".claude", "skills", "my-skill", "SKILL.md");
    expect(existsSync(skillMd)).toBe(true);
    expect(readFileSync(skillMd, "utf-8")).toContain("My Skill");

    expect(result.session.skillPaths).toContain(
      join(target, ".claude", "skills", "my-skill")
    );
  });

  it("filters artifacts by root defaults", async () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        mcp: ["./mcp.json"],
        roots: ["./roots.json"],
      },
      "mcp.json": {
        github: { type: "stdio", command: "npx", args: ["github-mcp"] },
        slack: { type: "stdio", command: "npx", args: ["slack-mcp"] },
        postgres: { type: "stdio", command: "npx", args: ["pg-mcp"] },
      },
      "roots.json": {
        "web-app": {
          name: "web-app",
          description: "Web app root",
          default_mcp_servers: ["github", "postgres"],
        },
      },
    });

    const target = createTemp({});

    await prepareSession({
      config: join(catalog, "air.json"),
      root: "web-app",
      target,
    });

    const mcpJson = JSON.parse(
      readFileSync(join(target, ".mcp.json"), "utf-8")
    );
    expect(mcpJson.mcpServers.github).toBeDefined();
    expect(mcpJson.mcpServers.postgres).toBeDefined();
    expect(mcpJson.mcpServers.slack).toBeUndefined();
  });

  it("supports skill overrides", async () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        roots: ["./roots.json"],
      },
      "skills.json": {
        "skill-a": {
          id: "skill-a",
          description: "Skill A",
          path: "skills/skill-a",
        },
        "skill-b": {
          id: "skill-b",
          description: "Skill B",
          path: "skills/skill-b",
        },
        "skill-c": {
          id: "skill-c",
          description: "Skill C",
          path: "skills/skill-c",
        },
      },
      "skills/skill-a/SKILL.md": "# A",
      "skills/skill-b/SKILL.md": "# B",
      "skills/skill-c/SKILL.md": "# C",
      "roots.json": {
        myroot: {
          name: "myroot",
          description: "Test root",
          default_skills: ["skill-a", "skill-b"],
        },
      },
    });

    const target = createTemp({});

    await prepareSession({
      config: join(catalog, "air.json"),
      root: "myroot",
      skills: ["skill-c"],
      target,
    });

    expect(
      existsSync(join(target, ".claude", "skills", "skill-c", "SKILL.md"))
    ).toBe(true);
    expect(
      existsSync(join(target, ".claude", "skills", "skill-a"))
    ).toBe(false);
  });

  it("supports mcp-servers overrides", async () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        mcp: ["./mcp.json"],
        roots: ["./roots.json"],
      },
      "mcp.json": {
        github: { type: "stdio", command: "npx", args: ["github-mcp"] },
        slack: { type: "stdio", command: "npx", args: ["slack-mcp"] },
      },
      "roots.json": {
        myroot: {
          name: "myroot",
          description: "Test",
          default_mcp_servers: ["github"],
        },
      },
    });

    const target = createTemp({});

    await prepareSession({
      config: join(catalog, "air.json"),
      root: "myroot",
      mcpServers: ["slack"],
      target,
    });

    const mcpJson = JSON.parse(
      readFileSync(join(target, ".mcp.json"), "utf-8")
    );
    expect(mcpJson.mcpServers.slack).toBeDefined();
    expect(mcpJson.mcpServers.github).toBeUndefined();
  });

  it("throws with unknown adapter", async () => {
    const catalog = createTemp({
      "air.json": { name: "test" },
    });

    await expect(
      prepareSession({
        config: join(catalog, "air.json"),
        adapter: "nonexistent",
      })
    ).rejects.toThrow("No adapter found");
  });

  it("throws with missing air.json", async () => {
    await expect(
      prepareSession({ config: "/nonexistent/air.json" })
    ).rejects.toThrow();
  });

  it("throws with unknown root", async () => {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        roots: ["./roots.json"],
      },
      "roots.json": {},
    });

    await expect(
      prepareSession({
        config: join(catalog, "air.json"),
        root: "nonexistent",
      })
    ).rejects.toThrow("not found");
  });
});
