import { describe, it, expect, afterEach } from "vitest";
import { existsSync, rmSync } from "fs";
import { resolve } from "path";
import {
  parseGitHubUri,
  getCacheDir,
  getClonePath,
  GitHubCatalogProvider,
} from "../src/github-provider.js";

describe("parseGitHubUri", () => {
  it("parses a basic github:// URI", () => {
    const result = parseGitHubUri("github://acme/air-org/skills/skills.json");
    expect(result).toEqual({
      owner: "acme",
      repo: "air-org",
      path: "skills/skills.json",
    });
  });

  // --- repo-level @ref syntax (preferred) ---

  it("parses URI with @ref on repo segment", () => {
    const result = parseGitHubUri(
      "github://acme/air-org@v1.0.0/mcp/mcp.json"
    );
    expect(result).toEqual({
      owner: "acme",
      repo: "air-org",
      path: "mcp/mcp.json",
      ref: "v1.0.0",
    });
  });

  it("parses URI with branch ref on repo segment", () => {
    const result = parseGitHubUri(
      "github://pulsemcp/pulsemcp@main/agents/skills/skills.json"
    );
    expect(result).toEqual({
      owner: "pulsemcp",
      repo: "pulsemcp",
      path: "agents/skills/skills.json",
      ref: "main",
    });
  });

  it("parses URI with commit SHA ref on repo segment", () => {
    const result = parseGitHubUri(
      "github://acme/repo@abc123/path/file.json"
    );
    expect(result).toEqual({
      owner: "acme",
      repo: "repo",
      path: "path/file.json",
      ref: "abc123",
    });
  });

  // --- legacy path-level @ref syntax (backward compat) ---

  it("parses URI with legacy @ref on path", () => {
    const result = parseGitHubUri(
      "github://acme/air-org/mcp/mcp.json@v1.0.0"
    );
    expect(result).toEqual({
      owner: "acme",
      repo: "air-org",
      path: "mcp/mcp.json",
      ref: "v1.0.0",
    });
  });

  it("parses URI with legacy branch ref on path", () => {
    const result = parseGitHubUri(
      "github://pulsemcp/pulsemcp/agents/skills/skills.json@main"
    );
    expect(result).toEqual({
      owner: "pulsemcp",
      repo: "pulsemcp",
      path: "agents/skills/skills.json",
      ref: "main",
    });
  });

  // --- general parsing ---

  it("handles deeply nested paths", () => {
    const result = parseGitHubUri(
      "github://org/repo/a/b/c/d/file.json"
    );
    expect(result).toEqual({
      owner: "org",
      repo: "repo",
      path: "a/b/c/d/file.json",
    });
  });

  it("handles deeply nested paths with repo-level ref", () => {
    const result = parseGitHubUri(
      "github://org/repo@develop/a/b/c/d/file.json"
    );
    expect(result).toEqual({
      owner: "org",
      repo: "repo",
      path: "a/b/c/d/file.json",
      ref: "develop",
    });
  });

  // --- error cases ---

  it("throws on URI with too few segments", () => {
    expect(() => parseGitHubUri("github://acme/repo")).toThrow(
      "Invalid github:// URI"
    );
  });

  it("throws on URI with only owner", () => {
    expect(() => parseGitHubUri("github://acme")).toThrow(
      "Invalid github:// URI"
    );
  });

  it("rejects path traversal in owner", () => {
    expect(() => parseGitHubUri("github://../../etc/repo/file.json")).toThrow(
      "Path traversal"
    );
  });

  it("rejects path traversal in ref on path", () => {
    expect(() =>
      parseGitHubUri("github://acme/repo/file.json@../../etc")
    ).toThrow("Path traversal");
  });

  it("rejects path traversal in ref on repo", () => {
    expect(() =>
      parseGitHubUri("github://acme/repo@../../etc/file.json")
    ).toThrow("Path traversal");
  });

  it("rejects shell metacharacters in owner", () => {
    expect(() =>
      parseGitHubUri("github://$(whoami)/repo/file.json")
    ).toThrow("Invalid owner");
  });

  it("rejects shell metacharacters in ref on path", () => {
    expect(() =>
      parseGitHubUri("github://acme/repo/file.json@main;rm -rf /")
    ).toThrow("Invalid ref");
  });

  it("rejects shell metacharacters in ref on repo", () => {
    expect(() =>
      parseGitHubUri("github://acme/repo@main;rm -rf //file.json")
    ).toThrow("Invalid ref");
  });

  it("gives helpful error for repo@ref with no path", () => {
    expect(() =>
      parseGitHubUri("github://acme/repo@main")
    ).toThrow("Missing file path");
  });

  it("rejects empty ref after @ on repo segment", () => {
    expect(() =>
      parseGitHubUri("github://acme/repo@/path/file.json")
    ).toThrow('Empty ref after "@"');
  });

  it("rejects ambiguous double @ref on repo and path", () => {
    expect(() =>
      parseGitHubUri("github://acme/repo@v1/path/file.json@v2")
    ).toThrow("Ambiguous");
  });

  it("handles ref with slashes via legacy path syntax", () => {
    const result = parseGitHubUri(
      "github://acme/repo/path/file.json@feature/branch"
    );
    expect(result).toEqual({
      owner: "acme",
      repo: "repo",
      path: "path/file.json",
      ref: "feature/branch",
    });
  });
});

