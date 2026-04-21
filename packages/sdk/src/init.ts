import { writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import {
  getAllSchemaTypes,
  getDefaultAirJsonPath,
  type SchemaType,
} from "@pulsemcp/air-core";

export interface InitConfigOptions {
  /** Override the default air.json path (~/.air/air.json). */
  path?: string;
}

export interface ScaffoldedFile {
  /** Absolute path to the file that was created. */
  path: string;
  /** What kind of file this is. Index files are keyed by their schema type. */
  kind: "air" | "readme" | SchemaType;
}

export interface InitConfigResult {
  /** Absolute path to the created air.json. */
  airJsonPath: string;
  /** Absolute path to the AIR config directory. */
  airDir: string;
  /** All files created by this init, in creation order. */
  scaffolded: ScaffoldedFile[];
}

const SCHEMA_BASE_URL =
  "https://raw.githubusercontent.com/pulsemcp/air/main/schemas";

/** Artifact types that get their own index file and air.json entry. */
const ARTIFACT_TYPES: Exclude<SchemaType, "air">[] = getAllSchemaTypes().filter(
  (t): t is Exclude<SchemaType, "air"> => t !== "air"
);

function indexFileRelPath(type: Exclude<SchemaType, "air">): string {
  return `${type}/${type}.json`;
}

function buildAirJson(): Record<string, unknown> {
  const airJson: Record<string, unknown> = {
    $schema: `${SCHEMA_BASE_URL}/air.schema.json`,
    name: "my-config",
    description: "Personal AIR configuration",
  };
  for (const type of ARTIFACT_TYPES) {
    airJson[type] = [`./${indexFileRelPath(type)}`];
  }
  return airJson;
}

function buildIndexFile(type: Exclude<SchemaType, "air">): string {
  const body = {
    $schema: `${SCHEMA_BASE_URL}/${type}.schema.json`,
  };
  return JSON.stringify(body, null, 2) + "\n";
}

function buildReadme(): string {
  return `# My AIR configuration

This directory is your personal AIR composition point. \`air.json\` references
the six index files below — add entries to those files and they become
available to any session started via \`air start\`.

## Layout

\`\`\`
air.json                       # composition — references the indexes below
skills/skills.json             # skills (invocable units of work)
references/references.json     # shared reference docs attached to skills
mcp/mcp.json                   # MCP server connection configs
plugins/plugins.json           # named groupings of skills + MCP servers + hooks
roots/roots.json               # agent roots (per-domain workspaces)
hooks/hooks.json               # lifecycle hooks
\`\`\`

Every index file has a \`$schema\` reference, so editors like VS Code and
JetBrains give you autocomplete and inline validation as you type.

## Adding your first MCP server

Open \`mcp/mcp.json\` and add an entry keyed by the server name:

\`\`\`json
{
  "$schema": "${SCHEMA_BASE_URL}/mcp.schema.json",
  "github": {
    "title": "GitHub",
    "description": "Create and manage issues, PRs, and files in GitHub.",
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github@0.6.2"],
    "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "\${GITHUB_PERSONAL_ACCESS_TOKEN}" }
  }
}
\`\`\`

## Adding your first skill

Skills live as directories containing a \`SKILL.md\`. Point at one from
\`skills/skills.json\`:

\`\`\`json
{
  "$schema": "${SCHEMA_BASE_URL}/skills.schema.json",
  "deploy-staging": {
    "title": "Deploy to Staging",
    "description": "Deploy the current PR branch to staging for testing.",
    "path": "skills/deploy-staging"
  }
}
\`\`\`

## Adding remote catalogs

Each array in \`air.json\` can mix local paths with remote URIs. Append a
\`github://\` entry after your local index to layer a team or org catalog on
top — later entries override earlier ones by ID:

\`\`\`json
{
  "skills": [
    "./skills/skills.json",
    "github://acme/shared-air-config/skills/skills.json"
  ]
}
\`\`\`

(Remote URIs require an appropriate catalog provider extension to be
installed, e.g. \`@pulsemcp/air-provider-github\`.)

## Next steps

- **\`air validate ~/.air/air.json\`** — check your config against the schemas.
- **\`air list\`** — see every artifact AIR has resolved.
- **\`air start <agent>\`** — start a session with your config loaded.

See the full docs at https://github.com/pulsemcp/air/tree/main/docs/guides.
`;
}

/**
 * Initialize a new AIR configuration directory.
 *
 * Scaffolds a ready-to-edit workspace: `air.json` pre-wired to six local
 * index files (one per artifact type), each containing a `$schema` reference
 * so editors give autocomplete out of the box, plus a README orienting the
 * user to the layout.
 *
 * @throws Error if air.json already exists at the target path.
 */
export function initConfig(options?: InitConfigOptions): InitConfigResult {
  const airJsonPath = options?.path ?? getDefaultAirJsonPath();
  const airDir = dirname(airJsonPath);

  if (existsSync(airJsonPath)) {
    throw new Error(`${airJsonPath} already exists.`);
  }

  mkdirSync(airDir, { recursive: true });

  const scaffolded: ScaffoldedFile[] = [];

  writeFileSync(airJsonPath, JSON.stringify(buildAirJson(), null, 2) + "\n");
  scaffolded.push({ path: airJsonPath, kind: "air" });

  for (const type of ARTIFACT_TYPES) {
    const rel = indexFileRelPath(type);
    const abs = resolve(airDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    if (!existsSync(abs)) {
      writeFileSync(abs, buildIndexFile(type));
      scaffolded.push({ path: abs, kind: type });
    }
  }

  const readmePath = resolve(airDir, "README.md");
  if (!existsSync(readmePath)) {
    writeFileSync(readmePath, buildReadme());
    scaffolded.push({ path: readmePath, kind: "readme" });
  }

  return { airJsonPath, airDir, scaffolded };
}
