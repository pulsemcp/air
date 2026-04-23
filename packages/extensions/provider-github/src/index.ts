import type { AirExtension } from "@pulsemcp/air-core";
import { GitHubCatalogProvider } from "./github-provider.js";

export { GitHubCatalogProvider, parseGitHubUri, getCacheDir, getClonePath } from "./github-provider.js";
export type { GitHubUri, GitHubProviderOptions, GitProtocol } from "./github-provider.js";

const extension: AirExtension = {
  name: "github",
  provider: new GitHubCatalogProvider(),
};

export default extension;
