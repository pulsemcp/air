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
  loadPreferences,
  savePreferences,
  addDismissed,
  isDismissed,
} from "../src/preferences.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  tempDirs.length = 0;
});

function tempPrefsPath(): string {
  const dir = resolve(
    tmpdir(),
    `air-prefs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return resolve(dir, "preferences.json");
}

describe("loadPreferences", () => {
  it("returns an empty shape when the file does not exist", () => {
    const path = tempPrefsPath();
    const prefs = loadPreferences(path);
    expect(prefs.autoDiscovery?.dismissed).toEqual([]);
    // Should not have created the file just by reading.
    expect(existsSync(path)).toBe(false);
  });

  it("returns an empty shape when the file is malformed JSON", () => {
    const path = tempPrefsPath();
    writeFileSync(path, "{not-json");
    const prefs = loadPreferences(path);
    expect(prefs.autoDiscovery?.dismissed).toEqual([]);
  });

  it("normalizes a partially-populated file", () => {
    const path = tempPrefsPath();
    writeFileSync(path, JSON.stringify({}));
    const prefs = loadPreferences(path);
    expect(prefs.autoDiscovery).toBeDefined();
    expect(prefs.autoDiscovery!.dismissed).toEqual([]);
  });

  it("round-trips dismissed entries", () => {
    const path = tempPrefsPath();
    savePreferences(
      {
        autoDiscovery: {
          dismissed: [
            { repoRoot: "/a", indexPath: "skills/skills.json" },
            { repoRoot: "/b", indexPath: "mcp.json" },
          ],
        },
      },
      path
    );

    const prefs = loadPreferences(path);
    expect(prefs.autoDiscovery!.dismissed).toHaveLength(2);
    expect(prefs.autoDiscovery!.dismissed![0].repoRoot).toBe("/a");
  });
});

describe("savePreferences", () => {
  it("creates parent directories", () => {
    const deep = resolve(tempPrefsPath(), "..", "nested", "deep", "prefs.json");
    savePreferences({ autoDiscovery: { dismissed: [] } }, deep);
    expect(existsSync(deep)).toBe(true);
  });

  it("writes with 2-space indentation", () => {
    const path = tempPrefsPath();
    savePreferences(
      {
        autoDiscovery: {
          dismissed: [{ repoRoot: "/a", indexPath: "skills.json" }],
        },
      },
      path
    );
    const content = readFileSync(path, "utf-8");
    expect(content).toContain('  "autoDiscovery":');
    expect(content).toContain('    "dismissed":');
  });
});

describe("addDismissed", () => {
  it("writes entries to a fresh preferences file", () => {
    const path = tempPrefsPath();
    addDismissed(
      [{ repoRoot: "/abs/path", indexPath: "skills.json" }],
      path
    );
    const prefs = loadPreferences(path);
    expect(prefs.autoDiscovery!.dismissed).toHaveLength(1);
    expect(prefs.autoDiscovery!.dismissed![0].indexPath).toBe("skills.json");
  });

  it("is idempotent — adding the same entry twice does not duplicate it", () => {
    const path = tempPrefsPath();
    addDismissed(
      [{ repoRoot: "/abs/path", indexPath: "skills.json" }],
      path
    );
    addDismissed(
      [{ repoRoot: "/abs/path", indexPath: "skills.json" }],
      path
    );
    const prefs = loadPreferences(path);
    expect(prefs.autoDiscovery!.dismissed).toHaveLength(1);
  });

  it("merges new entries with existing ones", () => {
    const path = tempPrefsPath();
    addDismissed(
      [{ repoRoot: "/a", indexPath: "x.json" }],
      path
    );
    addDismissed(
      [
        { repoRoot: "/a", indexPath: "x.json" }, // dupe
        { repoRoot: "/b", indexPath: "y.json" },
      ],
      path
    );
    const prefs = loadPreferences(path);
    expect(prefs.autoDiscovery!.dismissed).toHaveLength(2);
  });
});

describe("isDismissed", () => {
  it("matches on the (repoRoot, indexPath) key", () => {
    const prefs = {
      autoDiscovery: {
        dismissed: [
          { repoRoot: "/abs", indexPath: "skills.json" },
        ],
      },
    };
    expect(isDismissed(prefs, { repoRoot: "/abs", indexPath: "skills.json" })).toBe(true);
    expect(isDismissed(prefs, { repoRoot: "/abs", indexPath: "mcp.json" })).toBe(false);
    expect(isDismissed(prefs, { repoRoot: "/other", indexPath: "skills.json" })).toBe(false);
  });

  it("returns false when the preferences are empty", () => {
    expect(
      isDismissed(
        { autoDiscovery: { dismissed: [] } },
        { repoRoot: "/a", indexPath: "b.json" }
      )
    ).toBe(false);
    expect(
      isDismissed({}, { repoRoot: "/a", indexPath: "b.json" })
    ).toBe(false);
  });
});
