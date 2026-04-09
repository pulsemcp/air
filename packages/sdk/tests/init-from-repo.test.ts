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
import {
  initFromRepo,
  smartInit,
  InitFromRepoError,
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

  it("returns branch from symbolic-ref when remote HEAD is set", () => {
    const dir = createGitRepo("https://github.com/acme/repo.git");
    // Set up a fake remote HEAD pointing to main
    execSync(
      "git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main",
      { cwd: dir, stdio: "pipe" }
    );
    // Create the ref so it resolves
    execSync("git update-ref refs/remotes/origin/main HEAD", {
      cwd: dir,
      stdio: "pipe",
    });
    expect(detectDefaultBranch(dir)).toBe("main");
  });

  it("detects master via probe when symbolic-ref fails", () => {
    const dir = createGitRepo("https://github.com/acme/repo.git");
    // Create only an origin/master ref (no origin/main)
    execSync("git update-ref refs/remotes/origin/master HEAD", {
      cwd: dir,
      stdio: "pipe",
    });
    expect(detectDefaultBranch(dir)).toBe("master");
  });

  it("prefers main over master when both exist", () => {
    const dir = createGitRepo("https://github.com/acme/repo.git");
    execSync("git update-ref refs/remotes/origin/main HEAD", {
      cwd: dir,
      stdio: "pipe",
    });
    execSync("git update-ref refs/remotes/origin/master HEAD", {
      cwd: dir,
      stdio: "pipe",
    });
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

  it("skips files inside node_modules", () => {
    const dir = createGitRepo("https://github.com/acme/config.git", {
      "node_modules/some-pkg/skills.json": {
        s: { id: "s", description: "d", path: "p" },
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
    // roots always includes the auto-generated roots.json
    expect(airJson.roots).toEqual(["./roots/roots.json"]);
    // Should not include empty artifact types
    expect(airJson.references).toBeUndefined();
    expect(airJson.plugins).toBeUndefined();
    expect(airJson.hooks).toBeUndefined();
  });

  it("throws InitFromRepoError with EXISTS code when air.json already exists", () => {
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

    try {
      initFromRepo({ cwd: repoDir, path: airJsonPath });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InitFromRepoError);
      expect((err as InitFromRepoError).code).toBe("EXISTS");
    }
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

  it("throws InitFromRepoError with NO_GIT code when not in a git repo", () => {
    const dir = makeTempDir();
    const airJsonPath = resolve(dir, "output", "air.json");

    try {
      initFromRepo({ cwd: dir, path: airJsonPath });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InitFromRepoError);
      expect((err as InitFromRepoError).code).toBe("NO_GIT");
    }
  });

  it("throws InitFromRepoError with NO_REMOTE code when no git remote", () => {
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
    try {
      initFromRepo({ cwd: dir, path: airJsonPath });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InitFromRepoError);
      expect((err as InitFromRepoError).code).toBe("NO_REMOTE");
    }
  });

  it("throws InitFromRepoError with NO_GITHUB code for non-GitHub remote", () => {
    const dir = createGitRepo("https://gitlab.com/acme/repo.git", {
      "skills/skills.json": {
        s: { id: "s", description: "d", path: "p" },
      },
    });

    const airJsonPath = resolve(makeTempDir(), "air.json");
    try {
      initFromRepo({ cwd: dir, path: airJsonPath });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InitFromRepoError);
      expect((err as InitFromRepoError).code).toBe("NO_GITHUB");
    }
  });

  it("throws InitFromRepoError with NO_ARTIFACTS code when no artifacts found", () => {
    const dir = createGitRepo("https://github.com/acme/empty-repo.git");
    const airJsonPath = resolve(makeTempDir(), "air.json");

    try {
      initFromRepo({ cwd: dir, path: airJsonPath });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InitFromRepoError);
      expect((err as InitFromRepoError).code).toBe("NO_ARTIFACTS");
    }
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
            path: "hooks/h1",
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

    // Auto-generated roots.json should be first, discovered roots.json after
    expect(airJson.roots[0]).toBe("./roots/roots.json");
    expect(airJson.roots).toContain(
      "github://acme/full-config@main/roots/roots.json"
    );
  });

  it("auto-generates roots.json for the current repo", () => {
    const repoDir = createGitRepo(
      "https://github.com/acme/my-project.git",
      {
        "skills/skills.json": {
          "deploy-staging": {
            id: "deploy-staging",
            description: "Deploy to staging",
            path: "skills/deploy-staging",
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

    // Verify result fields
    expect(result.generatedRootName).toBe("my-project");
    expect(result.generatedRootsPath).toBe(
      resolve(outputDir, "roots", "roots.json")
    );

    // Verify roots.json file was created
    expect(existsSync(result.generatedRootsPath)).toBe(true);
    const rootsJson = JSON.parse(
      readFileSync(result.generatedRootsPath, "utf-8")
    );
    expect(rootsJson.$schema).toBe(
      "https://raw.githubusercontent.com/pulsemcp/air/main/schemas/roots.schema.json"
    );
    expect(rootsJson["my-project"]).toBeDefined();
    expect(rootsJson["my-project"].name).toBe("my-project");
    expect(rootsJson["my-project"].description).toBe(
      "Agent root for acme/my-project."
    );
    expect(rootsJson["my-project"].url).toBe(
      "https://github.com/acme/my-project.git"
    );
    expect(rootsJson["my-project"].default_branch).toBe("main");
  });

  it("populates root defaults from discovered artifact IDs", () => {
    const repoDir = createGitRepo(
      "https://github.com/acme/config.git",
      {
        "skills/skills.json": {
          "deploy-staging": {
            id: "deploy-staging",
            description: "Deploy",
            path: "skills/deploy-staging",
          },
          "review-pr": {
            id: "review-pr",
            description: "Review",
            path: "skills/review-pr",
          },
        },
        "mcp/mcp.json": {
          github: { type: "stdio", command: "npx", args: ["mcp"] },
          postgres: { type: "stdio", command: "pg" },
        },
        "plugins/plugins.json": {
          "code-quality": {
            id: "code-quality",
            description: "Code quality plugin",
          },
        },
        "hooks/hooks.json": {
          "lint-check": {
            id: "lint-check",
            description: "Lint",
            path: "hooks/lint-check",
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

    const rootsJson = JSON.parse(
      readFileSync(result.generatedRootsPath, "utf-8")
    );
    const root = rootsJson["config"];

    expect(root.default_skills).toEqual(["deploy-staging", "review-pr"]);
    expect(root.default_mcp_servers).toEqual(["github", "postgres"]);
    expect(root.default_plugins).toEqual(["code-quality"]);
    expect(root.default_hooks).toEqual(["lint-check"]);
  });

  it("omits empty default arrays from generated root", () => {
    const repoDir = createGitRepo(
      "https://github.com/acme/simple.git",
      {
        "skills/skills.json": {
          s1: { id: "s1", description: "A skill", path: "skills/s1" },
        },
      }
    );

    const outputDir = makeTempDir();
    const airJsonPath = resolve(outputDir, "air.json");

    const result = initFromRepo({
      cwd: repoDir,
      path: airJsonPath,
    });

    const rootsJson = JSON.parse(
      readFileSync(result.generatedRootsPath, "utf-8")
    );
    const root = rootsJson["simple"];

    expect(root.default_skills).toEqual(["s1"]);
    expect(root.default_mcp_servers).toBeUndefined();
    expect(root.default_plugins).toBeUndefined();
    expect(root.default_hooks).toBeUndefined();
  });
});

describe("smartInit", () => {
  it("returns repo mode when inside a GitHub repo with artifacts", () => {
    const repoDir = createGitRepo(
      "https://github.com/acme/config.git",
      {
        "skills/skills.json": {
          s: { id: "s", description: "d", path: "p" },
        },
      }
    );

    const airJsonPath = resolve(makeTempDir(), "air.json");
    const result = smartInit({ cwd: repoDir, path: airJsonPath });

    expect(result.mode).toBe("repo");
    if (result.mode === "repo") {
      expect(result.repo).toBe("acme/config");
      expect(result.discovered).toHaveLength(1);
    }
  });

  it("falls back to blank mode when not in a git repo", () => {
    const dir = makeTempDir();
    const airJsonPath = resolve(dir, "output", "air.json");

    const result = smartInit({ cwd: dir, path: airJsonPath });

    expect(result.mode).toBe("blank");
    expect(existsSync(airJsonPath)).toBe(true);
  });

  it("falls back to blank mode when no artifacts found", () => {
    const dir = createGitRepo("https://github.com/acme/empty.git");
    const airJsonPath = resolve(makeTempDir(), "air.json");

    const result = smartInit({ cwd: dir, path: airJsonPath });

    expect(result.mode).toBe("blank");
    expect(existsSync(airJsonPath)).toBe(true);
  });

  it("throws EXISTS error when config exists without force", () => {
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

    try {
      smartInit({ cwd: repoDir, path: airJsonPath });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InitFromRepoError);
      expect((err as InitFromRepoError).code).toBe("EXISTS");
    }
  });

  it("overwrites existing config with --force in blank fallback", () => {
    const dir = makeTempDir();
    const airJsonPath = resolve(dir, "air.json");
    writeFileSync(airJsonPath, '{"name":"old"}');

    const result = smartInit({ cwd: dir, path: airJsonPath, force: true });

    expect(result.mode).toBe("blank");
    const content = JSON.parse(readFileSync(airJsonPath, "utf-8"));
    expect(content.name).toBe("my-config");
  });

  it("cleans up stale roots.json when falling back to blank with --force", () => {
    const dir = makeTempDir();
    const airJsonPath = resolve(dir, "air.json");

    // Simulate a previous repo-mode init that created roots.json
    writeFileSync(airJsonPath, '{"name":"old"}');
    const rootsDir = resolve(dir, "roots");
    mkdirSync(rootsDir, { recursive: true });
    const rootsPath = resolve(rootsDir, "roots.json");
    writeFileSync(rootsPath, '{"old-root":{"name":"old-root","description":"stale"}}');

    const result = smartInit({ cwd: dir, path: airJsonPath, force: true });

    expect(result.mode).toBe("blank");
    // Stale roots.json should be cleaned up
    expect(existsSync(rootsPath)).toBe(false);
  });
});
