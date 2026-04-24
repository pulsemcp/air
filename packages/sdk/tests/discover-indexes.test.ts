import { describe, it, expect, afterEach } from "vitest";
import { execSync } from "child_process";
import { resolve } from "path";
import {
  mkdirSync,
  rmSync,
  existsSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import {
  discoverIndexes,
  resolveAnchor,
} from "../src/discover-indexes.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  tempDirs.length = 0;
});

function makeTempDir(): string {
  const dir = resolve(
    tmpdir(),
    `air-discover-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

function initGitRepo(dir: string): void {
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
}

describe("resolveAnchor", () => {
  it("returns the git root when inside a git repo", () => {
    const dir = makeTempDir();
    initGitRepo(dir);
    const nested = resolve(dir, "nested/deep");
    mkdirSync(nested, { recursive: true });

    const { anchor, isGitRoot } = resolveAnchor(nested);
    // Normalise both sides — macOS sometimes adds /private/ which trips
    // naive string compares.
    expect(anchor).toBe(resolve(dir));
    expect(isGitRoot).toBe(true);
  });

  it("falls back to the target directory when not in a git repo", () => {
    const dir = makeTempDir();
    const { anchor, isGitRoot } = resolveAnchor(dir);
    expect(anchor).toBe(resolve(dir));
    expect(isGitRoot).toBe(false);
  });
});

describe("discoverIndexes — catalog layout", () => {
  it("detects a full catalog at the anchor", () => {
    const dir = makeTempDir();
    initGitRepo(dir);
    writeJson(resolve(dir, "skills/skills.json"), {
      $schema:
        "https://raw.githubusercontent.com/pulsemcp/air/main/schemas/skills.schema.json",
      "deploy-staging": {
        description: "Deploy to staging",
        path: "skills/deploy-staging",
      },
    });
    writeJson(resolve(dir, "mcp/mcp.json"), {
      github: { type: "stdio", command: "npx", args: ["-y", "gh"] },
    });

    const result = discoverIndexes(dir);
    expect(result.anchorIsGitRoot).toBe(true);
    expect(result.catalogs).toHaveLength(1);
    expect(result.catalogs[0].path).toBe(resolve(dir));
    expect(result.catalogs[0].types.sort()).toEqual(["mcp", "skills"]);
    expect(result.catalogs[0].entryCounts).toEqual({ skills: 1, mcp: 1 });
    // Files covered by catalog must not appear as loose.
    expect(result.looseIndexes).toHaveLength(0);
  });

  it("detects a catalog at a one-level subdirectory (e.g. config/)", () => {
    const dir = makeTempDir();
    writeJson(resolve(dir, "config/skills/skills.json"), {
      a: { description: "a", path: "x" },
    });

    const result = discoverIndexes(dir);
    expect(result.catalogs).toHaveLength(1);
    expect(result.catalogs[0].relPath).toBe("config");
    expect(result.catalogs[0].types).toEqual(["skills"]);
  });
});

describe("discoverIndexes — loose layout", () => {
  it("detects a bare skills.json at the repo root", () => {
    const dir = makeTempDir();
    initGitRepo(dir);
    writeJson(resolve(dir, "skills.json"), {
      $schema:
        "https://raw.githubusercontent.com/pulsemcp/air/main/schemas/skills.schema.json",
      foo: { description: "foo", path: "skills/foo" },
    });

    const result = discoverIndexes(dir);
    expect(result.catalogs).toHaveLength(0);
    expect(result.looseIndexes).toHaveLength(1);
    expect(result.looseIndexes[0].type).toBe("skills");
    expect(result.looseIndexes[0].relPath).toBe("skills.json");
    expect(result.looseIndexes[0].entryCount).toBe(1);
  });

  it("detects multiple loose indexes at varying depths", () => {
    const dir = makeTempDir();
    writeJson(resolve(dir, "skills.json"), {
      a: { description: "a", path: "x" },
    });
    writeJson(resolve(dir, "team/mcp.json"), {
      b: { type: "stdio", command: "echo" },
    });

    const result = discoverIndexes(dir);
    // Note: `skills/` alone at the anchor doesn't trigger a catalog because
    // there's no `skills/skills.json` layout; skills.json at root is loose.
    expect(result.looseIndexes.map((l) => l.type).sort()).toEqual([
      "mcp",
      "skills",
    ]);
  });

  it("detects a nested air.json", () => {
    const dir = makeTempDir();
    writeJson(resolve(dir, "team/air.json"), {
      name: "team-config",
      skills: ["./skills/skills.json"],
    });

    const result = discoverIndexes(dir);
    expect(result.airJsons).toHaveLength(1);
    expect(result.airJsons[0].relPath).toBe(`team/air.json`);
  });
});

describe("discoverIndexes — validation", () => {
  it("rejects a file whose $schema points to a non-AIR schema", () => {
    const dir = makeTempDir();
    writeJson(resolve(dir, "skills.json"), {
      $schema: "https://json-schema.org/draft-07/schema#",
      properties: { foo: { type: "string" } },
    });

    const result = discoverIndexes(dir);
    expect(result.looseIndexes).toHaveLength(0);
  });

  it("rejects a file whose $schema contradicts the filename", () => {
    const dir = makeTempDir();
    writeJson(resolve(dir, "skills.json"), {
      $schema:
        "https://raw.githubusercontent.com/pulsemcp/air/main/schemas/mcp.schema.json",
      foo: { type: "stdio", command: "echo" },
    });

    const result = discoverIndexes(dir);
    expect(result.looseIndexes).toHaveLength(0);
  });

  it("silently skips non-parseable JSON", () => {
    const dir = makeTempDir();
    writeFileSync(resolve(dir, "skills.json"), "this is not json");

    const result = discoverIndexes(dir);
    expect(result.looseIndexes).toHaveLength(0);
  });

  it("accepts a loose index with no $schema (filename is enough)", () => {
    const dir = makeTempDir();
    writeJson(resolve(dir, "mcp.json"), {
      foo: { type: "stdio", command: "echo" },
    });

    const result = discoverIndexes(dir);
    expect(result.looseIndexes).toHaveLength(1);
    expect(result.looseIndexes[0].type).toBe("mcp");
  });

  it("ignores *.schema.json files", () => {
    const dir = makeTempDir();
    writeJson(resolve(dir, "skills.schema.json"), {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
    });

    const result = discoverIndexes(dir);
    expect(result.looseIndexes).toHaveLength(0);
  });
});

describe("discoverIndexes — skiplist", () => {
  it("skips node_modules, .git, dist, and hidden directories", () => {
    const dir = makeTempDir();
    initGitRepo(dir);
    writeJson(resolve(dir, "node_modules/pkg/skills.json"), {
      a: { description: "a", path: "x" },
    });
    writeJson(resolve(dir, "dist/skills.json"), {
      a: { description: "a", path: "x" },
    });
    writeJson(resolve(dir, ".hidden/skills.json"), {
      a: { description: "a", path: "x" },
    });
    writeJson(resolve(dir, "skills.json"), {
      real: { description: "real", path: "x" },
    });

    const result = discoverIndexes(dir);
    expect(result.looseIndexes).toHaveLength(1);
    expect(result.looseIndexes[0].relPath).toBe("skills.json");
  });

  it("does NOT descend into .claude/ (adapter-owned skills are not AIR-managed)", () => {
    const dir = makeTempDir();
    writeJson(resolve(dir, ".claude/skills/foo.json"), {
      a: { description: "a", path: "x" },
    });

    const result = discoverIndexes(dir);
    expect(result.looseIndexes).toHaveLength(0);
  });

  it("honours the default depth limit (3 levels)", () => {
    const dir = makeTempDir();
    writeJson(resolve(dir, "a/b/c/d/skills.json"), {
      a: { description: "a", path: "x" },
    });
    writeJson(resolve(dir, "a/b/mcp.json"), {
      a: { type: "stdio", command: "echo" },
    });

    const result = discoverIndexes(dir);
    // Depth 3 should include a/b/mcp.json but exclude a/b/c/d/skills.json
    const paths = result.looseIndexes.map((l) => l.relPath).sort();
    expect(paths).toContain(`a/b/mcp.json`);
    expect(paths).not.toContain(`a/b/c/d/skills.json`);
  });

  it("respects a custom maxDepth override", () => {
    const dir = makeTempDir();
    writeJson(resolve(dir, "a/b/skills.json"), {
      a: { description: "a", path: "x" },
    });

    const shallow = discoverIndexes(dir, { maxDepth: 1 });
    expect(shallow.looseIndexes).toHaveLength(0);

    const deep = discoverIndexes(dir, { maxDepth: 3 });
    expect(deep.looseIndexes).toHaveLength(1);
  });
});

describe("discoverIndexes — anchor behavior", () => {
  it("anchors to the git root when called from a subdirectory", () => {
    const dir = makeTempDir();
    initGitRepo(dir);
    writeJson(resolve(dir, "skills.json"), {
      a: { description: "a", path: "x" },
    });
    const sub = resolve(dir, "sub");
    mkdirSync(sub, { recursive: true });

    const result = discoverIndexes(sub);
    expect(result.anchor).toBe(resolve(dir));
    expect(result.anchorIsGitRoot).toBe(true);
    expect(result.looseIndexes).toHaveLength(1);
  });

  it("falls back to the target dir when not in a git repo", () => {
    const dir = makeTempDir();
    writeJson(resolve(dir, "skills.json"), {
      a: { description: "a", path: "x" },
    });

    const result = discoverIndexes(dir);
    expect(result.anchor).toBe(resolve(dir));
    expect(result.anchorIsGitRoot).toBe(false);
  });
});
