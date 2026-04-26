import Ajv from "ajv";
import addFormats from "ajv-formats";
import { loadSchema, type SchemaType } from "./schemas.js";

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

  return { valid: false, errors };
}
