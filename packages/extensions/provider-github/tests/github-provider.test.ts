import { describe, it, expect } from "vitest";
import {
  parseGitHubUri,
  getCacheDir,
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

  it("parses URI with @ref", () => {
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

  it("parses URI with branch ref", () => {
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
});

describe("getCacheDir", () => {
  it("returns a path under ~/.air/cache/github", () => {
    const dir = getCacheDir();
    expect(dir).toContain(".air");
    expect(dir).toContain("cache");
    expect(dir).toContain("github");
  });
});

describe("GitHubCatalogProvider", () => {
  it("has scheme 'github'", () => {
    const provider = new GitHubCatalogProvider();
    expect(provider.scheme).toBe("github");
  });

  it("accepts token via constructor options", () => {
    // Just verify construction doesn't throw
    const provider = new GitHubCatalogProvider({ token: "ghp_test123" });
    expect(provider.scheme).toBe("github");
  });

  it("returns helpful error for non-existent repos", async () => {
    const provider = new GitHubCatalogProvider();
    await expect(
      provider.resolve(
        "github://nonexistent-owner-abc123/nonexistent-repo-xyz789/file.json",
        "/tmp"
      )
    ).rejects.toThrow("GitHub API returned 404");
  });

  it("fetches a public file without auth", async () => {
    const provider = new GitHubCatalogProvider();
    const result = await provider.resolve(
      "github://pulsemcp/air/examples/skills/skills.json",
      "/tmp"
    );
    expect(Object.keys(result).length).toBeGreaterThan(0);
    // The example skills.json has known entries
    expect(result["deploy-staging"]).toBeDefined();
  });
});
