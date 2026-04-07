import { describe, it, expect, afterEach } from "vitest";
import { execSync } from "child_process";
import { resolve } from "path";
import {
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { initFromRepo } from "../src/init-from-repo.js";
import {
  parseGitHubRemote,
  detectDefaultBranch,
  discoverArtifacts,
} from "../src/init-from-repo.js";

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
    `air-init-repo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function createGitRepo(
  remoteUrl: string,
  files?: Record<string, unknown>
): string {
  const dir = makeTempDir();

  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync(`git remote add origin ${remoteUrl}`, {
    cwd: dir,
    stdio: "pipe",
  });
  execSync(
    'git config user.email "test@test.com" && git config user.name "Test"',
    { cwd: dir, stdio: "pipe" }
  );

  if (files) {
    for (const [name, content] of Object.entries(files)) {
      const filePath = resolve(dir, name);
      mkdirSync(resolve(filePath, ".."), { recursive: true });
      writeFileSync(
        filePath,
        typeof content === "string"
          ? content
          : JSON.stringify(content, null, 2)
      );
    }
  } else {
    writeFileSync(resolve(dir, ".gitkeep"), "");
  }

  execSync("git add . && git commit -m init", { cwd: dir, stdio: "pipe" });

  return dir;
}

describe("parseGitHubRemote", () => {
  it("parses HTTPS URL with .git", () => {
    expect(
      parseGitHubRemote("https://github.com/acme/air-config.git")
    ).toBe("acme/air-config");
  });

  it("parses HTTPS URL without .git", () => {
    expect(
      parseGitHubRemote("https://github.com/acme/air-config")
    ).toBe("acme/air-config");
  });

  it("parses SSH URL with .git", () => {
    expect(
      parseGitHubRemote("git@github.com:acme/air-config.git")
    ).toBe("acme/air-config");
  });

  it("parses SSH URL without .git", () => {
    expect(
      parseGitHubRemote("git@github.com:acme/air-config")
    ).toBe("acme/air-config");
  });

  it("trims whitespace", () => {
    expect(
      parseGitHubRemote("  https://github.com/org/repo.git  ")
    ).toBe("org/repo");
  });

  it("throws for non-GitHub URL", () => {
    expect(() =>
      parseGitHubRemote("https://gitlab.com/acme/repo.git")
    ).toThrow("Could not parse GitHub");
  });

  it("throws for empty string", () => {
    expect(() => parseGitHubRemote("")).toThrow("Could not parse GitHub");
  });
});

describe("detectDefaultBranch", () => {
  it("falls back to main when no remote HEAD is set", () => {
    const dir = createGitRepo("https://github.com/acme/repo.git");
    expect(detectDefaultBranch(dir)).toBe("main");
  });
});

describe("discoverArtifacts", () => {
  it("discovers skills.json", () => {
    const dir = createGitRepo("https://github.com/acme/config.git", {
      "skills/skills.json": {
        "deploy-staging": {
          id: "deploy-staging",
          description: "Deploy to staging",
          path: "skills/deploy-staging",
        },
      },
    });

    const artifacts = discoverArtifacts(dir, "acme/config", "main");
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].type).toBe("skills");
    expect(artifacts[0].repoPath).toBe("skills/skills.json");
    expect(artifacts[0].uri).toBe(
      "github://acme/config@main/skills/skills.json"
    );
  });

  it("discovers multiple artifact types", () => {
    const dir = createGitRepo("https://github.com/acme/config.git", {
      "skills/skills.json": {
        "my-skill": {
          id: "my-skill",
          description: "A skill",
          path: "skills/my-skill",
        },
      },
      "references/references.json": {
        "my-ref": {
          id: "my-ref",
          description: "A reference",
          file: "docs/ref.md",
        },
      },
      "mcp/mcp.json": {
        github: {
          type: "stdio",
          command: "npx",
          args: ["-y", "mcp-server"],
        },
      },
    });

    const artifacts = discoverArtifacts(dir, "acme/config", "main");
    expect(artifacts).toHaveLength(3);

    const types = artifacts.map((a) => a.type).sort();
    expect(types).toEqual(["mcp", "references", "skills"]);
  });

  it("skips invalid JSON files", () => {
    const dir = createGitRepo("https://github.com/acme/config.git", {
      "skills/skills.json": "not valid json",
    });

    const artifacts = discoverArtifacts(dir, "acme/config", "main");
    expect(artifacts).toHaveLength(0);
  });

  it("skips files that don't validate against schema", () => {
    const dir = createGitRepo("https://github.com/acme/config.git", {
      // skills.json with invalid content (missing required fields)
      "skills/skills.json": {
        "bad-skill": { title: "Missing required id and description" },
      },
    });

    const artifacts = discoverArtifacts(dir, "acme/config", "main");
    expect(artifacts).toHaveLength(0);
  });

  it("returns empty array for repos with no JSON files", () => {
    const dir = createGitRepo("https://github.com/acme/config.git");
    const artifacts = discoverArtifacts(dir, "acme/config", "main");
    expect(artifacts).toHaveLength(0);
  });

  it("skips air.json files", () => {
    const dir = createGitRepo("https://github.com/acme/config.git", {
      "air.json": { name: "test-config" },
    });

    const artifacts = discoverArtifacts(dir, "acme/config", "main");
    expect(artifacts).toHaveLength(0);
  });

  it("skips files in hidden directories (root and nested)", () => {
    const dir = createGitRepo("https://github.com/acme/config.git", {
      ".hidden/skills.json": {
        s: { id: "s", description: "d", path: "p" },
      },
      "path/.secret/mcp.json": {
        m: { type: "stdio", command: "echo" },
      },
      // This one should be discovered
      "skills/skills.json": {
        s: { id: "s", description: "d", path: "p" },
      },
    });

    const artifacts = discoverArtifacts(dir, "acme/config", "main");
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].repoPath).toBe("skills/skills.json");
  });

  it("discovers multiple files of the same artifact type", () => {
    const dir = createGitRepo("https://github.com/acme/config.git", {
      "frontend/skills.json": {
        s1: { id: "s1", description: "frontend skill", path: "p1" },
      },
      "backend/skills.json": {
        s2: { id: "s2", description: "backend skill", path: "p2" },
      },
    });

    const artifacts = discoverArtifacts(dir, "acme/config", "main");
    expect(artifacts).toHaveLength(2);
    expect(artifacts.every((a) => a.type === "skills")).toBe(true);
    const paths = artifacts.map((a) => a.repoPath).sort();
    expect(paths).toEqual([
      "backend/skills.json",
      "frontend/skills.json",
    ]);
  });
});

describe("initFromRepo", () => {
  it("generates air.json with GitHub resolvers", () => {
    const repoDir = createGitRepo(
      "https://github.com/acme/air-config.git",
      {
        "skills/skills.json": {
          "deploy-staging": {
            id: "deploy-staging",
            description: "Deploy to staging",
            path: "skills/deploy-staging",
          },
        },
        "mcp/mcp.json": {
          github: {
            type: "stdio",
            command: "npx",
            args: ["-y", "mcp-server"],
          },
        },
      }
    );

    const outputDir = makeTempDir();
    const airJsonPath = resolve(outputDir, "air.json");

    const result = initFromRepo({
      cwd: repoDir,
      path: airJsonPath,
    });

    expect(result.repo).toBe("acme/air-config");
    expect(result.branch).toBe("main");
    expect(result.discovered).toHaveLength(2);
    expect(result.overwritten).toBe(false);
    expect(result.airJsonPath).toBe(airJsonPath);

    // Verify generated air.json content
    const airJson = JSON.parse(readFileSync(airJsonPath, "utf-8"));
    expect(airJson.name).toBe("air-config");
    expect(airJson.extensions).toEqual(["@pulsemcp/air-provider-github"]);
    expect(airJson.skills).toEqual([
      "github://acme/air-config@main/skills/skills.json",
    ]);
    expect(airJson.mcp).toEqual([
      "github://acme/air-config@main/mcp/mcp.json",
    ]);
    // Should not include empty artifact types
    expect(airJson.references).toBeUndefined();
    expect(airJson.plugins).toBeUndefined();
    expect(airJson.roots).toBeUndefined();
    expect(airJson.hooks).toBeUndefined();
  });

  it("throws when air.json already exists without --force", () => {
    const repoDir = createGitRepo(
      "https://github.com/acme/config.git",
      {
        "skills/skills.json": {
          s: { id: "s", description: "d", path: "p" },
        },
      }
    );

    const outputDir = makeTempDir();
    const airJsonPath = resolve(outputDir, "air.json");
    writeFileSync(airJsonPath, "{}");

    expect(() =>
      initFromRepo({ cwd: repoDir, path: airJsonPath })
    ).toThrow("already exists");
  });

  it("overwrites existing air.json with --force", () => {
    const repoDir = createGitRepo(
      "https://github.com/acme/config.git",
      {
        "skills/skills.json": {
          s: { id: "s", description: "d", path: "p" },
        },
      }
    );

    const outputDir = makeTempDir();
    const airJsonPath = resolve(outputDir, "air.json");
    writeFileSync(airJsonPath, '{"name":"old"}');

    const result = initFromRepo({
      cwd: repoDir,
      path: airJsonPath,
      force: true,
    });

    expect(result.overwritten).toBe(true);
    const airJson = JSON.parse(readFileSync(airJsonPath, "utf-8"));
    expect(airJson.name).toBe("config");
    expect(airJson.skills).toBeDefined();
  });

  it("throws when not in a git repo", () => {
    const dir = makeTempDir();
    const airJsonPath = resolve(dir, "output", "air.json");

    expect(() =>
      initFromRepo({ cwd: dir, path: airJsonPath })
    ).toThrow("Not inside a git repository");
  });

  it("throws when no git remote is configured", () => {
    const dir = makeTempDir();
    execSync("git init", { cwd: dir, stdio: "pipe" });
    execSync(
      'git config user.email "t@t.com" && git config user.name "T"',
      { cwd: dir, stdio: "pipe" }
    );
    writeFileSync(resolve(dir, ".gitkeep"), "");
    execSync("git add . && git commit -m init", {
      cwd: dir,
      stdio: "pipe",
    });

    const airJsonPath = resolve(makeTempDir(), "air.json");
    expect(() =>
      initFromRepo({ cwd: dir, path: airJsonPath })
    ).toThrow("No git remote");
  });

  it("throws when remote is not a GitHub URL", () => {
    const dir = createGitRepo("https://gitlab.com/acme/repo.git", {
      "skills/skills.json": {
        s: { id: "s", description: "d", path: "p" },
      },
    });

    const airJsonPath = resolve(makeTempDir(), "air.json");
    expect(() =>
      initFromRepo({ cwd: dir, path: airJsonPath })
    ).toThrow("Could not parse GitHub");
  });

  it("throws when no artifact files are found", () => {
    const dir = createGitRepo("https://github.com/acme/empty-repo.git");
    const airJsonPath = resolve(makeTempDir(), "air.json");

    expect(() =>
      initFromRepo({ cwd: dir, path: airJsonPath })
    ).toThrow("No AIR artifact index files");
  });

  it("creates parent directories for output path", () => {
    const repoDir = createGitRepo(
      "https://github.com/acme/config.git",
      {
        "skills/skills.json": {
          s: { id: "s", description: "d", path: "p" },
        },
      }
    );

    const outputDir = makeTempDir();
    const airJsonPath = resolve(outputDir, "nested", "deep", "air.json");

    const result = initFromRepo({
      cwd: repoDir,
      path: airJsonPath,
    });

    expect(existsSync(airJsonPath)).toBe(true);
    expect(result.airDir).toBe(resolve(outputDir, "nested", "deep"));
  });

  it("parses SSH remote URLs correctly", () => {
    const repoDir = createGitRepo(
      "git@github.com:myorg/my-repo.git",
      {
        "mcp/mcp.json": {
          server: {
            type: "stdio",
            command: "echo",
          },
        },
      }
    );

    const airJsonPath = resolve(makeTempDir(), "air.json");
    const result = initFromRepo({
      cwd: repoDir,
      path: airJsonPath,
    });

    expect(result.repo).toBe("myorg/my-repo");
    const airJson = JSON.parse(readFileSync(airJsonPath, "utf-8"));
    expect(airJson.mcp[0]).toContain("github://myorg/my-repo@main/");
  });

  it("includes multiple same-type artifacts as separate URIs", () => {
    const repoDir = createGitRepo(
      "https://github.com/acme/config.git",
      {
        "frontend/skills.json": {
          s1: { id: "s1", description: "frontend skill", path: "p1" },
        },
        "backend/skills.json": {
          s2: { id: "s2", description: "backend skill", path: "p2" },
        },
      }
    );

    const airJsonPath = resolve(makeTempDir(), "air.json");
    const result = initFromRepo({
      cwd: repoDir,
      path: airJsonPath,
    });

    expect(result.discovered).toHaveLength(2);

    const airJson = JSON.parse(readFileSync(airJsonPath, "utf-8"));
    expect(airJson.skills).toHaveLength(2);
    expect(airJson.skills).toContain(
      "github://acme/config@main/backend/skills.json"
    );
    expect(airJson.skills).toContain(
      "github://acme/config@main/frontend/skills.json"
    );
  });

  it("discovers all six artifact types", () => {
    const repoDir = createGitRepo(
      "https://github.com/acme/full-config.git",
      {
        "skills/skills.json": {
          s1: { id: "s1", description: "skill", path: "skills/s1" },
        },
        "references/references.json": {
          r1: { id: "r1", description: "ref", file: "docs/r1.md" },
        },
        "mcp/mcp.json": {
          m1: { type: "stdio", command: "echo" },
        },
        "plugins/plugins.json": {
          p1: { id: "p1", description: "plugin" },
        },
        "roots/roots.json": {
          root1: { name: "root1", description: "a root" },
        },
        "hooks/hooks.json": {
          h1: {
            id: "h1",
            description: "hook",
            event: "session_start",
            command: "echo",
          },
        },
      }
    );

    const airJsonPath = resolve(makeTempDir(), "air.json");
    const result = initFromRepo({
      cwd: repoDir,
      path: airJsonPath,
    });

    expect(result.discovered).toHaveLength(6);

    const airJson = JSON.parse(readFileSync(airJsonPath, "utf-8"));
    expect(airJson.skills).toBeDefined();
    expect(airJson.references).toBeDefined();
    expect(airJson.mcp).toBeDefined();
    expect(airJson.plugins).toBeDefined();
    expect(airJson.roots).toBeDefined();
    expect(airJson.hooks).toBeDefined();
  });
});
