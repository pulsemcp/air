import { describe, it, expect, afterEach } from "vitest";
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
  addDiscoveredToAirJson,
  buildRegisteredChecker,
} from "../src/edit-air-json.js";
import type {
  DiscoveredCatalog,
  DiscoveredLooseIndex,
  DiscoveredAirJson,
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
    `air-edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function makeCatalog(absPath: string, relPath: string): DiscoveredCatalog {
  return {
    path: absPath,
    relPath,
    types: ["skills"],
    entryCounts: { skills: 2 },
  };
}

function makeLoose(
  absPath: string,
  relPath: string,
  type: "skills" | "mcp" = "skills"
): DiscoveredLooseIndex {
  return { path: absPath, relPath, type, entryCount: 1 };
}

function makeAirJson(absPath: string, relPath: string): DiscoveredAirJson {
  return { path: absPath, relPath };
}

describe("addDiscoveredToAirJson — scaffolding", () => {
  it("creates a scaffold when air.json does not exist", () => {
    const dir = makeTempDir();
    const airJsonPath = resolve(dir, "air.json");
    expect(existsSync(airJsonPath)).toBe(false);

    const result = addDiscoveredToAirJson(
      { catalogs: [makeCatalog(resolve(dir, "catalog"), "catalog")] },
      { path: airJsonPath }
    );
    expect(result.createdScaffold).toBe(true);
    expect(existsSync(airJsonPath)).toBe(true);

    const data = JSON.parse(readFileSync(airJsonPath, "utf-8"));
    expect(data.name).toBe("my-config");
    expect(data.catalogs).toEqual(["./catalog"]);
    expect(data.$schema).toContain("air.schema.json");
  });

  it("writes the scaffold even if there are no added entries", () => {
    const dir = makeTempDir();
    const airJsonPath = resolve(dir, "air.json");
    const result = addDiscoveredToAirJson({}, { path: airJsonPath });
    expect(result.createdScaffold).toBe(true);
    expect(result.added).toHaveLength(0);
    expect(existsSync(airJsonPath)).toBe(true);
  });
});

describe("addDiscoveredToAirJson — catalog preference", () => {
  it("adds catalogs to catalogs[] (single entry, not six)", () => {
    const dir = makeTempDir();
    const airJsonPath = resolve(dir, "air.json");
    writeFileSync(
      airJsonPath,
      JSON.stringify({ name: "test", skills: [] })
    );

    const result = addDiscoveredToAirJson(
      {
        catalogs: [
          {
            path: resolve(dir, "team"),
            relPath: "team",
            types: ["skills", "mcp", "hooks"],
            entryCounts: { skills: 1, mcp: 1, hooks: 1 },
          },
        ],
      },
      { path: airJsonPath }
    );

    expect(result.added).toHaveLength(1);
    expect(result.added[0].kind).toBe("catalog");
    const data = JSON.parse(readFileSync(airJsonPath, "utf-8"));
    expect(data.catalogs).toEqual(["./team"]);
    // Per-type arrays untouched
    expect(data.skills).toEqual([]);
    expect(data.mcp).toBeUndefined();
  });

  it("adds loose indexes to the matching per-type array", () => {
    const dir = makeTempDir();
    const airJsonPath = resolve(dir, "air.json");
    writeFileSync(airJsonPath, JSON.stringify({ name: "test" }));

    addDiscoveredToAirJson(
      {
        looseIndexes: [
          makeLoose(resolve(dir, "skills.json"), "skills.json", "skills"),
          makeLoose(resolve(dir, "servers.mcp.json"), "servers.mcp.json", "mcp"),
        ],
      },
      { path: airJsonPath }
    );

    const data = JSON.parse(readFileSync(airJsonPath, "utf-8"));
    expect(data.skills).toEqual(["./skills.json"]);
    expect(data.mcp).toEqual(["./servers.mcp.json"]);
  });

  it("routes nested air.json entries to catalogs[] (using the parent directory)", () => {
    const dir = makeTempDir();
    const airJsonPath = resolve(dir, "air.json");
    writeFileSync(airJsonPath, JSON.stringify({ name: "test" }));

    addDiscoveredToAirJson(
      {
        airJsons: [
          makeAirJson(resolve(dir, "team/air.json"), "team/air.json"),
        ],
      },
      { path: airJsonPath }
    );

    const data = JSON.parse(readFileSync(airJsonPath, "utf-8"));
    expect(data.catalogs).toEqual(["./team"]);
  });
});

describe("addDiscoveredToAirJson — idempotency", () => {
  it("skips a catalog that is already listed in catalogs[]", () => {
    const dir = makeTempDir();
    const airJsonPath = resolve(dir, "air.json");
    writeFileSync(
      airJsonPath,
      JSON.stringify({ name: "test", catalogs: ["./team"] })
    );

    const result = addDiscoveredToAirJson(
      {
        catalogs: [
          {
            path: resolve(dir, "team"),
            relPath: "team",
            types: ["skills"],
            entryCounts: { skills: 1 },
          },
        ],
      },
      { path: airJsonPath }
    );
    expect(result.added).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);

    const data = JSON.parse(readFileSync(airJsonPath, "utf-8"));
    expect(data.catalogs).toEqual(["./team"]);
  });

  it("skips a loose index already present as an absolute path", () => {
    const dir = makeTempDir();
    const airJsonPath = resolve(dir, "air.json");
    const absTarget = resolve(dir, "skills.json");
    writeFileSync(
      airJsonPath,
      JSON.stringify({
        name: "test",
        skills: [absTarget],
      })
    );

    const result = addDiscoveredToAirJson(
      {
        looseIndexes: [makeLoose(absTarget, "skills.json", "skills")],
      },
      { path: airJsonPath }
    );
    expect(result.added).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
  });

  it("normalizes ./foo vs ../foo vs absolute when matching", () => {
    const dir = makeTempDir();
    const airJsonPath = resolve(dir, "air.json");
    writeFileSync(
      airJsonPath,
      JSON.stringify({
        name: "test",
        skills: ["./skills.json"],
      })
    );

    const abs = resolve(dir, "skills.json");
    const result = addDiscoveredToAirJson(
      {
        looseIndexes: [makeLoose(abs, "skills.json", "skills")],
      },
      { path: airJsonPath }
    );
    expect(result.skipped).toHaveLength(1);
  });
});

describe("buildRegisteredChecker", () => {
  it("identifies catalogs and loose entries already in air.json", () => {
    const dir = makeTempDir();
    const airJsonPath = resolve(dir, "air.json");
    writeFileSync(
      airJsonPath,
      JSON.stringify({
        name: "test",
        catalogs: ["./team"],
        skills: ["./skills.json"],
      })
    );

    const checker = buildRegisteredChecker(airJsonPath);
    expect(checker.catalog(resolve(dir, "team"))).toBe(true);
    expect(checker.catalog(resolve(dir, "other"))).toBe(false);
    expect(checker.loose("skills", resolve(dir, "skills.json"))).toBe(true);
    expect(checker.loose("skills", resolve(dir, "other.json"))).toBe(false);
  });

  it("only dedupes exact matches — catalog expansion is handled upstream", () => {
    const dir = makeTempDir();
    const airJsonPath = resolve(dir, "air.json");
    writeFileSync(
      airJsonPath,
      JSON.stringify({
        name: "test",
        catalogs: ["./team"],
      })
    );

    const checker = buildRegisteredChecker(airJsonPath);
    // buildRegisteredChecker is intentionally conservative: it only returns
    // true for exact matches against the arrays in air.json. It does NOT
    // expand catalog entries into their implied per-type paths — that's
    // `discoverIndexes` / upstream filtering's job (and in practice, the
    // scanner never surfaces a loose index whose directory is a detected
    // catalog, so this case is unreachable via the discovery pipeline).
    expect(
      checker.loose("skills", resolve(dir, "team/skills/skills.json"))
    ).toBe(false);
    // Unrelated paths must not false-positive.
    expect(checker.loose("skills", resolve(dir, "elsewhere.json"))).toBe(false);
  });

  it("returns a no-op checker when air.json is missing", () => {
    const checker = buildRegisteredChecker(null);
    expect(checker.catalog("/anything")).toBe(false);
    expect(checker.loose("skills", "/anything")).toBe(false);
    expect(checker.airJson("/anything")).toBe(false);
  });
});
