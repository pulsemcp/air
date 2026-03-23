import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemasDir = resolve(__dirname, "../../../schemas");

export type SchemaType =
  | "air"
  | "skills"
  | "references"
  | "mcp"
  | "plugins"
  | "roots"
  | "hooks";

const SCHEMA_FILES: Record<SchemaType, string> = {
  air: "air.schema.json",
  skills: "skills.schema.json",
  references: "references.schema.json",
  mcp: "mcp.schema.json",
  plugins: "plugins.schema.json",
  roots: "roots.schema.json",
  hooks: "hooks.schema.json",
};

// Substrings to match against filenames (checked in order, longest first to avoid false matches)
const SCHEMA_SUBSTRINGS: [string, SchemaType][] = [
  ["references", "references"],
  ["plugins", "plugins"],
  ["skills", "skills"],
  ["roots", "roots"],
  ["hooks", "hooks"],
  ["mcp", "mcp"],
  ["air", "air"],
];

export function getSchemasDir(): string {
  return schemasDir;
}

export function getSchemaPath(type: SchemaType): string {
  return resolve(schemasDir, SCHEMA_FILES[type]);
}

export function loadSchema(type: SchemaType): object {
  const schemaPath = getSchemaPath(type);
  const content = readFileSync(schemaPath, "utf-8");
  return JSON.parse(content);
}

export function detectSchemaType(filename: string): SchemaType | null {
  // Match against the basename only (not the full path) to avoid false positives
  const basename = (filename.split("/").pop() || filename).toLowerCase();
  for (const [substring, type] of SCHEMA_SUBSTRINGS) {
    if (basename.includes(substring)) {
      return type;
    }
  }
  return null;
}

/**
 * Detect schema type from a $schema value in JSON content.
 * Looks for known schema filenames in the $schema URL/path.
 */
export function detectSchemaFromValue(schemaValue: string): SchemaType | null {
  const lower = schemaValue.toLowerCase();
  for (const type of getAllSchemaTypes()) {
    if (lower.includes(SCHEMA_FILES[type])) {
      return type;
    }
  }
  return null;
}

export function getAllSchemaTypes(): SchemaType[] {
  return Object.keys(SCHEMA_FILES) as SchemaType[];
}

export function isValidSchemaType(type: string): type is SchemaType {
  return type in SCHEMA_FILES;
}
