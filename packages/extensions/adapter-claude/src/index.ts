import type { AirExtension } from "@pulsemcp/air-core";
import { ClaudeAdapter } from "./claude-adapter.js";

export { ClaudeAdapter } from "./claude-adapter.js";

const extension: AirExtension = {
  name: "claude",
  type: "adapter",
  adapter: new ClaudeAdapter(),
};

export default extension;
