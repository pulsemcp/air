import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { dirname, resolve } from "path";
import {
  MANIFEST_VERSION,
  buildManifest,
  diffManifest,
  getDefaultAirHome,
  getManifestPath,
  loadManifest,
  writeManifest,
  type Manifest,
} from "../src/manifest.js";

describe("manifest", () => {
  let airHome: string;
  let targetDir: string;
  let originalAirHome: string | undefined;

  beforeEach(() => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    airHome = resolve(tmpdir(), `air-home-${suffix}`);
    targetDir = resolve(tmpdir(), `air-target-${suffix}`);
    mkdirSync(airHome, { recursive: true });
    mkdirSync(targetDir, { recursive: true });
    originalAirHome = process.env.AIR_HOME;
    process.env.AIR_HOME = airHome;
  });

  afterEach(() => {
    if (existsSync(airHome)) rmSync(airHome, { recursive: true, force: true });
    if (existsSync(targetDir)) rmSync(targetDir, { recursive: true, force: true });
    if (originalAirHome === undefined) {
      delete process.env.AIR_HOME;
    } else {
      process.env.AIR_HOME = originalAirHome;
    }
  });

  describe("getDefaultAirHome", () => {
    it("honors AIR_HOME env var when set", () => {
      expect(getDefaultAirHome()).toBe(resolve(airHome));
    });

    it("falls back to ~/.air when AIR_HOME is not set", () => {
      delete process.env.AIR_HOME;
      const original = process.env.HOME;
      process.env.HOME = "/tmp/not-a-real-home";
      try {
        expect(getDefaultAirHome()).toBe("/tmp/not-a-real-home/.air");
      } finally {
        process.env.HOME = original;
      }
    });
  });

  describe("getManifestPath", () => {
    it("produces a stable SHA-256-based filename in the manifests/ subdir", () => {
      const path = getManifestPath(targetDir);
      expect(path.startsWith(resolve(airHome, "manifests") + "/")).toBe(true);
      expect(/[0-9a-f]{64}\.json$/.test(path)).toBe(true);
    });

    it("is deterministic for the same absolute target", () => {
      expect(getManifestPath(targetDir)).toBe(getManifestPath(targetDir));
    });

    it("differs for different target directories", () => {
      const a = getManifestPath(resolve(tmpdir(), "a"));
      const b = getManifestPath(resolve(tmpdir(), "b"));
      expect(a).not.toBe(b);
    });

    it("normalizes target paths so equivalent inputs map to the same manifest", () => {
      const a = getManifestPath(targetDir);
      const b = getManifestPath(targetDir + "/./");
      expect(a).toBe(b);
    });

    it("honors an explicit airHome option over the env var", () => {
      const custom = resolve(tmpdir(), `air-custom-${Date.now()}`);
      const path = getManifestPath(targetDir, { airHome: custom });
      expect(path.startsWith(resolve(custom, "manifests") + "/")).toBe(true);
    });
  });

  describe("loadManifest / writeManifest round-trip", () => {
    it("returns null when no manifest exists", () => {
      expect(loadManifest(targetDir)).toBeNull();
    });

    it("writes and reads back the same content", () => {
      const manifest = buildManifest(targetDir, {
        skills: ["a", "b"],
        hooks: ["c"],
        mcpServers: ["d", "e"],
      });
      const path = writeManifest(manifest);
      expect(existsSync(path)).toBe(true);

      const loaded = loadManifest(targetDir);
      expect(loaded).toEqual(manifest);
    });

    it("creates the manifests/ directory on first write", () => {
      expect(existsSync(resolve(airHome, "manifests"))).toBe(false);
      writeManifest(buildManifest(targetDir, {}));
      expect(existsSync(resolve(airHome, "manifests"))).toBe(true);
    });

    it("returns null for a corrupt manifest file", () => {
      const path = getManifestPath(targetDir);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "{ not valid json");
      expect(loadManifest(targetDir)).toBeNull();
    });

    it("returns null for a manifest with wrong shape (missing fields)", () => {
      const path = getManifestPath(targetDir);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify({ version: 1, target: targetDir }));
      expect(loadManifest(targetDir)).toBeNull();
    });

    it("returns null for a manifest with non-string-array fields", () => {
      const path = getManifestPath(targetDir);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(
        path,
        JSON.stringify({
          version: 1,
          target: targetDir,
          skills: [1, 2, 3],
          hooks: [],
          mcpServers: [],
        })
      );
      expect(loadManifest(targetDir)).toBeNull();
    });

    it("preserves the version field on round-trip", () => {
      const manifest = buildManifest(targetDir, { skills: ["x"] });
      writeManifest(manifest);
      const raw = readFileSync(getManifestPath(targetDir), "utf-8");
      expect(JSON.parse(raw).version).toBe(MANIFEST_VERSION);
    });
  });

  describe("buildManifest", () => {
    it("normalizes undefined selection fields to empty arrays", () => {
      const manifest = buildManifest(targetDir, {});
      expect(manifest.skills).toEqual([]);
      expect(manifest.hooks).toEqual([]);
      expect(manifest.mcpServers).toEqual([]);
    });

    it("stores the resolved absolute target path", () => {
      const manifest = buildManifest(targetDir + "/./", {});
      expect(manifest.target).toBe(resolve(targetDir));
    });

    it("copies the arrays so later mutation of the input doesn't mutate the manifest", () => {
      const skills = ["a"];
      const manifest = buildManifest(targetDir, { skills });
      skills.push("b");
      expect(manifest.skills).toEqual(["a"]);
    });
  });

  describe("diffManifest", () => {
    const prev: Manifest = {
      version: 1,
      target: "/tmp/x",
      skills: ["s1", "s2", "s3"],
      hooks: ["h1", "h2"],
      mcpServers: ["m1", "m2"],
    };

    it("returns all empty when prev is null", () => {
      const diff = diffManifest(null, {
        skills: ["s1"],
        hooks: ["h1"],
        mcpServers: ["m1"],
      });
      expect(diff).toEqual({
        staleSkills: [],
        staleHooks: [],
        staleMcpServers: [],
      });
    });

    it("returns IDs removed from the new selection", () => {
      const diff = diffManifest(prev, {
        skills: ["s1"],
        hooks: [],
        mcpServers: ["m1", "m2", "m3"],
      });
      expect(diff.staleSkills).toEqual(["s2", "s3"]);
      expect(diff.staleHooks).toEqual(["h1", "h2"]);
      expect(diff.staleMcpServers).toEqual([]);
    });

    it("treats undefined new-selection fields as empty (everything stale)", () => {
      const diff = diffManifest(prev, {});
      expect(diff.staleSkills).toEqual(["s1", "s2", "s3"]);
      expect(diff.staleHooks).toEqual(["h1", "h2"]);
      expect(diff.staleMcpServers).toEqual(["m1", "m2"]);
    });

    it("returns empty arrays when selection is a superset", () => {
      const diff = diffManifest(prev, {
        skills: ["s1", "s2", "s3", "s4"],
        hooks: ["h1", "h2"],
        mcpServers: ["m1", "m2", "m3"],
      });
      expect(diff).toEqual({
        staleSkills: [],
        staleHooks: [],
        staleMcpServers: [],
      });
    });
  });
});
