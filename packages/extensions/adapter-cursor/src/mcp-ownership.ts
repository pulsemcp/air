import type { Manifest, McpServerEntry, ResolvedArtifacts } from "@pulsemcp/air-core";
import {
  isQualified,
  manifestMcpServersAreAirOwned,
  parseQualifiedId,
} from "@pulsemcp/air-core";

/**
 * The previous manifest's MCP server entries, split into the ones this run
 * may treat as AIR's own — rewrite them, or remove them once deselected —
 * and the ones AIR gives up on.
 */
export interface PreviousMcpServerOwnership {
  owned: Set<string>;
  /** Entries AIR no longer claims. Their keys are left in the config. */
  relinquished: string[];
}

/** The config the adapter writes under `short` for one catalog server. */
export type TranslateMcpServer = (short: string, server: McpServerEntry) => unknown;

export interface McpServerOwnershipOptions {
  /**
   * Whether `${...}` placeholders AIR wrote may since have been replaced in
   * the config file itself. True only for a file the secret transforms
   * (`@pulsemcp/air-secrets-env`, `@pulsemcp/air-secrets-file`) rewrite in
   * place — Claude's `.mcp.json`. Elsewhere placeholders compare exactly.
   */
  resolvedPlaceholders: boolean;
}

/**
 * Decide which of `prevManifest`'s MCP server entries are AIR's, given the
 * server map currently in the adapter's config file.
 *
 * A version 3+ manifest only ever lists keys AIR wrote, so every entry is
 * owned. An earlier manifest may also list a key the user wrote: AIR used to
 * overwrite and claim a user's key that shared a selected catalog server's
 * shortname (#174). So an entry whose key is still present stays owned only
 * when its config is what AIR writes for a catalog server with that shortname
 * (see {@link matchesWrittenConfig}). The rest are relinquished: never
 * removed, and left out of the next manifest.
 */
export function previousMcpServerOwnership(
  prevManifest: Manifest | null,
  existingServers: Record<string, unknown>,
  artifacts: ResolvedArtifacts,
  translate: TranslateMcpServer,
  options: McpServerOwnershipOptions
): PreviousMcpServerOwnership {
  if (!prevManifest) return { owned: new Set(), relinquished: [] };
  if (manifestMcpServersAreAirOwned(prevManifest)) {
    return { owned: new Set(prevManifest.mcpServers), relinquished: [] };
  }

  const owned = new Set<string>();
  const relinquished: string[] = [];
  for (const id of prevManifest.mcpServers) {
    if (
      !hasMcpServer(existingServers, id) ||
      matchesCatalogServer(existingServers[id], id, artifacts, translate, options)
    ) {
      owned.add(id);
    } else {
      relinquished.push(id);
    }
  }
  return { owned, relinquished };
}

/** Whether a config's server map has an entry under `id`. */
export function hasMcpServer(servers: Record<string, unknown>, id: string): boolean {
  return Object.prototype.hasOwnProperty.call(servers, id);
}

function matchesCatalogServer(
  actual: unknown,
  short: string,
  artifacts: ResolvedArtifacts,
  translate: TranslateMcpServer,
  options: McpServerOwnershipOptions
): boolean {
  for (const [qualified, server] of Object.entries(artifacts.mcp)) {
    if (!isQualified(qualified) || parseQualifiedId(qualified).id !== short) {
      continue;
    }
    try {
      if (matchesWrittenConfig(actual, translate(short, server), options)) return true;
    } catch {
      // A server the adapter can't translate is not one it wrote.
    }
  }
  return false;
}

const PLACEHOLDER = /\$\{[^}]*\}/;

/**
 * Whether `actual` is `written` as it can look on disk after an AIR run:
 * structurally equal — same keys, array lengths and values. With
 * `resolvedPlaceholders`, each `${...}` placeholder in a written string may
 * instead hold any text, but the text around it must still match exactly.
 */
