/**
 * Transform a fully-qualified `ResolvedArtifacts` (keys of the form
 * `@scope/id`) into a shortname-keyed equivalent. Reference fields inside
 * entries (e.g. `default_skills`, `mcp_servers`, `references`) are also
 * rewritten to bare shortnames.
 *
 * This is the machinery behind `air resolve --no-scope` — an opt-in
 * convenience for consumers committed to a single-scope universe. The
 * transformation hard-fails (via {@link ShortnameCollisionError}) when any
 * shortname is contributed by more than one scope within the same artifact
 * category, so the caller never silently picks a winner.
 */

import type {
  HookEntry,
  McpServerEntry,
  PluginEntry,
  ReferenceEntry,
  ResolvedArtifacts,
  RootEntry,
  SkillEntry,
} from "./types.js";
import { isQualified, parseQualifiedId, type QualifiedId } from "./scope.js";

/** A single category × shortname collision detected by {@link stripScopes}. */
export interface ShortnameCollision {
  category: keyof ResolvedArtifacts;
  shortname: string;
  qualifiedIds: QualifiedId[];
}

/**
 * Thrown by {@link stripScopes} when one or more shortnames are contributed
 * by more than one scope within the same artifact category.
 */
export class ShortnameCollisionError extends Error {
  readonly collisions: ShortnameCollision[];

  constructor(collisions: ShortnameCollision[]) {
    super(formatCollisionMessage(collisions));
    this.name = "ShortnameCollisionError";
    this.collisions = collisions;
  }
}

function formatCollisionMessage(collisions: ShortnameCollision[]): string {
  const lines: string[] = [
    "--no-scope requires unique shortnames across all scopes, but",
  ];
  for (const c of collisions) {
    lines.push(
      `  shortname "${c.shortname}" maps to multiple qualified IDs:`
    );
    for (const q of c.qualifiedIds) {
      lines.push(`    - ${q}`);
    }
  }
  lines.push(
    "  Either use the default qualified output, or exclude one of them",
    "  via air.json#exclude."
  );
  return lines.join("\n");
}

function stripIfQualified(ref: string): string {
  return isQualified(ref) ? parseQualifiedId(ref).id : ref;
}

function stripList(refs: string[] | undefined): string[] | undefined {
  return refs?.map(stripIfQualified);
}

function shortnameKey(qualified: string): string {
  return isQualified(qualified) ? parseQualifiedId(qualified).id : qualified;
}

function detectCollisions(
  artifacts: ResolvedArtifacts
): ShortnameCollision[] {
  const collisions: ShortnameCollision[] = [];
  const categories = Object.keys(artifacts) as (keyof ResolvedArtifacts)[];
  for (const category of categories) {
    const pool = artifacts[category];
    const byShortname = new Map<string, QualifiedId[]>();
    for (const qualified of Object.keys(pool)) {
      if (!isQualified(qualified)) continue;
      const { id } = parseQualifiedId(qualified);
      const list = byShortname.get(id);
      if (list) {
        list.push(qualified);
      } else {
        byShortname.set(id, [qualified]);
      }
    }
    for (const [shortname, qualifiedIds] of byShortname) {
      if (qualifiedIds.length > 1) {
        collisions.push({
          category,
          shortname,
          qualifiedIds: [...qualifiedIds].sort(),
        });
      }
    }
  }
  return collisions;
}

/**
 * Convert a `ResolvedArtifacts` whose keys are qualified IDs into the
 * equivalent shortname-keyed shape. The result is a new object; the input
 * is not mutated.
 *
 * @throws {@link ShortnameCollisionError} when any shortname is contributed
 * by more than one scope within the same artifact category.
 */
export function stripScopes(artifacts: ResolvedArtifacts): ResolvedArtifacts {
  const collisions = detectCollisions(artifacts);
  if (collisions.length > 0) {
    throw new ShortnameCollisionError(collisions);
  }

  const skills: Record<string, SkillEntry> = {};
  for (const [qualified, entry] of Object.entries(artifacts.skills)) {
    skills[shortnameKey(qualified)] =
      entry.references === undefined
        ? entry
        : { ...entry, references: stripList(entry.references) };
  }

  const references: Record<string, ReferenceEntry> = {};
  for (const [qualified, entry] of Object.entries(artifacts.references)) {
    references[shortnameKey(qualified)] = entry;
  }

  const mcp: Record<string, McpServerEntry> = {};
  for (const [qualified, entry] of Object.entries(artifacts.mcp)) {
    mcp[shortnameKey(qualified)] = entry;
  }

  const plugins: Record<string, PluginEntry> = {};
  for (const [qualified, entry] of Object.entries(artifacts.plugins)) {
    const next: PluginEntry = { ...entry };
    if (entry.skills !== undefined) next.skills = stripList(entry.skills);
    if (entry.mcp_servers !== undefined)
      next.mcp_servers = stripList(entry.mcp_servers);
    if (entry.hooks !== undefined) next.hooks = stripList(entry.hooks);
    if (entry.plugins !== undefined) next.plugins = stripList(entry.plugins);
    plugins[shortnameKey(qualified)] = next;
  }

  const roots: Record<string, RootEntry> = {};
  for (const [qualified, entry] of Object.entries(artifacts.roots)) {
    const next: RootEntry = { ...entry };
    if (entry.default_mcp_servers !== undefined)
      next.default_mcp_servers = stripList(entry.default_mcp_servers);
    if (entry.default_skills !== undefined)
      next.default_skills = stripList(entry.default_skills);
    if (entry.default_plugins !== undefined)
      next.default_plugins = stripList(entry.default_plugins);
    if (entry.default_hooks !== undefined)
      next.default_hooks = stripList(entry.default_hooks);
    if (entry.default_subagent_roots !== undefined)
      next.default_subagent_roots = stripList(entry.default_subagent_roots);
    roots[shortnameKey(qualified)] = next;
  }

  const hooks: Record<string, HookEntry> = {};
  for (const [qualified, entry] of Object.entries(artifacts.hooks)) {
    hooks[shortnameKey(qualified)] =
      entry.references === undefined
        ? entry
        : { ...entry, references: stripList(entry.references) };
  }

  return { skills, references, mcp, plugins, roots, hooks };
}
