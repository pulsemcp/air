import { resolve } from "path";
import { getAirJsonPath } from "@pulsemcp/air-core";
import {
  discoverIndexes,
  type DiscoveryResult,
  type DiscoveredCatalog,
  type DiscoveredLooseIndex,
  type DiscoveredAirJson,
} from "./discover-indexes.js";
import {
  loadPreferences,
  isDismissed,
  addDismissed,
  type DismissedDiscovery,
} from "./preferences.js";
import {
  addDiscoveredToAirJson,
  buildRegisteredChecker,
  type EditAirJsonResult,
} from "./edit-air-json.js";

export interface FindOfferableOptions {
  /** Working directory to anchor discovery. Defaults to process.cwd(). */
  cwd?: string;
  /** Path to air.json. Defaults to AIR_CONFIG env or ~/.air/air.json. */
  configPath?: string;
  /** Override preferences path (for testing). */
  preferencesPath?: string;
}

export interface OfferableDiscoveryResult {
  /** The raw result from `discoverIndexes`. */
  raw: DiscoveryResult;
  /** Catalogs not yet in air.json and not dismissed. */
  catalogs: DiscoveredCatalog[];
  /** Loose indexes not yet in air.json and not dismissed. */
  looseIndexes: DiscoveredLooseIndex[];
  /** Nested air.json files not yet in air.json and not dismissed. */
  airJsons: DiscoveredAirJson[];
  /** True if there is anything to offer the user. */
  hasOffers: boolean;
}

/**
 * Run discovery, drop anything already in `~/.air/air.json`, drop anything
 * the user has asked AIR not to offer again. The caller decides what to do
 * with the survivors (prompt, auto-accept, etc.).
 */
export function findOfferableIndexes(
  options?: FindOfferableOptions
): OfferableDiscoveryResult {
  const cwd = options?.cwd ?? process.cwd();
  const configPath = options?.configPath ?? getAirJsonPath();
  const raw = discoverIndexes(cwd);

  const registered = buildRegisteredChecker(configPath);
  const prefs = loadPreferences(options?.preferencesPath);

  const asDismissed = (indexPath: string): DismissedDiscovery => ({
    repoRoot: raw.anchor,
    indexPath,
  });

  const catalogs = raw.catalogs.filter((c) => {
    if (registered.catalog(c.path)) return false;
    if (isDismissed(prefs, asDismissed(c.relPath))) return false;
    return true;
  });

  const looseIndexes = raw.looseIndexes.filter((l) => {
    if (registered.loose(l.type, l.path)) return false;
    if (isDismissed(prefs, asDismissed(l.relPath))) return false;
    return true;
  });

  const airJsons = raw.airJsons.filter((a) => {
    if (registered.airJson(a.path)) return false;
    if (isDismissed(prefs, asDismissed(a.relPath))) return false;
    return true;
  });

  return {
    raw,
    catalogs,
    looseIndexes,
    airJsons,
    hasOffers:
      catalogs.length > 0 ||
      looseIndexes.length > 0 ||
      airJsons.length > 0,
  };
}

export interface AcceptDiscoveryOptions {
  /** Override the air.json path. */
  configPath?: string;
}

/**
 * Accept all offers by writing them into air.json.
 */
export function acceptOffers(
  offers: OfferableDiscoveryResult,
  options?: AcceptDiscoveryOptions
): EditAirJsonResult {
  const configPath = options?.configPath;
  return addDiscoveredToAirJson(
    {
      catalogs: offers.catalogs,
      looseIndexes: offers.looseIndexes,
      airJsons: offers.airJsons,
    },
    { path: configPath }
  );
}

export interface DismissDiscoveryOptions {
  /** Override the preferences path (for testing). */
  preferencesPath?: string;
}

/**
 * Mark every current offer as dismissed so it is never surfaced again.
 * Uses (repoRoot=anchor, indexPath=relative) granularity — new files added
 * later still get offered.
 */
export function dismissOffers(
  offers: OfferableDiscoveryResult,
  options?: DismissDiscoveryOptions
): void {
  const { anchor } = offers.raw;
  const entries: DismissedDiscovery[] = [];
  for (const c of offers.catalogs) {
    entries.push({ repoRoot: resolve(anchor), indexPath: c.relPath });
  }
  for (const l of offers.looseIndexes) {
    entries.push({ repoRoot: resolve(anchor), indexPath: l.relPath });
  }
  for (const a of offers.airJsons) {
    entries.push({ repoRoot: resolve(anchor), indexPath: a.relPath });
  }
  if (entries.length === 0) return;
  addDismissed(entries, options?.preferencesPath);
}
