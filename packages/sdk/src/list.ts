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

export const VALID_ARTIFACT_TYPES: ArtifactType[] = [
  "skills",
  "mcp",
  "plugins",
  "roots",
  "hooks",
  "references",
];

export interface ListArtifactsOptions {
  /** Path to air.json. Uses AIR_CONFIG env or ~/.air/air.json if not set. */
  config?: string;
}

/**
 * Resolve artifacts and return the entries for a specific artifact type.
 *
 * @throws Error if the artifact type is invalid.
 */
export async function listArtifacts(
  type: string,
  options?: ListArtifactsOptions
): Promise<ResolvedArtifacts> {
  if (!VALID_ARTIFACT_TYPES.includes(type as ArtifactType)) {
    throw new Error(
      `Unknown artifact type "${type}". Valid types: ${VALID_ARTIFACT_TYPES.join(", ")}`
    );
  }

  const airJsonPath = options?.config ?? getAirJsonPath();
  return airJsonPath
    ? await resolveArtifacts(airJsonPath)
    : emptyArtifacts();
}
