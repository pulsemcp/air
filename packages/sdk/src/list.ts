import {
  getAirJsonPath,
  resolveArtifacts,
  emptyArtifacts,
  type ResolvedArtifacts,
} from "@pulsemcp/air-core";

export type ArtifactType =
  | "skills"
  | "mcp"
  | "plugins"
  | "roots"
  | "hooks"
  | "references";

export const VALID_ARTIFACT_TYPES: readonly ArtifactType[] = [
  "skills",
  "mcp",
  "plugins",
  "roots",
  "hooks",
  "references",
] as const;

export interface ListArtifactsOptions {
  /** Path to air.json. Uses AIR_CONFIG env or ~/.air/air.json if not set. */
  config?: string;
}

export interface ListArtifactsResult {
  /** The requested artifact type. */
  type: ArtifactType;
  /** Entries of the requested type, keyed by ID. */
  entries: Record<string, unknown>;
  /** The full resolved artifacts (for consumers that need cross-type access). */
  artifacts: ResolvedArtifacts;
}

/**
 * Resolve artifacts and return the entries for a specific artifact type.
 *
 * @throws Error if the artifact type is invalid.
 */
export async function listArtifacts(
  type: string,
  options?: ListArtifactsOptions
): Promise<ListArtifactsResult> {
  if (!VALID_ARTIFACT_TYPES.includes(type as ArtifactType)) {
    throw new Error(
      `Unknown artifact type "${type}". Valid types: ${VALID_ARTIFACT_TYPES.join(", ")}`
    );
  }

  const airJsonPath = options?.config || getAirJsonPath();
  const artifacts = airJsonPath
    ? await resolveArtifacts(airJsonPath)
    : emptyArtifacts();

  const artifactType = type as ArtifactType;

  return {
    type: artifactType,
    entries: artifacts[artifactType],
    artifacts,
  };
}
