import { readFileSync } from "fs";
import { resolve } from "path";
import {
  detectSchemaType,
  detectSchemaFromValue,
  isValidSchemaType,
  validateJson,
  type SchemaType,
  type ValidationResult,
} from "@pulsemcp/air-core";

export interface ValidateFileOptions {
  /** Override schema type detection. */
  schema?: string;
  /** Base directory for resolving relative file paths. Defaults to process.cwd(). */
  cwd?: string;
}

export interface ValidateFileResult {
  /** Whether the file is valid against the detected/specified schema. */
  valid: boolean;
  /** The schema type used for validation. */
  schemaType: SchemaType;
  /** Validation result from core (includes errors if invalid). */
  validation: ValidationResult;
}

/**
 * Validate a JSON file against its AIR schema.
 *
 * Schema detection order:
 * 1. Explicit `options.schema` override
 * 2. `$schema` field in the JSON content
 * 3. Filename substring matching
 *
 * @throws Error if the file cannot be read/parsed, schema type is invalid, or schema cannot be detected.
 */
export function validateFile(
  file: string,
  options?: ValidateFileOptions
): ValidateFileResult {
  const cwd = options?.cwd ?? process.cwd();
  const filePath = resolve(cwd, file);

  let data: unknown;
  try {
    const content = readFileSync(filePath, "utf-8");
    data = JSON.parse(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    throw new Error(`Could not read or parse "${file}": ${message}`);
  }

  // Determine schema type: explicit option > $schema in JSON > filename substring
  let schemaType: SchemaType | null = null;

  if (options?.schema) {
    if (!isValidSchemaType(options.schema)) {
      throw new Error(
        `Unknown schema type "${options.schema}". Valid types: air, skills, references, mcp, plugins, roots, hooks`
      );
    }
    schemaType = options.schema;
  }

  if (
    !schemaType &&
    data &&
    typeof data === "object" &&
    !Array.isArray(data)
  ) {
    const schemaValue = (data as Record<string, unknown>).$schema;
    if (typeof schemaValue === "string") {
      schemaType = detectSchemaFromValue(schemaValue);
    }
  }

  if (!schemaType) {
    schemaType = detectSchemaType(file);
  }

  if (!schemaType) {
    throw new Error(
      `Could not detect schema type for "${file}". Specify a schema type explicitly.`
    );
  }

  const validation = validateJson(data, schemaType);

  return {
    valid: validation.valid,
    schemaType,
    validation,
  };
}
