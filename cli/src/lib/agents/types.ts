import type { ResolvedArtifacts, RootEntry } from "../config.js";

export type AgentType = "claude" | "opencode" | "cursor" | "pi";

export const SUPPORTED_AGENTS: AgentType[] = ["claude"];

export const COMING_SOON_AGENTS: AgentType[] = ["opencode", "cursor", "pi"];

export const ALL_AGENTS: AgentType[] = [
  ...SUPPORTED_AGENTS,
  ...COMING_SOON_AGENTS,
];

export interface AgentAdapter {
  name: AgentType;
  displayName: string;

  /** Check if the agent is installed and available */
  isAvailable(): Promise<boolean>;

  /** Generate agent-specific configuration files */
  generateConfig(
    artifacts: ResolvedArtifacts,
    root?: RootEntry,
    workDir?: string
  ): AgentSessionConfig;

  /** Build the command to start the agent */
  buildStartCommand(config: AgentSessionConfig): StartCommand;
}

export interface AgentSessionConfig {
  agent: AgentType;
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

export function isAgentSupported(agent: string): agent is AgentType {
  return SUPPORTED_AGENTS.includes(agent as AgentType);
}

export function isAgentKnown(agent: string): boolean {
  return ALL_AGENTS.includes(agent as AgentType);
}
