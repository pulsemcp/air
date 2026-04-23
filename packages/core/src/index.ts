// Artifact types
export type {
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
} from "./types.js";

// Extension interfaces
export type {
  AgentAdapter,
  CatalogProvider,
  CacheFreshnessWarning,
  CacheRefreshResult,
  AirExtension,
  PrepareTransform,
  PluginEmitter,
  BuildMarketplaceOptions,
  BuiltPlugin,
  BuiltMarketplace,
  McpConfig,
  TransformContext,
  ExtensionCliOption,
  AgentSessionConfig,
  StartCommand,
  PrepareSessionOptions,
  PreparedSession,
} from "./types.js";

// Config resolution
export {
  loadAirConfig,
  getDefaultAirJsonPath,
  getAirJsonPath,
  resolveArtifacts,
  mergeArtifacts,
  expandPlugins,
  emptyArtifacts,
  configureProviders,
} from "./config.js";
export type { ResolveOptions } from "./config.js";

// Validation
export { validateJson } from "./validator.js";
export type { ValidationResult, ValidationError } from "./validator.js";

// Schemas
export {
  getSchemasDir,
  getSchemaPath,
  loadSchema,
  detectSchemaType,
  detectSchemaFromValue,
  getAllSchemaTypes,
  isValidSchemaType,
} from "./schemas.js";
export type { SchemaType } from "./schemas.js";
