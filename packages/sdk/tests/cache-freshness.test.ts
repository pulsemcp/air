import { describe, it, expect } from "vitest";
import { checkProviderFreshness } from "../src/cache-freshness.js";
import type { AirConfig, CatalogProvider, CacheFreshnessWarning } from "@pulsemcp/air-core";

describe("checkProviderFreshness", () => {
  it("returns empty array when no providers have checkFreshness", async () => {
    const config: AirConfig = {
      name: "test",
      skills: ["github://acme/repo/skills.json"],
    };
    const provider: CatalogProvider = {
      scheme: "github",
      resolve: async () => ({}),
    };

    const warnings = await checkProviderFreshness(config, [provider]);
    expect(warnings).toEqual([]);
  });

  it("returns empty array when no URIs match any provider", async () => {
    const config: AirConfig = {
      name: "test",
      skills: ["./local/skills.json"],
    };
    const provider: CatalogProvider = {
      scheme: "github",
      resolve: async () => ({}),
      checkFreshness: async () => [],
    };

    const warnings = await checkProviderFreshness(config, [provider]);
    expect(warnings).toEqual([]);
  });

  it("collects warnings from providers", async () => {
    const config: AirConfig = {
      name: "test",
      skills: ["github://acme/repo@main/skills.json"],
      mcp: ["github://acme/repo@main/mcp.json"],
    };
    const provider: CatalogProvider = {
      scheme: "github",
      resolve: async () => ({}),
      checkFreshness: async (uris: string[]): Promise<CacheFreshnessWarning[]> => {
        return uris.map((uri) => ({
          uri,
          message: `${uri} is stale`,
        }));
      },
    };

    const warnings = await checkProviderFreshness(config, [provider]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("is stale");
  });

  it("skips file:// URIs", async () => {
    const config: AirConfig = {
      name: "test",
      skills: ["file:///absolute/path/skills.json"],
    };
    const provider: CatalogProvider = {
      scheme: "file",
      resolve: async () => ({}),
      checkFreshness: async () => [{ uri: "x", message: "should not be called" }],
    };

    const warnings = await checkProviderFreshness(config, [provider]);
    expect(warnings).toEqual([]);
  });

  it("handles checkFreshness errors gracefully", async () => {
    const config: AirConfig = {
      name: "test",
      skills: ["github://acme/repo/skills.json"],
    };
    const provider: CatalogProvider = {
      scheme: "github",
      resolve: async () => ({}),
      checkFreshness: async () => {
        throw new Error("network failure");
      },
    };

    const warnings = await checkProviderFreshness(config, [provider]);
    expect(warnings).toEqual([]);
  });

  it("routes URIs to the correct provider by scheme", async () => {
    const config: AirConfig = {
      name: "test",
      skills: ["github://acme/repo/skills.json"],
      mcp: ["s3://bucket/mcp.json"],
    };

    const githubUris: string[] = [];
    const s3Uris: string[] = [];

    const githubProvider: CatalogProvider = {
      scheme: "github",
      resolve: async () => ({}),
      checkFreshness: async (uris) => {
        githubUris.push(...uris);
        return [];
      },
    };

    const s3Provider: CatalogProvider = {
      scheme: "s3",
      resolve: async () => ({}),
      checkFreshness: async (uris) => {
        s3Uris.push(...uris);
        return [];
      },
    };

    await checkProviderFreshness(config, [githubProvider, s3Provider]);

    expect(githubUris).toEqual(["github://acme/repo/skills.json"]);
    expect(s3Uris).toEqual(["s3://bucket/mcp.json"]);
  });
});
