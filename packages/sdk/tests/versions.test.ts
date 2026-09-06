import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import {
  compareVersions,
  lockstepRange,
  rangeIsWithinMinorLine,
  parseVersion,
  readInstalledVersion,
  satisfiesRange,
  specifierRange,
  stripVersion,
} from "../src/versions.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

function createTemp(): string {
  const dir = resolve(
    tmpdir(),
    `air-sdk-versions-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

describe("parseVersion", () => {
  it("parses a plain MAJOR.MINOR.PATCH", () => {
    expect(parseVersion("0.13.1")).toEqual({ major: 0, minor: 13, patch: 1 });
    expect(parseVersion(" 1.2.3 ")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it("returns null for anything it cannot model exactly", () => {
    expect(parseVersion("1.2")).toBeNull();
    expect(parseVersion("1.2.3-beta.1")).toBeNull();
    expect(parseVersion("^1.2.3")).toBeNull();
    expect(parseVersion("latest")).toBeNull();
  });
});

describe("compareVersions", () => {
  it("orders versions numerically, not lexically", () => {
    expect(compareVersions("0.0.9", "0.0.25")).toBeLessThan(0);
    expect(compareVersions("0.13.1", "0.4.1")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });
});

describe("stripVersion / specifierRange", () => {
  it("splits scoped specifiers on the second @", () => {
    expect(stripVersion("@pulsemcp/air-cli@^0.13.0")).toBe(
      "@pulsemcp/air-cli"
    );
    expect(specifierRange("@pulsemcp/air-cli@^0.13.0")).toBe("^0.13.0");
  });

  it("splits unscoped specifiers on the first @", () => {
    expect(stripVersion("vitest@2.1.0")).toBe("vitest");
    expect(specifierRange("vitest@2.1.0")).toBe("2.1.0");
  });

  it("returns a null range for bare package names", () => {
    expect(stripVersion("@pulsemcp/air-cli")).toBe("@pulsemcp/air-cli");
    expect(specifierRange("@pulsemcp/air-cli")).toBeNull();
    expect(specifierRange("vitest")).toBeNull();
  });
});

describe("satisfiesRange", () => {
  it("treats wildcard-ish ranges as always satisfied", () => {
    for (const range of ["", "*", "x", "latest"]) {
      expect(satisfiesRange("0.0.25", range)).toBe(true);
    }
  });

  it("matches exact ranges", () => {
    expect(satisfiesRange("0.13.1", "0.13.1")).toBe(true);
    expect(satisfiesRange("0.13.1", "=0.13.1")).toBe(true);
    expect(satisfiesRange("0.13.1", "0.13.0")).toBe(false);
  });

  it("applies tilde as patch-level within the same minor", () => {
    expect(satisfiesRange("0.13.0", "~0.13.0")).toBe(true);
    expect(satisfiesRange("0.13.9", "~0.13.0")).toBe(true);
    expect(satisfiesRange("0.14.0", "~0.13.0")).toBe(false);
    expect(satisfiesRange("0.12.9", "~0.13.0")).toBe(false);
    // Same meaning above 1.0, which `^` would not give us.
    expect(satisfiesRange("1.13.9", "~1.13.0")).toBe(true);
    expect(satisfiesRange("1.14.0", "~1.13.0")).toBe(false);
  });

  it("applies npm caret semantics, including the 0.x narrowing", () => {
    expect(satisfiesRange("1.9.0", "^1.2.3")).toBe(true);
    expect(satisfiesRange("2.0.0", "^1.2.3")).toBe(false);
    expect(satisfiesRange("0.13.9", "^0.13.1")).toBe(true);
    expect(satisfiesRange("0.14.0", "^0.13.1")).toBe(false);
    expect(satisfiesRange("0.0.25", "^0.0.25")).toBe(true);
    expect(satisfiesRange("0.0.26", "^0.0.25")).toBe(false);
  });

  it("reports the stale-tree case from issue #131 as unsatisfied", () => {
    expect(satisfiesRange("0.0.25", "~0.13.0")).toBe(false);
  });

  it("returns null rather than guessing at ranges it does not model", () => {
    expect(satisfiesRange("1.2.3", ">=1.0.0 <2.0.0")).toBeNull();
    expect(satisfiesRange("1.2.3", "1.x")).toBeNull();
    expect(satisfiesRange("1.2.3", "next")).toBeNull();
    // Pre-releases on either side need real semver to compare correctly.
    expect(satisfiesRange("1.2.3-beta.1", "~1.2.0")).toBeNull();
    expect(satisfiesRange("1.2.3", "~1.2.0-beta.1")).toBeNull();
  });
});

describe("lockstepRange", () => {
  it("pins to the CLI's minor line", () => {
    expect(lockstepRange("0.13.1")).toBe("~0.13.0");
    expect(lockstepRange("1.4.7")).toBe("~1.4.0");
  });

  it("returns null for a version it cannot parse", () => {
    expect(lockstepRange("0.13.1-rc.1")).toBeNull();
    expect(lockstepRange("unknown")).toBeNull();
  });

  it("produces a range the CLI's own version satisfies", () => {
    const range = lockstepRange("0.13.1")!;
    expect(satisfiesRange("0.13.1", range)).toBe(true);
  });
});

describe("rangeIsWithinMinorLine", () => {
  it("accepts ranges confined to the named minor", () => {
    expect(rangeIsWithinMinorLine("~0.13.0", 0, 13)).toBe(true);
    expect(rangeIsWithinMinorLine("0.13.1", 0, 13)).toBe(true);
    expect(rangeIsWithinMinorLine("=0.13.1", 0, 13)).toBe(true);
    // What npm leaves behind when it saves a 0.x dependency itself.
    expect(rangeIsWithinMinorLine("^0.13.1", 0, 13)).toBe(true);
    expect(rangeIsWithinMinorLine("~1.13.0", 1, 13)).toBe(true);
  });

  it("rejects ranges that span past the named minor", () => {
    // Above 1.0 a caret spans every minor of the major.
    expect(rangeIsWithinMinorLine("^1.13.1", 1, 13)).toBe(false);
    expect(rangeIsWithinMinorLine("~0.12.0", 0, 13)).toBe(false);
    expect(rangeIsWithinMinorLine("^0.0.25", 0, 13)).toBe(false);
  });

  it("rejects ranges it cannot model", () => {
    expect(rangeIsWithinMinorLine(">=0.13.0 <0.14.0", 0, 13)).toBe(false);
    expect(rangeIsWithinMinorLine("latest", 0, 13)).toBe(false);
    expect(rangeIsWithinMinorLine("*", 0, 13)).toBe(false);
  });

  it("accepts the range lockstepRange builds for the CLI's own version", () => {
    expect(rangeIsWithinMinorLine(lockstepRange("0.13.1")!, 0, 13)).toBe(true);
    expect(rangeIsWithinMinorLine(lockstepRange("1.4.7")!, 1, 4)).toBe(true);
  });
});

describe("readInstalledVersion", () => {
  it("reads the version from node_modules", () => {
    const prefix = createTemp();
    const dir = join(prefix, "node_modules", "@pulsemcp", "air-provider-github");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "@pulsemcp/air-provider-github", version: "0.0.25" })
    );

    expect(
      readInstalledVersion("@pulsemcp/air-provider-github", prefix)
    ).toBe("0.0.25");
  });

  it("returns null when absent or unreadable", () => {
    const prefix = createTemp();
    expect(readInstalledVersion("@pulsemcp/air-missing", prefix)).toBeNull();

    const dir = join(prefix, "node_modules", "broken");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), "{ not json");
    expect(readInstalledVersion("broken", prefix)).toBeNull();
  });
});
