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
  translate: TranslateMcpServer
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
      matchesCatalogServer(existingServers[id], id, artifacts, translate)
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
  translate: TranslateMcpServer
): boolean {
  for (const [qualified, server] of Object.entries(artifacts.mcp)) {
    if (!isQualified(qualified) || parseQualifiedId(qualified).id !== short) {
      continue;
    }
    try {
      if (matchesWrittenConfig(actual, translate(short, server))) return true;
    } catch {
      // A server the adapter can't translate is not one it wrote.
    }
  }
  return false;
}

const PLACEHOLDER = /\$\{[^}]*\}/;

/**
 * Whether `actual` is `written` as it can look on disk after an AIR run:
 * structurally equal, except that each `${...}` placeholder in a written
 * string may have been replaced by any text, because secret transforms
 * (`@pulsemcp/air-secrets-env`, `@pulsemcp/air-secrets-file`) resolve them in
 * the config file in place. The text around a placeholder, the set of keys,
 * array lengths, and every non-string value must match exactly.
 */
export function matchesWrittenConfig(actual: unknown, written: unknown): boolean {
  if (typeof written === "string") {
    if (typeof actual !== "string") return false;
    if (actual === written) return true;
    const pattern = written.split(PLACEHOLDER).map(escapeRegExp).join("[\\s\\S]*");
    return new RegExp(`^${pattern}$`).test(actual);
  }
  if (Array.isArray(written)) {
    return (
      Array.isArray(actual) &&
      actual.length === written.length &&
      written.every((value, i) => matchesWrittenConfig(actual[i], value))
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
          hasMcpServer(actualRecord, key) && matchesWrittenConfig(actualRecord[key], value)
      )
    );
  }
  return actual === written;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
