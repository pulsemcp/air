import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "fs";
import { join, sep } from "path";
import type { Manifest, ResolvedArtifacts, SkillEntry } from "@pulsemcp/air-core";
import {
  isQualified,
  manifestSkillsAreAirOwned,
  parseQualifiedId,
} from "@pulsemcp/air-core";

/**
 * The previous manifest's skill entries, split into the ones this run may
 * treat as AIR's own — keep them, or delete them once deselected — and the
 * ones AIR gives up on.
 */
export interface PreviousSkillOwnership {
  owned: Set<string>;
  /** Entries AIR no longer claims. Their directories are left in place. */
  relinquished: string[];
}

/**
 * Decide which of `prevManifest`'s skill entries under `skillsDir` are AIR's.
 *
 * A version 2+ manifest only ever lists directories AIR created, so every
 * entry is owned. A version 1 manifest may also list a directory that already
 * existed when AIR reached it — usually a skill the user wrote (#168) — so an
 * entry whose directory still exists stays owned only when its files are
 * exactly what AIR installs for a catalog skill with that shortname. The rest
 * are relinquished: never deleted, and left out of the next manifest.
 */
export function previousSkillOwnership(
  prevManifest: Manifest | null,
  skillsDir: string,
  artifacts: ResolvedArtifacts
): PreviousSkillOwnership {
  if (!prevManifest) return { owned: new Set(), relinquished: [] };
  if (manifestSkillsAreAirOwned(prevManifest)) {
    return { owned: new Set(prevManifest.skills), relinquished: [] };
  }

  const owned = new Set<string>();
  const relinquished: string[] = [];
  for (const id of prevManifest.skills) {
    const dir = join(skillsDir, id);
    if (!existsSync(dir) || matchesCatalogSkill(dir, id, artifacts)) {
      owned.add(id);
    } else {
      relinquished.push(id);
    }
  }
  return { owned, relinquished };
}

export function relinquishedSkillMessage(displayPath: string): string {
  return (
    `AIR is leaving ${displayPath} in place and no longer manages it. An ` +
    `earlier AIR version recorded it as installed by AIR, but AIR can't ` +
    `confirm it wrote those files (they don't match what it installs for ` +
    `any catalog skill of that name), so it may be a skill you wrote ` +
    `(https://github.com/pulsemcp/air/issues/168). Delete it by hand if you ` +
    `don't need it.`
  );
}

/**
 * Whether `skillDir` holds exactly what `prepareSession` writes for some
 * catalog skill whose shortname is `short`: the skill's source directory
 * plus its references under `references/`, byte for byte, and nothing else.
 * Mirrors the adapter's `copyDirRecursive` + `copyReferences`. Anything that
 * can't be read counts as a mismatch.
 *
 * A catalog skill whose source or references live inside `skillDir` (or
 * contain it) is skipped: it would match itself, and `skillDir` is then the
 * user's source, never AIR's copy.
 */
function matchesCatalogSkill(
  skillDir: string,
  short: string,
  artifacts: ResolvedArtifacts
): boolean {
  for (const [qualified, skill] of Object.entries(artifacts.skills)) {
    if (!isQualified(qualified) || parseQualifiedId(qualified).id !== short) {
      continue;
    }
    try {
      const target = realpathSync(skillDir);
      const sources = [
        skill.path,
        ...(skill.references ?? []).flatMap((id) => {
          const ref = artifacts.references[id];
          return ref && existsSync(ref.path) ? [ref.path] : [];
        }),
      ];
      if (sources.some((src) => overlaps(realpathSync(src), target))) continue;
      if (sameFiles(skillDir, installedFiles(skill, skillDir, artifacts))) {
        return true;
      }
    } catch {
      // Unreadable source or target: can't show AIR wrote it.
    }
  }
  return false;
}

function overlaps(a: string, b: string): boolean {
  return a === b || a.startsWith(b + sep) || b.startsWith(a + sep);
}

/** Target path → source path for every file AIR writes into `skillDir`. */
function installedFiles(
  skill: SkillEntry,
  skillDir: string,
  artifacts: ResolvedArtifacts
): Map<string, string> {
  const files = new Map<string, string>();
  if (!existsSync(skill.path)) return files;
  collectSourceFiles(skill.path, skillDir, files);
  for (const refId of skill.references ?? []) {
    const ref = artifacts.references[refId];
    if (!ref || !existsSync(ref.path)) continue;
    const name = ref.path.split("/").pop() || ref.path;
    files.set(join(skillDir, "references", name), ref.path);
  }
  return files;
}

function collectSourceFiles(
  src: string,
  dest: string,
  files: Map<string, string>
): void {
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      collectSourceFiles(srcPath, destPath, files);
    } else {
      files.set(destPath, srcPath);
    }
  }
}

function sameFiles(skillDir: string, expected: Map<string, string>): boolean {
  if (expected.size === 0) return false;
  if (!lstatSync(skillDir).isDirectory()) return false;
  const actual: string[] = [];
  if (!collectTargetFiles(skillDir, actual)) return false;
  if (actual.length !== expected.size) return false;
  for (const path of actual) {
    const source = expected.get(path);
    if (source === undefined) return false;
    if (!readFileSync(path).equals(readFileSync(source))) return false;
  }
  return true;
}

/**
 * Collect every regular file under `dir`. Returns false on anything AIR never
 * writes (symlinks, sockets, …), which rules the directory out.
 */
function collectTargetFiles(dir: string, files: string[]): boolean {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = lstatSync(path);
    if (stat.isDirectory()) {
      if (!collectTargetFiles(path, files)) return false;
    } else if (stat.isFile()) {
      files.push(path);
    } else {
      return false;
    }
  }
  return true;
}

/**
 * Warning for `cleanSession`, which has no catalog to check a version 1
 * manifest's skill entries against and so leaves them in place.
 */
export function unverifiedSkillsMessage(displayPaths: string[]): string {
  return (
    `AIR left ${displayPaths.join(", ")} in place. A manifest written by an ` +
    `earlier AIR version lists ${displayPaths.length === 1 ? "it" : "them"}, ` +
    `but that version could also record a skill you wrote as installed by ` +
    `AIR (https://github.com/pulsemcp/air/issues/168), and there is no ` +
    `catalog here to tell them apart. Run \`air prepare\` or \`air start\` ` +
    `in this directory once so AIR can check, then clean again — or delete ` +
    `what you don't need by hand.`
  );
}
