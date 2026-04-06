// Re-export everything from core for convenience
export {
  // Config resolution
  loadAirConfig,
  getDefaultAirJsonPath,
  getAirJsonPath,
  resolveArtifacts,
  mergeArtifacts,
  expandPlugins,
  emptyArtifacts,
  // Validation
  validateJson,
  // Schemas
  getSchemasDir,
  getSchemaPath,
  loadSchema,
  detectSchemaType,
  detectSchemaFromValue,
  getAllSchemaTypes,
  isValidSchemaType,
} from "@pulsemcp/air-core";

// Re-export core types
export type {
  // Artifact types
  AirConfig,
  ResolvedArtifacts,
  SkillEntry,
  ReferenceEntry,
  McpOAuthConfig,
  McpServerEntry,
  PluginAuthor,
  PluginEntry,
  RootEntry,
  HookEntry,
  // Extension interfaces
  AgentAdapter,
  CatalogProvider,
  SecretResolver,
  AirExtension,
  AgentSessionConfig,
  StartCommand,
  PrepareSessionOptions as CorePrepareSessionOptions,
  PreparedSession,
  // Validation types
  ValidationResult,
  ValidationError,
  // Config types
  ResolveOptions,
  // Schema types
  SchemaType,
} from "@pulsemcp/air-core";

// Adapter registry
export { findAdapter, listAvailableAdapters } from "./adapter-registry.js";

// Root detection
export { normalizeGitUrl, detectRoot } from "./root-detection.js";

// High-level operations
export { validateFile } from "./validate.js";
export type { ValidateFileOptions, ValidateFileResult } from "./validate.js";

export { initConfig } from "./init.js";
export type { InitConfigOptions, InitConfigResult } from "./init.js";

export { listArtifacts, VALID_ARTIFACT_TYPES } from "./list.js";
export type { ArtifactType, ListArtifactsOptions, ListArtifactsResult } from "./list.js";

export { startSession } from "./start.js";
export type { StartSessionOptions, StartSessionResult } from "./start.js";

export { prepareSession } from "./prepare.js";
export type {
  PrepareSessionOptions,
  PrepareSessionResult,
} from "./prepare.js";
