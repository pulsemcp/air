import { existsSync, readFileSync, writeFileSync } from "fs";
import { basename, join } from "path";
import {
  mergeXConfig,
  parseQualifiedId,
  type ResolvedArtifacts,
  type HookEntry,
} from "@pulsemcp/air-core";

/**
 * Read every active hook's source HOOK.json and deep-merge the consumer's
 * `x-config` (declared in `hooks.json`) into the file's own `x-config`.
 * Returns a new `ResolvedArtifacts` whose `hooks[*]["x-config"]` is the
 * fully-merged value — what `air resolve --json` shows and what should be
 * written to the materialized HOOK.json.
 *
 * Hooks whose source HOOK.json is missing or unparseable are returned with
 * just the consumer's `x-config` (or undefined) — the consumer's intent is
 * preserved even when the source is unreachable.
 *
 * The original HookEntry objects are not mutated.
 */
export function materializeHookXConfig(
  artifacts: ResolvedArtifacts
): ResolvedArtifacts {
  const merged: Record<string, HookEntry> = {};
  for (const [qualified, entry] of Object.entries(artifacts.hooks)) {
    const sourceXConfig = readHookSourceXConfig(entry.path);
    const consumerXConfig = entry["x-config"];
    const result = mergeXConfig(sourceXConfig, consumerXConfig);
    if (result === undefined || !isPlainObject(result)) {
      // No x-config on either side — drop the field rather than emit an empty
      // object, so consumers that conditionally render the field stay clean.
      const { "x-config": _omit, ...rest } = entry;
      merged[qualified] = rest;
    } else {
      merged[qualified] = { ...entry, "x-config": result };
    }
  }
  return { ...artifacts, hooks: merged };
}

/**
 * After the adapter has copied a hook directory into the agent's working
 * tree, write the merged `x-config` back into the materialized HOOK.json so
 * subsequent transforms (e.g. `${VAR}` interpolation) operate on the fully
 * composed config.
 *
 * Each `hookPath` is a directory; its basename is the short ID. When
 * `activations` is provided (a short→qualified mapping the adapter emits),
 * the qualified ID is used to look up the exact resolved hook entry —
 * disambiguating cross-scope shortname collisions. Without `activations`,
 * falls back to a short-id lookup that picks the first matching entry.
 *
 * Hooks without an `x-config` on either side are skipped — the verbatim copy
 * made by the adapter is correct.
 */
export function writeMergedHookXConfigs(
  hookPaths: string[],
  artifacts: ResolvedArtifacts,
  activations?: Array<{ short: string; qualified: string }>
): void {
  const qualifiedByShort = new Map<string, string>();
  if (activations) {
    for (const a of activations) qualifiedByShort.set(a.short, a.qualified);
  }

  for (const hookPath of hookPaths) {
    const shortId = basename(hookPath);
    const qualified = qualifiedByShort.get(shortId);
    const entry = qualified
      ? artifacts.hooks[qualified]
      : findHookByShortId(artifacts, shortId);
    if (!entry) continue;

    const consumerXConfig = entry["x-config"];
    const hookJsonPath = join(hookPath, "HOOK.json");
    if (!existsSync(hookJsonPath)) continue;

    let hookJson: Record<string, unknown>;
    try {
      hookJson = JSON.parse(readFileSync(hookJsonPath, "utf-8"));
    } catch {
      continue;
    }

    const sourceXConfig = hookJson["x-config"];
    if (consumerXConfig === undefined && sourceXConfig === undefined) continue;

    const merged = mergeXConfig(sourceXConfig, consumerXConfig);
    if (merged === undefined) continue;

    const next: Record<string, unknown> = { ...hookJson, "x-config": merged };
    writeFileSync(hookJsonPath, JSON.stringify(next, null, 2) + "\n");
  }
}

function readHookSourceXConfig(hookDir: string): unknown {
  const hookJsonPath = join(hookDir, "HOOK.json");
  if (!existsSync(hookJsonPath)) return undefined;
  try {
    const data = JSON.parse(readFileSync(hookJsonPath, "utf-8"));
    if (!isPlainObject(data)) return undefined;
    return data["x-config"];
  } catch {
    return undefined;
  }
}

function findHookByShortId(
  artifacts: ResolvedArtifacts,
  shortId: string
): HookEntry | undefined {
  for (const [qualified, entry] of Object.entries(artifacts.hooks)) {
    if (parseQualifiedId(qualified).id === shortId) return entry;
  }
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value)
  );
}
