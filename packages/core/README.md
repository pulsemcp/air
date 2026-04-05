# @pulsemcp/air-core

Core package for the [AIR](https://github.com/pulsemcp/air) framework. Provides config resolution, validation, JSON schemas, and extension interfaces.

## Installation

```bash
npm install @pulsemcp/air-core
```

## Usage

```typescript
import {
  resolveArtifacts,
  validateJson,
  mergeArtifacts,
  emptyArtifacts,
} from "@pulsemcp/air-core";

// Resolve all artifacts from an air.json file
const artifacts = await resolveArtifacts("~/.air/air.json");

// Validate a JSON file against its AIR schema
const result = validateJson(data, "skills");

// Merge two artifact sets (later wins for matching IDs)
const merged = mergeArtifacts(base, override);
```

### With a Catalog Provider (remote URIs)

```typescript
import { resolveArtifacts } from "@pulsemcp/air-core";
import { GitHubCatalogProvider } from "@pulsemcp/air-provider-github";

const artifacts = await resolveArtifacts("./air.json", {
  providers: [new GitHubCatalogProvider()],
});
```

## What's in this package

- **Config resolution** — `resolveArtifacts()`, `loadAirConfig()`, `mergeArtifacts()`, `emptyArtifacts()`
- **Validation** — `validateJson()` using AJV against AIR JSON Schemas
- **Schema utilities** — `loadSchema()`, `detectSchemaType()`, `detectSchemaFromValue()`
- **All artifact types** — `SkillEntry`, `McpServerEntry`, `RootEntry`, `ReferenceEntry`, `PluginEntry`, `HookEntry`
- **Extension interfaces** — `AgentAdapter`, `CatalogProvider`, `SecretResolver`, `AirExtension`
- **Session types** — `AgentSessionConfig`, `StartCommand`, `PrepareSessionOptions`, `PreparedSession`

## Extension Interfaces

Core defines four extension points that other packages implement:

| Interface | Purpose | Example |
|-----------|---------|---------|
| `AgentAdapter` | Translate AIR config for a specific agent | `@pulsemcp/air-adapter-claude` |
| `CatalogProvider` | Resolve remote URIs in air.json | `@pulsemcp/air-provider-github` |
| `SecretResolver` | Resolve `${VAR}` interpolation | Custom vault integrations |
| `AirExtension` | Extension metadata for CLI discovery | All extension packages |
