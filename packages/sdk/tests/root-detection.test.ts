import { describe, it, expect, afterEach } from "vitest";
import { execSync } from "child_process";
import { mkdirSync, rmSync, existsSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import { normalizeGitUrl, detectRoot } from "../src/root-detection.js";
import type { RootEntry } from "@pulsemcp/air-core";

describe("normalizeGitUrl", () => {
  it("normalizes HTTPS URL", () => {
    expect(normalizeGitUrl("https://github.com/pulsemcp/pulsemcp.git")).toBe(
      "github.com/pulsemcp/pulsemcp"
    );
  });

  it("normalizes HTTPS URL without .git", () => {
    expect(normalizeGitUrl("https://github.com/pulsemcp/pulsemcp")).toBe(
      "github.com/pulsemcp/pulsemcp"
    );
  });

  it("normalizes SSH URL", () => {
    expect(normalizeGitUrl("git@github.com:pulsemcp/pulsemcp.git")).toBe(
      "github.com/pulsemcp/pulsemcp"
    );
  });

  it("normalizes SSH URL without .git", () => {
    expect(normalizeGitUrl("git@github.com:pulsemcp/pulsemcp")).toBe(
      "github.com/pulsemcp/pulsemcp"
    );
  });

  it("strips trailing slash", () => {
    expect(normalizeGitUrl("https://github.com/pulsemcp/pulsemcp/")).toBe(
      "github.com/pulsemcp/pulsemcp"
    );
  });

  it("trims whitespace", () => {
    expect(normalizeGitUrl("  https://github.com/org/repo.git  ")).toBe(
      "github.com/org/repo"
    );
  });

  it("normalizes HTTP URL", () => {
    expect(normalizeGitUrl("http://github.com/org/repo.git")).toBe(
      "github.com/org/repo"
    );
  });
});

describe("detectRoot", () => {
  const makeRoot = (name: string, url: string, subdirectory?: string): RootEntry => ({
    name,
    description: `${name} root`,
    url,
    subdirectory,
  });

  const tempDirs: string[] = [];

  function createTempGitRepo(remoteUrl: string, subdirs?: string[]): string {
    const dir = resolve(
      tmpdir(),
      `air-sdk-root-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    mkdirSync(dir, { recursive: true });
    tempDirs.push(dir);

    execSync("git init", { cwd: dir, stdio: "pipe" });
    execSync(`git remote add origin ${remoteUrl}`, { cwd: dir, stdio: "pipe" });
    execSync("git config user.email test@test.com && git config user.name Test", { cwd: dir, stdio: "pipe" });
    execSync("touch .gitkeep && git add . && git commit -m init", { cwd: dir, stdio: "pipe" });

    if (subdirs) {
      for (const sub of subdirs) {
        mkdirSync(resolve(dir, sub), { recursive: true });
      }
    }

    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    tempDirs.length = 0;
  });

  it("returns undefined when roots is empty", () => {
    expect(detectRoot({}, "/tmp")).toBeUndefined();
  });

  it("returns undefined when not in a git repo", () => {
    const roots = {
      "web-app": makeRoot("web-app", "https://github.com/pulsemcp/pulsemcp.git", "web-app"),
    };
    expect(detectRoot(roots, "/tmp")).toBeUndefined();
  });

  it("returns undefined when no roots match the repo URL", () => {
    const dir = createTempGitRepo("https://github.com/test/myrepo.git");
    const roots = {
      "other-repo": makeRoot("other-repo", "https://github.com/other/repo.git"),
    };
    expect(detectRoot(roots, dir)).toBeUndefined();
  });

  it("matches root by normalized URL (HTTPS)", () => {
    const dir = createTempGitRepo("https://github.com/pulsemcp/air.git");
    const roots = {
      air: makeRoot("air", "https://github.com/pulsemcp/air.git"),
    };
    const result = detectRoot(roots, dir);
    expect(result?.name).toBe("air");
  });

  it("matches root by normalized URL (SSH format)", () => {
    const dir = createTempGitRepo("https://github.com/pulsemcp/air.git");
    const roots = {
      air: makeRoot("air", "git@github.com:pulsemcp/air.git"),
    };
    const result = detectRoot(roots, dir);
    expect(result?.name).toBe("air");
  });

  it("prefers exact subdirectory match", () => {
    const dir = createTempGitRepo("https://github.com/pulsemcp/air.git", [
      "packages/cli",
    ]);
    const roots = {
      root: makeRoot("root", "https://github.com/pulsemcp/air.git"),
      packages: makeRoot("packages", "https://github.com/pulsemcp/air.git", "packages"),
      cli: makeRoot("cli", "https://github.com/pulsemcp/air.git", "packages/cli"),
    };
    const result = detectRoot(roots, resolve(dir, "packages/cli"));
    expect(result?.name).toBe("cli");
  });

  it("falls back to longest prefix when no exact match", () => {
    const dir = createTempGitRepo("https://github.com/pulsemcp/air.git", [
      "packages/cli/src",
    ]);
    const roots = {
      root: makeRoot("root", "https://github.com/pulsemcp/air.git"),
      packages: makeRoot("packages", "https://github.com/pulsemcp/air.git", "packages"),
    };
    const result = detectRoot(roots, resolve(dir, "packages/cli/src"));
    expect(result?.name).toBe("packages");
  });

  it("falls back to root-level when no subdirectory match", () => {
    const dir = createTempGitRepo("https://github.com/pulsemcp/air.git");
    const roots = {
      root: makeRoot("root", "https://github.com/pulsemcp/air.git"),
      unrelated: makeRoot("unrelated", "https://github.com/pulsemcp/air.git", "some/other/dir"),
    };
    const result = detectRoot(roots, dir);
    expect(result?.name).toBe("root");
  });

  it("skips roots without URL", () => {
    const dir = createTempGitRepo("https://github.com/pulsemcp/air.git");
    const roots = {
      nourl: { name: "nourl", description: "No URL" } as RootEntry,
      withurl: makeRoot("withurl", "https://github.com/pulsemcp/air.git"),
    };
    const result = detectRoot(roots, dir);
    expect(result?.name).toBe("withurl");
  });
});