describe("getCacheDir", () => {
  it("returns a path under ~/.air/cache/github", () => {
    const dir = getCacheDir();
    expect(dir).toContain(".air");
    expect(dir).toContain("cache");
    expect(dir).toContain("github");
  });
});

describe("getClonePath", () => {
  it("builds cache path from owner/repo/ref", () => {
    const path = getClonePath("acme", "repo", "main");
    expect(path).toContain("acme");
    expect(path).toContain("repo");
    expect(path).toContain("main");
  });
});

describe("GitHubCatalogProvider", () => {
  // Integration tests below clone pulsemcp/air publicly. CI runners do not have
  // SSH keys registered with GitHub, so every provider that performs a real
  // clone in this file must be explicitly configured for HTTPS. The default
  // remains SSH — see the dedicated "git protocol" block of tests for coverage
  // of the default.
  const provider = new GitHubCatalogProvider();
  provider.configure({ gitProtocol: "https" });

  it("has scheme 'github'", () => {
    expect(provider.scheme).toBe("github");
  });

  it("accepts token via constructor options", () => {
    const tokenProvider = new GitHubCatalogProvider({ token: "ghp_test123" });
    expect(tokenProvider.scheme).toBe("github");
  });

  it("returns helpful error for non-existent repos", async () => {
    // Clean up any leftover partial clone
    const cloneDir = getClonePath("nonexistent-owner-abc123", "nonexistent-repo-xyz789", "HEAD");
    if (existsSync(cloneDir)) {
      rmSync(cloneDir, { recursive: true, force: true });
    }

    await expect(
      provider.resolve(
        "github://nonexistent-owner-abc123/nonexistent-repo-xyz789/file.json",
        "/tmp"
      )
    ).rejects.toThrow("Failed to clone nonexistent-owner-abc123/nonexistent-repo-xyz789");
  });

  it("clones a public repo and reads a file", async () => {
    // Clean up any prior clone
    const cloneDir = getClonePath("pulsemcp", "air", "HEAD");
    if (existsSync(cloneDir)) {
      rmSync(cloneDir, { recursive: true, force: true });
    }

    const result = await provider.resolve(
      "github://pulsemcp/air/examples/skills/skills.json",
      "/tmp"
    );
    expect(Object.keys(result).length).toBeGreaterThan(0);
    expect(result["deploy-staging"]).toBeDefined();

    // Clone directory should exist after resolve
    expect(existsSync(resolve(cloneDir, ".git"))).toBe(true);
  }, 30000);

  it("reuses existing clone on subsequent calls", async () => {
    // This relies on the clone from the previous test
    const result = await provider.resolve(
      "github://pulsemcp/air/examples/skills/skills.json",
      "/tmp"
    );
    expect(Object.keys(result).length).toBeGreaterThan(0);
  }, 30000);

  it("serializes concurrent resolve() calls against an empty cache", async () => {
    // Start from an empty cache so every concurrent caller races on the
    // clone — this is the real-world scenario that produced
    // "File not found in cloned repository" before the lock + tmp-rename fix.
    const cloneDir = getClonePath("pulsemcp", "air", "HEAD");
    if (existsSync(cloneDir)) {
      rmSync(cloneDir, { recursive: true, force: true });
    }

    const results = await Promise.all([
      provider.resolve(
        "github://pulsemcp/air/examples/skills/skills.json",
        "/tmp"
      ),
      provider.resolve(
        "github://pulsemcp/air/examples/skills/skills.json",
        "/tmp"
      ),
      provider.resolve(
        "github://pulsemcp/air/examples/mcp/mcp.json",
        "/tmp"
      ),
      provider.resolve(
        "github://pulsemcp/air/examples/skills/skills.json",
        "/tmp"
      ),
    ]);

    expect(results).toHaveLength(4);
    for (const r of results) {
      expect(Object.keys(r).length).toBeGreaterThan(0);
    }
    expect(existsSync(resolve(cloneDir, ".git"))).toBe(true);
  }, 60000);

  it("resolveSourceDir returns directory of the file within clone", () => {
    const cloneDir = getClonePath("pulsemcp", "air", "HEAD");
    if (!existsSync(cloneDir)) return;

    const sourceDir = provider.resolveSourceDir(
      "github://pulsemcp/air/examples/skills/skills.json"
    );
    expect(sourceDir).toBeDefined();
    expect(sourceDir).toContain("examples/skills");
  });

  it("throws when file not found in clone", async () => {
    const cloneDir = getClonePath("pulsemcp", "air", "HEAD");
    if (!existsSync(resolve(cloneDir, ".git"))) {
      await provider.resolve(
        "github://pulsemcp/air/examples/skills/skills.json",
        "/tmp"
      );
    }

    await expect(
      provider.resolve(
        "github://pulsemcp/air/nonexistent/path/file.json",
        "/tmp"
      )
    ).rejects.toThrow("File not found in cloned repository");
  }, 30000);

  // --- checkFreshness ---

  it("checkFreshness returns empty array for URIs with no local clone", async () => {
    const warnings = await provider.checkFreshness([
      "github://nonexistent-owner-xyz/nonexistent-repo-xyz/file.json",
    ]);
    expect(warnings).toEqual([]);
  });

  it("checkFreshness skips immutable refs (full SHA)", async () => {
    const sha = "a".repeat(40);
    const warnings = await provider.checkFreshness([
      `github://pulsemcp/air@${sha}/examples/skills/skills.json`,
    ]);
    expect(warnings).toEqual([]);
  });

  it("checkFreshness checks a cached clone against remote", async () => {
    // Ensure clone exists
    const cloneDir = getClonePath("pulsemcp", "air", "HEAD");
    if (!existsSync(resolve(cloneDir, ".git"))) {
      await provider.resolve(
        "github://pulsemcp/air/examples/skills/skills.json",
        "/tmp"
      );
    }

    // Should return either empty (up-to-date) or a warning (behind)
    const warnings = await provider.checkFreshness([
      "github://pulsemcp/air/examples/skills/skills.json",
    ]);
    expect(Array.isArray(warnings)).toBe(true);

    // If there are warnings, they should have the expected shape
    for (const w of warnings) {
      expect(w.uri).toBe("github://pulsemcp/air/examples/skills/skills.json");
      expect(w.message).toContain("air update");
    }
  }, 30000);

  it("checkFreshness de-duplicates by owner/repo/ref", async () => {
    // Ensure clone exists
    const cloneDir = getClonePath("pulsemcp", "air", "HEAD");
    if (!existsSync(resolve(cloneDir, ".git"))) {
      await provider.resolve(
        "github://pulsemcp/air/examples/skills/skills.json",
        "/tmp"
      );
    }

    // Two URIs pointing to the same repo/ref should produce at most one warning
    const warnings = await provider.checkFreshness([
      "github://pulsemcp/air/examples/skills/skills.json",
      "github://pulsemcp/air/examples/mcp/mcp.json",
    ]);
    // At most 1 warning for the single repo/ref
    expect(warnings.length).toBeLessThanOrEqual(1);
  }, 30000);

  // --- refreshCache ---

  it("refreshCache returns results for cached clones", async () => {
    // Ensure at least one clone exists
    const cloneDir = getClonePath("pulsemcp", "air", "HEAD");
    if (!existsSync(resolve(cloneDir, ".git"))) {
      await provider.resolve(
        "github://pulsemcp/air/examples/skills/skills.json",
        "/tmp"
      );
    }

    const results = await provider.refreshCache();
    expect(Array.isArray(results)).toBe(true);

    // Should include the pulsemcp/air@HEAD clone
    const airResult = results.find((r) => r.label.includes("pulsemcp/air"));
    expect(airResult).toBeDefined();
    expect(typeof airResult!.updated).toBe("boolean");
    expect(typeof airResult!.message).toBe("string");
  }, 60000);

  it("refreshCache returns empty array when no cache exists", async () => {
    // Create a provider that uses a non-existent cache dir by mocking HOME
    const origHome = process.env.HOME;
    process.env.HOME = "/tmp/air-test-no-cache-" + Date.now();
    try {
      const freshProvider = new GitHubCatalogProvider();
      const results = await freshProvider.refreshCache();
      expect(results).toEqual([]);
    } finally {
      process.env.HOME = origHome;
    }
  });
});

