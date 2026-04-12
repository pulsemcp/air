import { execFile } from "child_process";
import { existsSync, readFileSync, readdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { pathToFileURL } from "url";
import { createRequire } from "module";
import {
  loadAirConfig,
  getAirJsonPath,
  getDefaultAirJsonPath,
  type CacheRefreshResult,
  type CatalogProvider,
  type AirExtension,
} from "@pulsemcp/air-core";
import { loadExtensions } from "./extension-loader.js";
import { resolveEsmEntry } from "./esm-resolve.js";

/**
 * Known provider packages, keyed by their cache directory name (scheme).
 * Used to auto-discover providers when air.json doesn't list them and to
 * auto-upgrade providers that are too old to support cache refresh.
 */
const KNOWN_PROVIDERS: Record<string, string> = {
  github: "@pulsemcp/air-provider-github",
};

/**
 * Minimum version of each known provider package required to support
 * `refreshCache()`. When the installed version is older than this, the
 * pre-flight upgrade step in {@link updateProviderCaches} will run
 * `npm install <pkg>@latest` so the freshly loaded module exposes
 * cache refresh.
 *
 * Bump these when raising the SDK's expectations of providers.
 */
const PROVIDER_MIN_VERSIONS: Record<string, string> = {
  "@pulsemcp/air-provider-github": "0.0.21",
};

export interface UpdateProviderCachesOptions {
  /** Path to air.json. Uses AIR_CONFIG env or ~/.air/air.json if not set. */
  config?: string;
  /**
   * When true (default), automatically upgrade provider extensions that
   * are installed at a version too old to expose `refreshCache()` before
   * loading them. Disable in tests or when running offline.
   */
  autoHeal?: boolean;
  /**
   * Override for the npm install command used by auto-heal. Tests pass a
   * stub here to simulate upgrade outcomes without touching the network.
   */
  runNpmInstallLatest?: NpmInstallLatest;
}

export interface UpdateProviderCachesResult {
  /** Results from each provider, keyed by provider scheme. */
  results: Record<string, CacheRefreshResult[]>;
}

/**
 * Hook used by tests to stub out the real `npm install` invocation.
 * The default implementation shells out to `npm install <pkg>@latest`.
 */
export type NpmInstallLatest = (
  packageName: string,
  prefix: string
) => Promise<{ ok: boolean; stderr: string }>;

/**
 * Result of a single pre-flight upgrade attempt.
 */
interface UpgradeOutcome {
  packageName: string;
  scheme: string;
  attempted: boolean;
  ok: boolean;
  beforeVersion: string | null;
  afterVersion: string | null;
  stderr?: string;
}

/**
 * Get the AIR cache root directory (~/.air/cache).
 * Derived from getDefaultAirJsonPath() to stay in sync with core's
 * notion of the AIR home directory.
 */
function getCacheRoot(): string {
  return resolve(dirname(getDefaultAirJsonPath()), "cache");
}

/**
 * Scan ~/.air/cache/ for subdirectories, each representing a provider scheme
 * that has cached data on disk.
 */
function discoverCachedSchemes(): string[] {
  const cacheRoot = getCacheRoot();
  if (!existsSync(cacheRoot)) return [];

  try {
    return readdirSync(cacheRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/**
 * Read the installed version of an npm package from its package.json,
 * looking under `<prefix>/node_modules/<packageName>`.
 */
function readInstalledVersion(
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

/**
 * Compare two semver-ish version strings of the form `MAJOR.MINOR.PATCH`.
 * Returns a negative number if `a < b`, 0 if equal, positive if `a > b`.
 * Pre-release suffixes are ignored — we only need ordering for known
 * provider versions like `0.0.13` vs `0.0.21`.
 */
function compareVersions(a: string, b: string): number {
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
 * Strip a version suffix from an npm specifier so we can compare against
 * known package names. Mirrors the helper in `install.ts`.
 */
function stripVersion(specifier: string): string {
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
  const atIdx = specifier.indexOf("@");
  if (atIdx > 0) {
    return specifier.slice(0, atIdx);
  }
  return specifier;
}

/**
 * Default implementation of {@link NpmInstallLatest} — runs
 * `npm install --prefix <prefix> --prefer-offline <pkg>@latest`.
 */
const defaultNpmInstallLatest: NpmInstallLatest = (packageName, prefix) =>
  new Promise((resolveResult) => {
    execFile(
      "npm",
      [
        "install",
        "--prefix",
        prefix,
        "--prefer-offline",
        "--no-audit",
        "--no-fund",
        "--silent",
        `${packageName}@latest`,
      ],
      { stdio: "pipe" } as Parameters<typeof execFile>[2],
      (err, _stdout, stderr) => {
        if (err) {
          resolveResult({
            ok: false,
            stderr: stderr?.toString() ?? String(err),
          });
        } else {
          resolveResult({ ok: true, stderr: "" });
        }
      }
    );
  });

/**
 * Try to load a provider extension by package name, searching the given
 * directories for the installed package. Handles CJS, ESM-only, and
 * standard Node resolution.
 */
async function tryLoadProvider(
  packageName: string,
  searchDirs: string[]
): Promise<CatalogProvider | null> {
  for (const dir of searchDirs) {
    try {
      const req = createRequire(join(dir, "__placeholder.js"));
      const resolved = req.resolve(packageName);
      const mod = await import(pathToFileURL(resolved).href);
      return (mod.default as AirExtension)?.provider ?? null;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ERR_PACKAGE_PATH_NOT_EXPORTED") {
        const esmEntry = resolveEsmEntry(packageName, dir);
        if (esmEntry) {
          try {
            const mod = await import(pathToFileURL(esmEntry).href);
            return (mod.default as AirExtension)?.provider ?? null;
          } catch {
            // Fall through to next directory
          }
        }
      }
      // Not found in this directory, try next
    }
  }

  // Fall back to standard Node resolution
  try {
    const mod = await import(packageName);
    return (mod.default as AirExtension)?.provider ?? null;
  } catch {
    return null;
  }
}

/**
 * Build the list of directories to search when resolving a provider
 * package by name.
 */
function buildSearchDirs(airJsonDir: string | null): string[] {
  const dirs: string[] = [];
  if (airJsonDir) dirs.push(airJsonDir);
  const defaultAirDir = dirname(getDefaultAirJsonPath());
  if (defaultAirDir !== airJsonDir) dirs.push(defaultAirDir);
  return dirs;
}

/**
 * Pre-flight: walk the extensions array in air.json and any cached
 * provider schemes on disk, and `npm install <pkg>@latest` for any
 * known provider whose installed version is below the minimum required
 * for `refreshCache()` support.
 *
 * Runs BEFORE any provider modules are imported so the freshly
 * installed package is what gets loaded — Node caches modules by URL
 * and there is no reliable way to bust the transitive import cache once
 * a stale version has been imported in-process.
 */
async function preflightUpgradeProviders(
  extensionSpecs: string[],
  cachedSchemes: string[],
  installPrefix: string,
  runNpmInstallLatest: NpmInstallLatest
): Promise<UpgradeOutcome[]> {
  // Collect the set of provider package names we should consider, drawn
  // from both the air.json extensions list and any cached scheme that
  // maps to a known provider package. We dedupe by package name.
  const candidates = new Set<string>();

  for (const spec of extensionSpecs) {
    if (typeof spec !== "string") continue;
    const name = stripVersion(spec);
    // Only consider known providers — we won't auto-install arbitrary
    // packages on the user's behalf.
    if (Object.values(KNOWN_PROVIDERS).includes(name)) {
      candidates.add(name);
    }
  }

  for (const scheme of cachedSchemes) {
    const name = KNOWN_PROVIDERS[scheme];
    if (name) candidates.add(name);
  }

  const outcomes: UpgradeOutcome[] = [];

  for (const packageName of candidates) {
    const minVersion = PROVIDER_MIN_VERSIONS[packageName];
    if (!minVersion) continue;

    const installed = readInstalledVersion(packageName, installPrefix);

    // Not installed at all under this prefix — leave alone. The
    // extension loader will handle missing packages with its own
    // error path; auto-installing absent packages goes beyond what
    // `air update` is supposed to do.
    if (!installed) continue;

    if (compareVersions(installed, minVersion) >= 0) continue;

    const scheme =
      Object.entries(KNOWN_PROVIDERS).find(([, n]) => n === packageName)?.[0] ??
      "";

    const installResult = await runNpmInstallLatest(packageName, installPrefix);
    const after = readInstalledVersion(packageName, installPrefix);

    outcomes.push({
      packageName,
      scheme,
      attempted: true,
      ok: installResult.ok,
      beforeVersion: installed,
      afterVersion: after,
      stderr: installResult.stderr || undefined,
    });
  }

  return outcomes;
}

/**
 * Build a {@link CacheRefreshResult} describing a single upgrade outcome,
 * suitable for prepending to the per-scheme results array.
 */
function upgradeNotice(outcome: UpgradeOutcome): CacheRefreshResult {
  if (outcome.ok) {
    const before = outcome.beforeVersion ?? "(none)";
    const after = outcome.afterVersion ?? "latest";
    return {
      label: outcome.packageName,
      updated: true,
      message: `upgraded provider package ${before} → ${after}`,
    };
  }
  return {
    label: outcome.packageName,
    updated: false,
    message:
      `failed to auto-upgrade provider package` +
      (outcome.stderr ? `: ${outcome.stderr.trim().split("\n")[0]}` : ""),
  };
}

/**
 * Refresh all provider caches.
 *
 * Discovers providers in two ways:
 * 1. From air.json extensions (if air.json exists)
 * 2. By scanning ~/.air/cache/ for known provider cache directories
 *
 * Before loading any provider modules, runs a pre-flight check that
 * compares the installed version of each known provider package against
 * the minimum required for `refreshCache()` support. Outdated packages
 * are upgraded with `npm install <pkg>@latest` so the freshly loaded
 * module exposes cache refresh — making `air update` self-healing
 * across CLI upgrades that outpace the extension packages installed
 * under `~/.air/`.
 */
export async function updateProviderCaches(
  options?: UpdateProviderCachesOptions
): Promise<UpdateProviderCachesResult> {
  const airJsonPath = options?.config ?? getAirJsonPath();
  const autoHeal = options?.autoHeal ?? true;
  const runNpmInstallLatest =
    options?.runNpmInstallLatest ?? defaultNpmInstallLatest;

  let airJsonDir: string | null = null;
  let extensionSpecs: string[] = [];
  if (airJsonPath) {
    airJsonDir = dirname(resolve(airJsonPath));
    const airConfig = loadAirConfig(airJsonPath);
    extensionSpecs = airConfig.extensions ?? [];
  }

  const installPrefix = airJsonDir ?? dirname(getDefaultAirJsonPath());
  const cachedSchemes = discoverCachedSchemes();
  const cachedSchemeSet = new Set(cachedSchemes);

  // Pre-flight: upgrade any stale provider packages BEFORE loading
  // them. We must do this before any import() of the provider runs
  // because Node caches modules by URL and there is no reliable way to
  // bust the transitive import cache once a stale module is loaded.
  const upgradeOutcomes = autoHeal
    ? await preflightUpgradeProviders(
        extensionSpecs,
        cachedSchemes,
        installPrefix,
        runNpmInstallLatest
      )
    : [];

  // Load providers from air.json extensions if available
  const providers = new Map<string, CatalogProvider>();
  if (airJsonPath) {
    const loaded = await loadExtensions(extensionSpecs, airJsonDir!);
    for (const ext of loaded.providers) {
      const provider = ext.provider!;
      providers.set(provider.scheme, provider);
    }
  }

  // Discover additional providers from cache directory
  for (const scheme of cachedSchemes) {
    if (providers.has(scheme)) continue;

    const packageName = KNOWN_PROVIDERS[scheme];
    if (!packageName) continue;

    const provider = await tryLoadProvider(
      packageName,
      buildSearchDirs(airJsonDir)
    );
    // Add the provider even if it lacks refreshCache — the main loop
    // below will surface a diagnostic so the user understands why the
    // refresh did not run, instead of the command silently reporting
    // "no providers with cached data found".
    if (provider) {
      providers.set(scheme, provider);
    }
  }

  // Index pre-flight outcomes by scheme so we can prepend the upgrade
  // notice to that scheme's per-call results.
  const upgradeByScheme = new Map<string, UpgradeOutcome>();
  for (const outcome of upgradeOutcomes) {
    if (outcome.scheme) upgradeByScheme.set(outcome.scheme, outcome);
  }

  // Only schemes with actual cached data on disk are worth reporting.
  // A provider may be listed in air.json extensions without having been
  // used yet, in which case there is nothing to refresh.
  const results: Record<string, CacheRefreshResult[]> = {};

  for (const scheme of cachedSchemeSet) {
    const provider = providers.get(scheme);

    // Schemes with no loaded provider AND no known package mapping
    // can't be helped — preserve the historical "silently ignore
    // unknown schemes" behavior.
    if (!provider && !KNOWN_PROVIDERS[scheme]) continue;

    const outcome = upgradeByScheme.get(scheme);
    const notice = outcome ? upgradeNotice(outcome) : null;
    const packageName =
      KNOWN_PROVIDERS[scheme] ?? `@pulsemcp/air-provider-${scheme}`;

    if (!provider?.refreshCache) {
      // Either no provider exists for this scheme, or auto-heal could
      // not produce one with refreshCache support. Surface a single
      // diagnostic entry so the user knows what to do next.
      const diagnostic: CacheRefreshResult = {
        label: scheme,
        updated: false,
        message: provider
          ? `installed provider does not support cache refresh. ` +
            `Try manually: npm install --prefix ${installPrefix} ${packageName}@latest`
          : `no provider installed for "${scheme}://" cached data. ` +
            `Try manually: npm install --prefix ${installPrefix} ${packageName}@latest`,
      };
      results[scheme] = notice ? [notice, diagnostic] : [diagnostic];
      continue;
    }

    const refreshResults = await provider.refreshCache();
    results[scheme] = notice ? [notice, ...refreshResults] : refreshResults;
  }

  return { results };
}
