import Ajv from "ajv";
import addFormats from "ajv-formats";
import { loadSchema, type SchemaType } from "./schemas.js";
import {
  inlineBodyFields,
  inlineBodyRemovedMessage,
} from "./plugin-body.js";

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  path: string;
  message: string;
}

const ARTIFACT_TYPES = [
  "skills",
  "references",
  "mcp",
  "plugins",
  "roots",
  "hooks",
] as const;

/**
 * If `data` is an air.json with the legacy flat-array `exclude` shape,
 * return a migration error tuned for that case. The default AJV message
 * (`/exclude must be object`) does not point users at the new shape, so
 * `air validate` would otherwise leave them guessing.
 */
function detectLegacyExcludeShape(data: unknown): ValidationError | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const exclude = (data as Record<string, unknown>).exclude;
  if (!Array.isArray(exclude)) return null;
  return {
    path: "/exclude",
    message:
      `air.json "exclude" must be an object keyed by artifact type ` +
      `(${ARTIFACT_TYPES.join(", ")}), not an array. ` +
      `Migration: replace exclude: ["@a/x"] with ` +
      `exclude: { "<type>": ["@a/x"] }, where <type> is the artifact ` +
      `kind "@a/x" was meant to drop.`,
  };
}

/**
 * Plugin entries that declare body fields (`skills`, `version`, …) with no
 * sibling `path` — the inline plugin body removed in
 * https://github.com/pulsemcp/air/issues/157. The schema rejects these through
 * a `dependencies` map, but AJV reports that one field at a time ("must have
 * property path when property skills is present"), which says nothing about
 * where those fields belong now. This replaces those with the same per-plugin
 * migration message `resolveArtifacts` raises.
 */
function detectInlinePluginBodies(data: unknown): ValidationError[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const errors: ValidationError[] = [];

  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (key === "$schema") continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    if ("path" in entry) continue;
    const inline = inlineBodyFields(entry);
    if (inline.length === 0) continue;
    errors.push({
      path: `/${key}`,
      message: inlineBodyRemovedMessage(key, inline),
    });
  }

  return errors;
}

export function validateJson(
  data: unknown,
  schemaType: SchemaType
): ValidationResult {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  const schema = loadSchema(schemaType);
  const validate = ajv.compile(schema);
  const valid = validate(data);

  if (valid) {
    return { valid: true, errors: [] };
  }

  const errors: ValidationError[] = (validate.errors || []).map((err) => ({
    path: err.instancePath || "/",
    message: err.message || "Unknown validation error",
  }));

  if (schemaType === "air") {
    const legacy = detectLegacyExcludeShape(data);
    if (legacy) {
      return {
        valid: false,
        errors: [legacy, ...errors.filter((e) => e.path !== "/exclude")],
      };
    }
  }

  if (schemaType === "plugins") {
    const inlineBodies = detectInlinePluginBodies(data);
    if (inlineBodies.length > 0) {
      // Drop only the raw `dependencies` errors these replace — every other
      // problem AJV found with the same entry (a missing description, a
      // malformed version) is still reported.
      const replaced = new Set(inlineBodies.map((e) => e.path));
      const rest = (validate.errors || [])
        .filter(
          (err) =>
            !(
              err.keyword === "dependencies" &&
              replaced.has(err.instancePath || "/")
            )
        )
        .map((err) => ({
          path: err.instancePath || "/",
          message: err.message || "Unknown validation error",
        }));
      return { valid: false, errors: [...inlineBodies, ...rest] };
    }
  }

  return { valid: false, errors };
}