export function matchesWrittenConfig(
  actual: unknown,
  written: unknown,
  options: McpServerOwnershipOptions
): boolean {
  if (typeof written === "string") {
    if (typeof actual !== "string") return false;
    if (actual === written) return true;
    return options.resolvedPlaceholders && matchesResolved(actual, written);
  }
  if (Array.isArray(written)) {
    return (
      Array.isArray(actual) &&
      actual.length === written.length &&
      written.every((value, i) => matchesWrittenConfig(actual[i], value, options))
    );
  }
  if (written !== null && typeof written === "object") {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
      return false;
    }
    const expected = Object.entries(written).filter(([, value]) => value !== undefined);
    const actualRecord = actual as Record<string, unknown>;
    return (
      Object.keys(actualRecord).length === expected.length &&
      expected.every(
        ([key, value]) =>
          hasMcpServer(actualRecord, key) &&
          matchesWrittenConfig(actualRecord[key], value, options)
      )
    );
  }
  return actual === written;
}

/**
 * Whether `actual` is `written` with each placeholder replaced by any text.
 * Linear: the first and last literal segments anchor the ends, and each one
 * between is found at its leftmost position after the previous — never a
 * regex, whose backtracking over catalog-supplied patterns can take minutes.
 */
function matchesResolved(actual: string, written: string): boolean {
  const segments = written.split(PLACEHOLDER);
  if (segments.length === 1) return false;
  const first = segments[0];
  const last = segments[segments.length - 1];
  const end = actual.length - last.length;
  if (end < first.length || !actual.startsWith(first) || !actual.endsWith(last)) {
    return false;
  }
  let position = first.length;
  for (const segment of segments.slice(1, -1)) {
    const at = actual.indexOf(segment, position);
    if (at < 0 || at + segment.length > end) return false;
    position = at + segment.length;
  }
  return true;
}

export function relinquishedMcpServerMessage(configFile: string, id: string): string {
  return (
    `AIR is leaving the "${id}" MCP server entry in ${configFile} in place and ` +
    `no longer manages it. An earlier AIR version recorded it as written by ` +
    `AIR, but AIR can't confirm it wrote that entry (it doesn't match what AIR ` +
    `writes for any catalog MCP server of that name), so it may be one you ` +
    `wrote (https://github.com/pulsemcp/air/issues/174). AIR won't overwrite ` +
    `or remove it. Delete it by hand if you want AIR to manage the catalog ` +
    `server of that name again.`
  );
}

/**
 * Warning for a selected catalog server whose shortname is already a key in
 * the config that AIR didn't write. AIR leaves that key as it is.
 */
export function userMcpServerKeptMessage(
  configFile: string,
  id: string,
  qualified: string
): string {
  return (
    `AIR did not write MCP server "${qualified}" to ${configFile}: the file ` +
    `already has a "${id}" entry that AIR didn't write, so AIR left that ` +
    `entry as it is and won't remove it later. Rename or delete the entry if ` +
    `you want AIR to manage "${qualified}".`
  );
}

/**
 * Warning for `cleanSession`, which has no catalog to check an earlier
 * manifest's MCP server entries against and so leaves them in place.
 */
export function unverifiedMcpServersMessage(configFile: string, ids: string[]): string {
  const one = ids.length === 1;
  return (
    `AIR left the ${ids.map((id) => `"${id}"`).join(", ")} MCP server ` +
    `${one ? "entry" : "entries"} in ${configFile} in place. A manifest ` +
    `written by an earlier AIR version lists ${one ? "it" : "them"}, but that ` +
    `version could also record an entry you wrote as written by AIR ` +
    `(https://github.com/pulsemcp/air/issues/174), and there is no catalog ` +
    `here to tell them apart. Run \`air prepare\` or \`air start\` in this ` +
    `directory once so AIR can check, then clean again — or delete what you ` +
    `don't need by hand.`
  );
}
