// ============================================================
// Artifact types — the data shapes for all AIR artifact indexes
// ============================================================

export interface AirConfig {
  name: string;
  description?: string;
  skills?: string[];
  references?: string[];
  mcp?: string[];
  plugins?: string[];
  roots?: string[];
  hooks?: string[];
}

export interface ResolvedArtifacts {
  skills: Record<string, SkillEntry>;
  references: Record<string, ReferenceEntry>;
  mcp: Record<string, McpServerEntry>;
  plugins: Record<string, PluginEntry>;
  roots: Record<string, RootEntry>;
  hooks: Record<string, HookEntry>;
}

export interface SkillEntry {
  id: string;
  title?: string;
  description: string;
  path: string;
  references?: string[];
}

export interface ReferenceEntry {
  id: string;
  title?: string;
  description: string;
  file: string;
}

export interface McpOAuthConfig {
  clientId?: string;
  scopes?: string[];
  redirectUri?: string;
}

export interface McpServerEntry {
  title?: string;
  description?: string;
  type: "stdio" | "sse" | "streamable-http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  oauth?: McpOAuthConfig;
}

export interface PluginAuthor {
  name?: string;
  email?: string;
  url?: string;
}

export interface PluginEntry {
  id: string;
  title?: string;
  description: string;
  version?: string;
  skills?: string[];
  mcp_servers?: string[];
  hooks?: string[];
  author?: PluginAuthor;
  homepage?: string;
  repository?: string;
  license?: string;
  logo?: string;
  keywords?: string[];
}

export interface RootEntry {
  name: string;
  display_name?: string;
  description: string;
  url?: string;
  default_branch?: string;
  subdirectory?: string;
  default_mcp_servers?: string[];
  default_skills?: string[];
  default_plugins?: string[];
  default_hooks?: string[];
  user_invocable?: boolean;
  default_stop_condition?: string;
}

export interface HookEntry {
  id: string;
  title?: string;
  description: string;
  event: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeout_seconds?: number;
  matcher?: string;
}

// ============================================================
// Extension interfaces — the contracts extensions implement
// ============================================================

/**
 * Agent Adapter — translates AIR artifacts into agent-specific config
 * and knows how to start the agent process.
 *
 * Implementations: @pulsemcp/air-adapter-claude, etc.
 */
export interface AgentAdapter {
  /** Unique name for this adapter (e.g., "claude", "opencode") */
  name: string;
  /** Human-readable display name (e.g., "Claude Code") */
  displayName: string;
  /** Check if the agent CLI is installed and available */
  isAvailable(): Promise<boolean>;
  /** Translate resolved AIR artifacts into agent-specific session config */
  generateConfig(
    artifacts: ResolvedArtifacts,
    root?: RootEntry,
    workDir?: string
  ): AgentSessionConfig;
  /** Build the shell command to start the agent */
  buildStartCommand(config: AgentSessionConfig): StartCommand;

  /**
   * Prepare a working directory for an agent session.
   * Writes all files the agent needs: MCP config, skills, hooks, plugins.
   * This is the single entry point for session setup — the adapter owns
   * the full "make this directory ready for my agent" contract.
   */
  prepareSession(
    artifacts: ResolvedArtifacts,
    targetDir: string,
    options?: PrepareSessionOptions
  ): Promise<PreparedSession>;
}

export interface PrepareSessionOptions {
  /** Root to filter artifacts by (uses root's default_* arrays) */
  root?: RootEntry;
  /** Secret resolvers for ${VAR} interpolation in MCP configs */
  secretResolvers?: SecretResolver[];
  /**
   * Override the root's default_skills — only activate these specific skills.
   * When set, this replaces root.default_skills entirely.
   */
  skillOverrides?: string[];
  /**
   * Override the root's default_mcp_servers — only activate these specific servers.
   * When set, this replaces root.default_mcp_servers entirely.
   */
  mcpServerOverrides?: string[];
}

export interface PreparedSession {
  /** Paths to config files written (e.g., ".mcp.json") */
  configFiles: string[];
  /** Paths to skill directories created */
  skillPaths: string[];
  /** The command to start the agent in the prepared directory */
  startCommand: StartCommand;
}

/**
 * Catalog Provider — resolves remote artifact index URIs.
 *
 * Core handles local filesystem paths (no scheme or file://).
 * Providers handle other schemes: github://, s3://, https://, etc.
 *
 * Implementations: @pulsemcp/air-provider-github, etc.
 */
export interface CatalogProvider {
  /** URI scheme this provider handles (e.g., "github", "s3") */
  scheme: string;
  /** Resolve a URI to parsed JSON content */
  resolve(uri: string, baseDir: string): Promise<Record<string, unknown>>;
  /**
   * Return the local directory where files from this URI's source can be found.
   * For git-based providers, this is the clone directory.
   * Used by loadAndMerge to resolve relative path/file fields in artifact entries
   * to absolute paths. Returns undefined if the source isn't locally available.
   */
  resolveSourceDir?(uri: string): string | undefined;
}

/**
 * Secret Resolver — resolves ${VAR} interpolation in config values.
 *
 * Adapters accept an array of SecretResolver instances and try them
 * in order. Extensions can implement resolvers for process.env,
 * 1Password, Vault, AWS Secrets Manager, etc.
 */
export interface SecretResolver {
  /** Unique name for this resolver (e.g., "env", "1password") */
  name: string;
  /** Resolve a key to its secret value. Returns undefined if not found. */
  resolve(key: string): Promise<string | undefined>;
}

/**
 * Extension metadata — the shape every AIR extension package default-exports.
 * Used by the CLI for adapter/provider discovery.
 */
export interface AirExtension {
  name: string;
  type: "adapter" | "provider" | "secret-resolver";
  adapter?: AgentAdapter;
  provider?: CatalogProvider;
  secretResolver?: SecretResolver;
}

// ============================================================
// Session types — used by adapters to describe agent sessions
// ============================================================

export interface AgentSessionConfig {
  agent: string;
  mcpConfig?: Record<string, unknown>;
  pluginConfigs?: Record<string, unknown>[];
  hookConfigs?: Record<string, unknown>[];
  skillPaths?: string[];
  workDir?: string;
  env?: Record<string, string>;
}

export interface StartCommand {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
}
