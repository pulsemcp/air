import { describe, it, expect } from "vitest";
import { normalizeGitUrl, detectRoot } from "../src/commands/prepare.js";
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

  it("returns undefined when roots is empty", () => {
    expect(detectRoot({}, "/tmp/test")).toBeUndefined();
  });

  it("returns undefined when not in a git repo", () => {
    const roots = {
      "web-app": makeRoot("web-app", "https://github.com/pulsemcp/pulsemcp.git", "web-app"),
    };
    // /tmp is not a git repo
    expect(detectRoot(roots, "/tmp")).toBeUndefined();
  });

  it("returns undefined when no roots match the repo URL", () => {
    const roots = {
      "other-repo": makeRoot("other-repo", "https://github.com/other/repo.git"),
    };
    // This test runs in the air repo, so no URL match
    expect(detectRoot(roots, "/tmp/air-pr")).toBeUndefined();
  });

  it("matches root by normalized URL (HTTPS)", () => {
    const roots = {
      air: makeRoot("air", "https://github.com/pulsemcp/air.git"),
    };
    const result = detectRoot(roots, "/tmp/air-pr");
    expect(result?.name).toBe("air");
  });

  it("matches root by normalized URL (SSH format)", () => {
    const roots = {
      air: makeRoot("air", "git@github.com:pulsemcp/air.git"),
    };
    const result = detectRoot(roots, "/tmp/air-pr");
    expect(result?.name).toBe("air");
  });

  it("matches root by normalized URL (without .git suffix)", () => {
    const roots = {
      air: makeRoot("air", "https://github.com/pulsemcp/air"),
    };
    const result = detectRoot(roots, "/tmp/air-pr");
    expect(result?.name).toBe("air");
  });

  it("prefers exact subdirectory match", () => {
    const roots = {
      root: makeRoot("root", "https://github.com/pulsemcp/air.git"),
      packages: makeRoot("packages", "https://github.com/pulsemcp/air.git", "packages"),
      cli: makeRoot("cli", "https://github.com/pulsemcp/air.git", "packages/cli"),
    };
    // When we're in packages/cli, it should pick the exact match
    const result = detectRoot(roots, "/tmp/air-pr/packages/cli");
    expect(result?.name).toBe("cli");
  });

  it("falls back to longest prefix when no exact match", () => {
    const roots = {
      root: makeRoot("root", "https://github.com/pulsemcp/air.git"),
      packages: makeRoot("packages", "https://github.com/pulsemcp/air.git", "packages"),
    };
    // packages/cli/src has no exact match, but "packages" is a prefix
    const result = detectRoot(roots, "/tmp/air-pr/packages/cli/src");
    expect(result?.name).toBe("packages");
  });

  it("falls back to root-level when no subdirectory match", () => {
    const roots = {
      root: makeRoot("root", "https://github.com/pulsemcp/air.git"),
      unrelated: makeRoot("unrelated", "https://github.com/pulsemcp/air.git", "some/other/dir"),
    };
    // At repo root, should prefer the root with no subdirectory
    const result = detectRoot(roots, "/tmp/air-pr");
    expect(result?.name).toBe("root");
  });

  it("skips roots without URL", () => {
    const roots = {
      nourl: { name: "nourl", description: "No URL" } as RootEntry,
      withurl: makeRoot("withurl", "https://github.com/pulsemcp/air.git"),
    };
    const result = detectRoot(roots, "/tmp/air-pr");
    expect(result?.name).toBe("withurl");
  });
});
