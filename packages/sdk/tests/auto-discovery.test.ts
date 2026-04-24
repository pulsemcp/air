import { describe, it, expect, afterEach } from "vitest";
import { execSync } from "child_process";
import { resolve, dirname } from "path";
import {
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { findOfferableIndexes, acceptOffers } from "../src/auto-discovery.js";

const tempDirs: string[] = [];

afterEach(() => {
  delete process.env.AIR_CONFIG;
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
    `air-offer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function initGitRepo(dir: string): void {
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

describe("findOfferableIndexes / acceptOffers — AIR_CONFIG plumbing", () => {
  it("resolves the target path from an explicit configPath option", () => {
    const repo = makeTempDir();
    initGitRepo(repo);
    writeJson(resolve(repo, "skills.json"), {
      foo: { description: "foo", path: "skills/foo" },
    });

    const customDir = makeTempDir();
    const customConfig = resolve(customDir, "custom-air.json");

    const offers = findOfferableIndexes({
      cwd: repo,
      configPath: customConfig,
    });
    expect(offers.resolvedConfigPath).toBe(customConfig);
    expect(offers.hasOffers).toBe(true);

    const result = acceptOffers(offers);
    expect(result.airJsonPath).toBe(customConfig);
    expect(result.createdScaffold).toBe(true);
    expect(existsSync(customConfig)).toBe(true);

    const written = JSON.parse(readFileSync(customConfig, "utf-8"));
    // The air.json lives in a sibling dir to the repo, so the relative path
    // steps up and over — this is the correct toAirJsonRelPath output.
    expect(written.skills).toHaveLength(1);
    expect(resolve(customDir, written.skills[0])).toBe(
      resolve(repo, "skills.json")
    );
  });

  it("honors AIR_CONFIG even when the target file doesn't exist yet (scaffold case)", () => {
    // This is the regression case: previously `getAirJsonPath()` returned null
    // for missing files, and `addDiscoveredToAirJson` fell back to
    // ~/.air/air.json — silently ignoring AIR_CONFIG on the scaffold path.
    const repo = makeTempDir();
    initGitRepo(repo);
    writeJson(resolve(repo, "skills.json"), {
      foo: { description: "foo", path: "skills/foo" },
    });

    const customDir = makeTempDir();
    const customConfig = resolve(customDir, "via-env.json");
    process.env.AIR_CONFIG = customConfig;

    // No explicit configPath — mimic the CLI's `air start` which doesn't
    // expose --config and leans entirely on AIR_CONFIG.
    const offers = findOfferableIndexes({ cwd: repo });
    expect(offers.resolvedConfigPath).toBe(customConfig);

    const result = acceptOffers(offers);
    expect(result.airJsonPath).toBe(customConfig);
    expect(existsSync(customConfig)).toBe(true);
    // And critically: nothing was written to the user's default location.
    // We can't safely touch ~/.air here, but we can at least confirm the
    // returned path is not the default.
    expect(result.airJsonPath).not.toContain(".air/air.json");
  });

  it("honors AIR_CONFIG when the target file already exists (dedup path)", () => {
    const repo = makeTempDir();
    initGitRepo(repo);
    writeJson(resolve(repo, "skills.json"), {
      foo: { description: "foo", path: "skills/foo" },
    });

    const customDir = makeTempDir();
    const customConfig = resolve(customDir, "existing.json");
    // Pre-register skills.json so it should NOT be offered.
    writeJson(customConfig, {
      name: "test",
      skills: [resolve(repo, "skills.json")],
    });
    process.env.AIR_CONFIG = customConfig;

    const offers = findOfferableIndexes({ cwd: repo });
    expect(offers.resolvedConfigPath).toBe(customConfig);
    expect(offers.hasOffers).toBe(false);
  });
});
