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
  PrepareSessionOptions as CorePrepareSessionOptions,
  PreparedSession,
  LocalArtifacts,
  LocalSkillEntry,
  // Validation types
  ValidationResult,
  ValidationError,
  // Config types
  ResolveOptions,
  // Schema types
  SchemaType,
} from "@pulsemcp/air-core";

// Adapter registry
export {
  findAdapter,
  listAvailableAdapters,
  type FindAdapterOptions,
} from "./adapter-registry.js";

// Root detection
export { normalizeGitUrl, detectRoot } from "./root-detection.js";

// High-level operations
export { validateFile } from "./validate.js";
export type { ValidateFileOptions, ValidateFileResult } from "./validate.js";

export { initConfig } from "./init.js";
export type {
  InitConfigOptions,
  InitConfigResult,
  ScaffoldedFile,
} from "./init.js";

export { initFromRepo, smartInit, InitFromRepoError } from "./init-from-repo.js";
export type {
  InitFromRepoOptions,
  InitFromRepoResult,
  InitFromRepoErrorCode,
  DiscoveredArtifact,
  SmartInitResult,
} from "./init-from-repo.js";

export { listArtifacts, VALID_ARTIFACT_TYPES } from "./list.js";
export type { ArtifactType, ListArtifactsOptions, ListArtifactsResult } from "./list.js";

export { startSession } from "./start.js";
export type { StartSessionOptions, StartSessionResult } from "./start.js";

export {
  prepareSession,
  computeMergedDefaults,
  resolveCategoryOverride,
} from "./prepare.js";
export type {
  PrepareSessionOptions,
  PrepareSessionResult,
  MergedArtifactDefaults,
} from "./prepare.js";

export { exportMarketplace } from "./export-marketplace.js";
export type {
  ExportMarketplaceOptions,
  ExportMarketplaceResult,
} from "./export-marketplace.js";

// Extension installer
export { installExtensions } from "./install.js";
export type {
  InstallExtensionsOptions,
  InstallExtensionsResult,
} from "./install.js";

// Extension loader
export { loadExtensions } from "./extension-loader.js";
export type { LoadedExtensions } from "./extension-loader.js";

// Transform runner
export { runTransforms } from "./transform-runner.js";
export type { RunTransformsOptions } from "./transform-runner.js";

// Provider cache management
export { updateProviderCaches } from "./update.js";
export type {
  UpdateProviderCachesOptions,
  UpdateProviderCachesResult,
} from "./update.js";

// Cache freshness checking
export { checkProviderFreshness } from "./cache-freshness.js";

// Config validation
export {
  findUnresolvedVars,
  findUnresolvedHookVars,
  validateNoUnresolvedVars,
  unresolvedVarsMessage,
} from "./validate-config.js";
