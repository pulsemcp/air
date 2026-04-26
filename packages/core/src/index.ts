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
  LocalArtifacts,
  LocalSkillEntry,
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

// Scoped identity helpers
export {
  LOCAL_SCOPE,
  isQualified,
  qualifyId,
  parseQualifiedId,
  validateScope,
  deriveScope,
  buildShortnameIndex,
  lookupArtifactId,
  resolveReference,
} from "./scope.js";
export type { QualifiedId, ReferenceResolution } from "./scope.js";

// Scope stripping (powers `air resolve --no-scope`)
export { stripScopes, ShortnameCollisionError } from "./strip-scopes.js";
export type { ShortnameCollision } from "./strip-scopes.js";

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

// Manifest — tracks air-managed artifacts per target directory
export {
  MANIFEST_VERSION,
  getDefaultAirHome,
  getManifestPath,
  loadManifest,
  writeManifest,
  buildManifest,
  diffManifest,
} from "./manifest.js";
export type {
  Manifest,
  ManifestSelection,
  ManifestDiff,
} from "./manifest.js";
