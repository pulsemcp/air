import { createRequire } from "module";
import { join, resolve } from "path";
import { pathToFileURL } from "url";
import type { AirExtension, PrepareTransform } from "@pulsemcp/air-core";
import { resolveEsmEntry } from "./esm-resolve.js";

export interface LoadedExtensions {
  /** Extensions that provide an adapter */
  adapters: AirExtension[];
  /** Extensions that provide a provider */
  providers: AirExtension[];
  /** Extensions that provide a transform (in declaration order) */
  transforms: AirExtension[];
  /** Extensions that provide a plugin emitter */
  emitters: AirExtension[];
  /** All loaded extensions in declaration order */
  all: AirExtension[];
}

/**
 * Load extensions from the `extensions` array in air.json.
 *
 * Each entry is either an npm package name or a local path (starting
 * with `./`, `../`, or `/`). The default export of each module must be
 * either an `AirExtension` object or a bare transform function.
 *
 * Extensions are loaded sequentially in declaration order because
 * order matters for transforms.
 */
export async function loadExtensions(
  extensions: string[],
  airJsonDir: string
): Promise<LoadedExtensions> {
  const result: LoadedExtensions = {
    adapters: [],
    providers: [],
    transforms: [],
    emitters: [],
    all: [],
  };

  for (const specifier of extensions) {
    const ext = await loadSingleExtension(specifier, airJsonDir);
    result.all.push(ext);
    if (ext.adapter) result.adapters.push(ext);
    if (ext.provider) result.providers.push(ext);
    if (ext.transform) result.transforms.push(ext);
    if (ext.emitter) result.emitters.push(ext);
  }

  return result;
}

async function loadSingleExtension(
  specifier: string,
  airJsonDir: string
): Promise<AirExtension> {
  let mod: Record<string, unknown>;

  try {
    if (
      specifier.startsWith("./") ||
      specifier.startsWith("../") ||
      specifier.startsWith("/")
    ) {
      const absPath = resolve(airJsonDir, specifier);
      const fileUrl = pathToFileURL(absPath).href;
      mod = await import(fileUrl);
    } else {
      // Try resolving npm packages from the project directory (airJsonDir)
      // first, then fall back to the SDK's own resolution.  When the CLI is
      // installed globally, `air install` puts packages under
      // <airJsonDir>/node_modules/ which Node's default resolution from the
      // SDK bundle would never find.  The fallback covers the local
      // development / workspace case where packages live in the SDK's own
      // node_modules tree.
      try {
        const projectRequire = createRequire(
          join(airJsonDir, "__placeholder.js")
        );
        const resolved = projectRequire.resolve(specifier);
        mod = await import(pathToFileURL(resolved).href);
      } catch (projectErr: unknown) {
        // Only fall back when the package wasn't found or can't be resolved
        // via CJS resolution.  Re-throw other errors (e.g. syntax errors in
        // the resolved module) so they aren't masked.
        const code = (projectErr as NodeJS.ErrnoException)?.code;
        if (code === "ERR_PACKAGE_PATH_NOT_EXPORTED") {
          // CJS resolution can't resolve ESM-only packages.  Try resolving
          // the ESM entry point directly from the package.json exports.
          const esmEntry = resolveEsmEntry(specifier, airJsonDir);
          if (esmEntry) {
            mod = await import(pathToFileURL(esmEntry).href);
          } else {
            mod = await import(specifier);
          }
        } else if (
          code === "MODULE_NOT_FOUND" ||
          code === "ERR_MODULE_NOT_FOUND"
        ) {
          mod = await import(specifier);
        } else {
          throw projectErr;
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to load extension "${specifier}": ${message}`
    );
  }

  const defaultExport = mod.default;

  // Bare function → shorthand for a transform-only extension
  if (typeof defaultExport === "function") {
    return {
      name: specifier,
      transform: {
        transform: defaultExport as PrepareTransform["transform"],
      },
    };
  }

  if (!defaultExport || typeof defaultExport !== "object") {
    throw new Error(
      `Extension "${specifier}" does not have a valid default export. ` +
        `Expected an AirExtension object or a transform function.`
    );
  }

  const ext = defaultExport as AirExtension;
  if (!ext.name || typeof ext.name !== "string") {
    throw new Error(
      `Extension "${specifier}" is missing a required "name" field.`
    );
  }
  return ext;
}
