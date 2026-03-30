import type { AirExtension } from "@pulsemcp/air-core";
import { GitHubCatalogProvider } from "./github-provider.js";

export { GitHubCatalogProvider, parseGitHubUri, getCacheDir } from "./github-provider.js";
export type { GitHubUri } from "./github-provider.js";

const extension: AirExtension = {
  name: "github",
  type: "provider",
  provider: new GitHubCatalogProvider(),
};

export default extension;
