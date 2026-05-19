import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { resolve, dirname, join } from "path";
import { detectSchemaFromValue, detectSchemaType } from "@pulsemcp/air-core";

const REPO_ROOT = resolve(__dirname, "../..");
const EXAMPLES_DIR = resolve(REPO_ROOT, "examples");

/**
 * Index files that declare per-entry `path` values. `mcp.json`, `plugins.json`,
 * and `roots.json` describe artifacts whose payload is fully captured by the
 * JSON entry itself (no on-disk source), so they have no `path` to verify.
 */
const PATHED_TYPES = new Set(["skills", "references", "hooks"]);

interface PathedEntry {
  indexFile: string;
  indexDir: string;
  artifactType: string;
  shortname: string;
  declaredPath: string;
  resolvedPath: string;
}

function walkJsonFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkJsonFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      out.push(full);
    }
  }
  return out;
}

function detectIndexType(file: string): string | null {
  const data = JSON.parse(readFileSync(file, "utf-8"));
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return null;
  }
  const obj = data as Record<string, unknown>;
  if (typeof obj.$schema === "string") {
    const t = detectSchemaFromValue(obj.$schema);
    if (t) return t;
  }
  const byName = detectSchemaType(file.split("/").pop() ?? "");
  return byName;
}

function collectPathedEntries(): PathedEntry[] {
  const out: PathedEntry[] = [];
  for (const indexFile of walkJsonFiles(EXAMPLES_DIR)) {
    const type = detectIndexType(indexFile);
    if (!type || !PATHED_TYPES.has(type)) continue;
    const raw = JSON.parse(readFileSync(indexFile, "utf-8"));
    if (typeof raw !== "object" || raw === null) continue;
    const indexDir = dirname(indexFile);
    for (const [shortname, entry] of Object.entries(raw)) {
      if (shortname.startsWith("$")) continue;
      if (typeof entry !== "object" || entry === null) continue;
      const e = entry as Record<string, unknown>;
      if (typeof e.path !== "string") continue;
      out.push({
        indexFile,
        indexDir,
        artifactType: type,
        shortname,
        declaredPath: e.path,
        resolvedPath: resolve(indexDir, e.path),
      });
    }
  }
  return out;
}

describe("examples/ artifact paths", () => {
  it("every pathed entry resolves to an existing file or directory", () => {
    const entries = collectPathedEntries();
    // Sanity floor so the test cannot silently no-op if walkJsonFiles or
    // detectIndexType regresses and stops finding the example indexes.
    expect(
      entries.length,
      "expected to find at least one pathed entry under examples/"
    ).toBeGreaterThanOrEqual(3);

    const broken: string[] = [];
    for (const entry of entries) {
      if (!existsSync(entry.resolvedPath)) {
        broken.push(
          `${entry.artifactType} "${entry.shortname}" in ${entry.indexFile}: ` +
            `path "${entry.declaredPath}" → ${entry.resolvedPath} (missing)`
        );
        continue;
      }
      const stat = statSync(entry.resolvedPath);
      const expectedDir = entry.artifactType === "skills" || entry.artifactType === "hooks";
      if (expectedDir && !stat.isDirectory()) {
        broken.push(
          `${entry.artifactType} "${entry.shortname}" in ${entry.indexFile}: ` +
            `path "${entry.declaredPath}" → ${entry.resolvedPath} (expected directory, got file)`
        );
      }
    }

    expect(
      broken,
      `Broken example artifact paths:\n  - ${broken.join("\n  - ")}`
    ).toEqual([]);
  });
});
