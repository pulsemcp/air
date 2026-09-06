import { existsSync, readFileSync } from "fs";
import { join } from "path";

/**
 * Minimal version helpers shared by the extension install/update/upgrade
 * paths.
 *
 * This is deliberately *not* a semver implementation. AIR ships no runtime
 * dependency for range matching, and the only ranges that matter here are the
 * ones AIR itself writes into `<airJsonDir>/package.json` plus the handful of
 * simple forms users hand-write in `air.json`. Anything outside that set is
 * reported as "undetermined" rather than guessed at — see
 * {@link satisfiesRange}.
 */

/** A parsed `MAJOR.MINOR.PATCH` triple. */
export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Parse a strict `MAJOR.MINOR.PATCH` version string.
 *
 * Returns null for anything else — including pre-release and build-metadata
 * suffixes (`1.2.3-beta.1`), which callers treat as "cannot reason about this".
 */
export function parseVersion(version: string): ParsedVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) return null;
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

/**
 * Compare two semver-ish version strings of the form `MAJOR.MINOR.PATCH`.
 * Returns a negative number if `a < b`, 0 if equal, positive if `a > b`.
 * Pre-release suffixes are ignored — we only need ordering for known package
 * versions like `0.0.13` vs `0.0.21`.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v
      .split("-")[0]
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const av = parse(a);
  const bv = parse(b);
  const len = Math.max(av.length, bv.length);
  for (let i = 0; i < len; i++) {
    const diff = (av[i] ?? 0) - (bv[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Strip a version suffix from an npm specifier for node_modules lookup.
 * E.g., "@scope/pkg@1.2.3" → "@scope/pkg", "pkg@^2.0.0" → "pkg".
 * Bare specifiers without a version are returned unchanged.
 */
export function stripVersion(specifier: string): string {
  // Scoped: @scope/name@version → split on the second @
  if (specifier.startsWith("@")) {
    const slashIdx = specifier.indexOf("/");
    if (slashIdx !== -1) {
      const afterSlash = specifier.slice(slashIdx + 1);
      const atIdx = afterSlash.indexOf("@");
      if (atIdx !== -1) {
        return specifier.slice(0, slashIdx + 1 + atIdx);
      }
    }
    return specifier;
  }
  // Unscoped: name@version → split on first @
  const atIdx = specifier.indexOf("@");
  if (atIdx > 0) {
    return specifier.slice(0, atIdx);
  }
  return specifier;
}

/**
 * Extract the version/range portion of an npm specifier, or null when the
 * specifier names a package without one.
 *
 * "@scope/pkg@^1.2.3" → "^1.2.3", "pkg@latest" → "latest", "pkg" → null.
 */
export function specifierRange(specifier: string): string | null {
  const name = stripVersion(specifier);
  if (name === specifier) return null;
  const range = specifier.slice(name.length + 1);
  return range.length > 0 ? range : null;
}

/**
 * Does `version` satisfy `range`?
 *
 * Returns `null` when the range uses syntax this helper does not model, so
 * callers can fall back to their previous, less-informed behaviour instead of
 * acting on a guess. Supported forms:
 *
 * - `""`, `"*"`, `"x"`, `"latest"` — always satisfied
 * - `"1.2.3"` / `"=1.2.3"` — exact match
 * - `"^1.2.3"` — npm caret semantics, including the 0.x and 0.0.x narrowing
 * - `"~1.2.3"` — patch-level range within the same minor
 *
 * Pre-release versions on either side yield `null`: comparing them correctly
 * needs real semver, and a wrong answer here reinstalls or downgrades a
 * working tree.
 */
export function satisfiesRange(
  version: string,
  range: string
): boolean | null {
  const trimmed = range.trim();
  if (
    trimmed === "" ||
    trimmed === "*" ||
    trimmed === "x" ||
    trimmed === "latest"
  ) {
    return true;
  }

  const parsedVersion = parseVersion(version);
  if (!parsedVersion) return null;

  const operator = trimmed.startsWith("^")
    ? "^"
    : trimmed.startsWith("~")
      ? "~"
      : trimmed.startsWith("=")
        ? "="
        : "";
  const base = parseVersion(operator ? trimmed.slice(operator.length) : trimmed);
  if (!base) return null;

  if (compareVersions(version, `${base.major}.${base.minor}.${base.patch}`) < 0) {
    return false;
  }

  if (operator === "" || operator === "=") {
    return (
      parsedVersion.major === base.major &&
      parsedVersion.minor === base.minor &&
      parsedVersion.patch === base.patch
    );
  }

  if (operator === "~") {
    return (
      parsedVersion.major === base.major && parsedVersion.minor === base.minor
    );
  }

  // Caret: the left-most non-zero element is the one that must not change.
  if (base.major > 0) return parsedVersion.major === base.major;
  if (base.minor > 0) {
    return parsedVersion.major === 0 && parsedVersion.minor === base.minor;
  }
  return (
    parsedVersion.major === 0 &&
    parsedVersion.minor === 0 &&
    parsedVersion.patch === base.patch
  );
}

/**
 * Build the dependency range AIR pins extension packages to for a given CLI
 * version.
 *
 * AIR publishes every package in the monorepo off one shared version line, so
 * an extension is "compatible with this CLI" precisely when it sits on the
 * same `MAJOR.MINOR` line. `~MAJOR.MINOR.0` says exactly that at every major:
 * unlike `^`, it means "any patch within this minor" whether the line is 0.x
 * or 1.x, so the constraint AIR writes today keeps its meaning after 1.0.
 *
 * Returns null when the CLI version is not a plain `MAJOR.MINOR.PATCH` (a
 * pre-release build, say) — callers skip the rewrite rather than invent a
 * range.
 */
export function lockstepRange(cliVersion: string): string | null {
  const parsed = parseVersion(cliVersion);
  if (!parsed) return null;
  return `~${parsed.major}.${parsed.minor}.0`;
}

/**
 * Does every version `range` allows sit on the given `MAJOR.MINOR` line?
 *
 * Used to decide whether an existing constraint already expresses lockstep
 * with the CLI, so `air upgrade` does not rewrite (and reinstall) a manifest
 * that is functionally already correct. `^0.13.1` and `~0.13.0` both pin to
 * the 0.13 line and are accepted; `^1.13.1` spans every 1.x minor and is not.
 *
 * Returns false for any range this helper does not model — the caller's
 * response to false is to rewrite the constraint, which is the safe direction.
 */
export function rangeIsWithinMinorLine(
  range: string,
  major: number,
  minor: number
): boolean {
  const trimmed = range.trim();
  const operator = trimmed.startsWith("^")
    ? "^"
    : trimmed.startsWith("~")
      ? "~"
      : trimmed.startsWith("=")
        ? "="
        : "";
  const base = parseVersion(operator ? trimmed.slice(operator.length) : trimmed);
  if (!base) return false;
  if (base.major !== major || base.minor !== minor) return false;

  // Exact and tilde ranges never leave the minor line they name.
  if (operator !== "^") return true;
  // Caret: the left-most non-zero element is pinned. It stays inside a single
  // minor only when that element is the minor (0.Y.Z) or the patch (0.0.Z).
  return base.major === 0;
}

/**
 * Read the installed version of an npm package from its package.json, looking
 * under `<prefix>/node_modules/<packageName>`. Returns null when the package
 * is absent or its manifest is unreadable.
 */
export function readInstalledVersion(
  packageName: string,
  prefix: string
): string | null {
  try {
    const pkgPath = join(prefix, "node_modules", packageName, "package.json");
    if (!existsSync(pkgPath)) return null;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}