describe("GitHubCatalogProvider — git protocol", () => {
  // These tests don't hit the network — they only verify URL construction,
  // so they're safe to run without SSH keys or tokens.

  afterEach(() => {
    delete process.env.AIR_GIT_PROTOCOL;
  });

  it("defaults to SSH when no protocol is configured", () => {
    delete process.env.AIR_GIT_PROTOCOL;
    const provider = new GitHubCatalogProvider();
    expect(provider.getGitProtocol()).toBe("ssh");
    expect(provider.buildCloneUrl("pulsemcp", "air")).toBe(
      "git@github.com:pulsemcp/air.git"
    );
  });

  it("builds SSH URL with no token injection even when token is set", () => {
    const provider = new GitHubCatalogProvider({
      token: "ghp_secrettoken",
      gitProtocol: "ssh",
    });
    const url = provider.buildCloneUrl("pulsemcp", "air");
    expect(url).toBe("git@github.com:pulsemcp/air.git");
    expect(url).not.toContain("ghp_secrettoken");
  });

  it("builds HTTPS URL when gitProtocol is https", () => {
    const provider = new GitHubCatalogProvider({ gitProtocol: "https" });
    expect(provider.getGitProtocol()).toBe("https");
    expect(provider.buildCloneUrl("pulsemcp", "air")).toBe(
      "https://github.com/pulsemcp/air.git"
    );
  });

  it("injects token into HTTPS clone URL when available", () => {
    const provider = new GitHubCatalogProvider({
      gitProtocol: "https",
      token: "ghp_abc123",
    });
    expect(provider.buildCloneUrl("pulsemcp", "air")).toBe(
      "https://ghp_abc123@github.com/pulsemcp/air.git"
    );
  });

  it("honors AIR_GIT_PROTOCOL=https environment variable", () => {
    process.env.AIR_GIT_PROTOCOL = "https";
    const provider = new GitHubCatalogProvider();
    expect(provider.getGitProtocol()).toBe("https");
    expect(provider.buildCloneUrl("pulsemcp", "air")).toBe(
      "https://github.com/pulsemcp/air.git"
    );
  });

  it("falls back to default when AIR_GIT_PROTOCOL has an invalid value", () => {
    process.env.AIR_GIT_PROTOCOL = "ftp";
    const provider = new GitHubCatalogProvider();
    expect(provider.getGitProtocol()).toBe("ssh");
  });

  it("constructor option takes precedence over env var", () => {
    process.env.AIR_GIT_PROTOCOL = "https";
    const provider = new GitHubCatalogProvider({ gitProtocol: "ssh" });
    expect(provider.getGitProtocol()).toBe("ssh");
  });

  it("configure() overrides the constructor-time protocol", () => {
    const provider = new GitHubCatalogProvider({ gitProtocol: "ssh" });
    expect(provider.getGitProtocol()).toBe("ssh");
    provider.configure({ gitProtocol: "https" });
    expect(provider.getGitProtocol()).toBe("https");
    expect(provider.buildCloneUrl("pulsemcp", "air")).toBe(
      "https://github.com/pulsemcp/air.git"
    );
  });

  it("configure() with no gitProtocol key leaves the protocol unchanged", () => {
    const provider = new GitHubCatalogProvider({ gitProtocol: "https" });
    provider.configure({ unrelatedKey: "value" });
    expect(provider.getGitProtocol()).toBe("https");
  });

  it("configure() ignores invalid gitProtocol values", () => {
    const provider = new GitHubCatalogProvider({ gitProtocol: "https" });
    provider.configure({ gitProtocol: "ftp" });
    expect(provider.getGitProtocol()).toBe("https");
  });

  it("builds correct URLs for various owner/repo combinations in SSH mode", () => {
    const provider = new GitHubCatalogProvider({ gitProtocol: "ssh" });
    expect(provider.buildCloneUrl("acme", "widgets")).toBe(
      "git@github.com:acme/widgets.git"
    );
    expect(provider.buildCloneUrl("org-with-dash", "repo.with.dots")).toBe(
      "git@github.com:org-with-dash/repo.with.dots.git"
    );
  });
});
