/**
 * Scoped artifact identity for AIR.
 *
 * Every artifact (skill, MCP server, root, reference, hook, plugin) is
 * canonically addressed by a qualified ID of the form `@scope/id`. The scope
 * identifies the catalog the artifact comes from. Two artifacts may share a
 * shortname only when their scopes differ; collisions on the qualified form
 * are rejected at composition time.
 *
 * Scope sources:
 *   - `local` — every entry not contributed by a catalog provider (per-type
 *     arrays in air.json, files within local catalog directories)
 *   - provider-supplied scope — catalog providers implement `getScope(uri)` to
 *     expose a stable, human-meaningful scope. The GitHub provider returns
 *     `owner/repo` so a catalog at `github://acme/skills@v1` contributes
 *     `@acme/skills/<id>`.
 */

import type { CatalogProvider } from "./types.js";

/** Scope assigned to artifacts that are not contributed by any catalog provider. */
export const LOCAL_SCOPE = "local";

/**
 * A qualified ID — the canonical key used in `ResolvedArtifacts`.
 * Format: `@scope/id`. Scope may itself contain a `/` (e.g. `acme/skills`).
 */
export type QualifiedId = string;

/**
 * Validate that a scope string is acceptable for use in a qualified ID.
 * Scopes may contain alphanumeric characters, `-`, `_`, `.`, and `/`. This
 * matches the universe produced by the GitHub provider (`owner/repo`) and
 * the literal `local`.
 */
export function validateScope(scope: string): void {
  if (!scope || scope.length === 0) {
    throw new Error("Scope must be non-empty.");
  }
  if (!/^[a-zA-Z0-9._\-/]+$/.test(scope)) {
    throw new Error(
      `Invalid scope "${scope}". Scopes may contain alphanumerics, ` +
        `'-', '_', '.', and '/' only.`
    );
  }
  if (scope.startsWith("/") || scope.endsWith("/")) {
    throw new Error(
      `Invalid scope "${scope}". Scopes may not start or end with '/'.`
    );
  }
}

/**
 * Quick check whether a string looks like a qualified ID — i.e., starts with
 * `@`. The remaining structure is not validated here; use `parseQualifiedId`
 * if you need component-level validation.
 */
export function isQualified(id: string): boolean {
  return id.startsWith("@");
}

/**
 * Combine a scope and a shortname into a qualified ID (`@scope/id`).
 * Throws if the shortname is empty or already qualified.
 */
export function qualifyId(scope: string, id: string): QualifiedId {
  if (isQualified(id)) {
    throw new Error(
      `Cannot qualify an already-qualified ID: "${id}". ` +
        `Pass the bare shortname (without "@scope/").`
    );
  }
  if (!id || id.length === 0) {
    throw new Error("Cannot qualify an empty ID.");
  }
  validateScope(scope);
  return `@${scope}/${id}`;
}

/**
 * Parse a qualified ID (`@scope/id`) into its components. Throws for inputs
 * that do not start with `@` or are otherwise structurally invalid.
 */
export function parseQualifiedId(qualified: string): {
  scope: string;
  id: string;
} {
  if (!isQualified(qualified)) {
    throw new Error(
      `Not a qualified ID: "${qualified}". Expected format: @scope/id`
    );
  }
  const lastSlash = qualified.lastIndexOf("/");
  if (lastSlash <= 1) {
    // `@x` or `@/x` — no scope or empty scope
    throw new Error(
      `Malformed qualified ID: "${qualified}". Expected format: @scope/id`
    );
  }
  const scope = qualified.slice(1, lastSlash);
  const id = qualified.slice(lastSlash + 1);
  if (!scope || !id) {
    throw new Error(
      `Malformed qualified ID: "${qualified}". Expected format: @scope/id`
    );
  }
  return { scope, id };
}

/**
 * Derive the scope for a catalog entry. URIs are routed through the matching
 * provider's `getScope(uri)`; providers without `getScope` (or local paths
 * with no scheme) fall back to `LOCAL_SCOPE`.
 */
export function deriveScope(
  catalog: string,
  providers: CatalogProvider[]
): string {
  const match = catalog.match(/^([a-zA-Z][a-zA-Z0-9+\-.]*):\/\//);
  if (!match) return LOCAL_SCOPE;
  const scheme = match[1].toLowerCase();
  if (scheme === "file") return LOCAL_SCOPE;

  const provider = providers.find((p) => p.scheme === scheme);
  if (!provider || !provider.getScope) return LOCAL_SCOPE;

  const scope = provider.getScope(catalog);
  validateScope(scope);
  return scope;
}

/**
 * Build a shortname → qualified-ID map for resolving short-form references.
 * The returned map flags ambiguous shortnames by storing `null` instead of a
 * qualified ID; callers must report a clear error when an ambiguous reference
 * is dereferenced without a qualifier.
 */
export function buildShortnameIndex<T>(
  artifacts: Record<string, T>
): Map<string, QualifiedId | null> {
  const index = new Map<string, QualifiedId | null>();
  for (const qualified of Object.keys(artifacts)) {
    if (!isQualified(qualified)) continue;
    const { id } = parseQualifiedId(qualified);
    if (index.has(id)) {
      index.set(id, null); // ambiguous
    } else {
      index.set(id, qualified);
    }
  }
  return index;
}

/**
 * Resolve a reference (short or qualified) to the qualified ID it targets,
 * returning `null` if the reference cannot be resolved unambiguously.
 *
 * Resolution rules:
 *   - `@scope/id` always returns the literal qualified form when present.
 *   - When `fromScope` is provided, a short reference resolves to
 *     `@fromScope/<ref>` if that qualified ID exists in the artifact map
 *     ("intra-catalog" rule).
 *   - Otherwise, a short reference resolves only when exactly one scope
 *     contributes that shortname; ambiguous references return `null`.
 */
export function lookupArtifactId<T>(
  artifacts: Record<string, T>,
  ref: string,
  fromScope: string | undefined,
  shortnameIndex?: Map<string, QualifiedId | null>
): QualifiedId | null {
  if (isQualified(ref)) {
    return ref in artifacts ? ref : null;
  }
  if (fromScope) {
    const candidate = qualifyId(fromScope, ref);
    if (candidate in artifacts) return candidate;
  }
  const index = shortnameIndex ?? buildShortnameIndex(artifacts);
  return index.get(ref) ?? null;
}

/**
 * Status returned by `resolveReference` so callers can format precise errors.
 */
export type ReferenceResolution =
  | { status: "ok"; qualified: QualifiedId }
  | { status: "missing"; ref: string }
  | { status: "ambiguous"; ref: string; candidates: QualifiedId[] };

/**
 * Resolve a reference and report why it failed (missing vs. ambiguous).
 * Useful for error reporting during composition / validation.
 */
export function resolveReference<T>(
  artifacts: Record<string, T>,
  ref: string,
  fromScope: string | undefined
): ReferenceResolution {
  if (isQualified(ref)) {
    if (ref in artifacts) return { status: "ok", qualified: ref };
    return { status: "missing", ref };
  }
  if (fromScope) {
    const candidate = qualifyId(fromScope, ref);
    if (candidate in artifacts) return { status: "ok", qualified: candidate };
  }
  const candidates: QualifiedId[] = [];
  for (const qualified of Object.keys(artifacts)) {
    if (!isQualified(qualified)) continue;
    if (parseQualifiedId(qualified).id === ref) {
      candidates.push(qualified);
    }
  }
  if (candidates.length === 0) return { status: "missing", ref };
  if (candidates.length === 1) return { status: "ok", qualified: candidates[0] };
  return { status: "ambiguous", ref, candidates };
}
