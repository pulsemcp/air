import { readFileSync, existsSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the schemas directory.
 * In development: ../schemas (relative to src/)
 * In published package: ../schemas (copied by prepare script)
 * Fallback: ../../schemas (monorepo root)
 */
function findSchemasDir(): string {
  // Check sibling of dist/ or src/ (published package or local dev)
  const localSchemas = resolve(__dirname, "../schemas");
  if (existsSync(localSchemas)) {
    return localSchemas;
  }
  // Fallback: monorepo root schemas/
  const monorepoSchemas = resolve(__dirname, "../../../schemas");
  if (existsSync(monorepoSchemas)) {
    return monorepoSchemas;
  }
  throw new Error(
    "Could not find AIR schemas directory. Checked:\n" +
      `  ${localSchemas}\n` +
      `  ${monorepoSchemas}`
  );
}

const schemasDir = findSchemasDir();

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

// Patterns to match against the basename stem (filename without .json extension).
// Each keyword must appear as a whole word delimited by start/end or a separator (. - _).
// Checked longest-first to avoid shorter prefixes shadowing longer ones.
const SCHEMA_PATTERNS: [RegExp, SchemaType][] = [
  [/(?:^|[._-])references(?:[._-]|$)/, "references"],
  [/(?:^|[._-])plugins(?:[._-]|$)/, "plugins"],
  [/(?:^|[._-])skills(?:[._-]|$)/, "skills"],
  [/(?:^|[._-])roots(?:[._-]|$)/, "roots"],
  [/(?:^|[._-])hooks(?:[._-]|$)/, "hooks"],
  [/(?:^|[._-])mcp(?:[._-]|$)/, "mcp"],
  [/(?:^|[._-])air(?:[._-]|$)/, "air"],
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
  const basename = (filename.split("/").pop() || filename).toLowerCase();
  if (basename.endsWith(".schema.json")) return null;
  const stem = basename.replace(/\.json$/, "");
  for (const [pattern, type] of SCHEMA_PATTERNS) {
    if (pattern.test(stem)) {
      return type;
    }
  }
  return null;
}

/**
 * Detect schema type from a $schema value in JSON content.
 *
 * Matches the last path segment only (before any ?query or #fragment), so
 * arbitrary URLs that happen to contain a schema filename earlier in their
 * path — e.g. a third-party `https://example.com/mcp.schema.json/something` —
 * are NOT misclassified as AIR indexes.
 */
export function detectSchemaFromValue(schemaValue: string): SchemaType | null {
  const withoutQuery = schemaValue.split(/[?#]/, 1)[0];
  const basename = (withoutQuery.split(/[\\/]/).pop() || "").toLowerCase();
  for (const type of getAllSchemaTypes()) {
    if (basename === SCHEMA_FILES[type]) {
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
