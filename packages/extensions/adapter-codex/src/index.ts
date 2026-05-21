import type { AirExtension } from "@pulsemcp/air-core";
import { CodexAdapter } from "./codex-adapter.js";

export { CodexAdapter } from "./codex-adapter.js";

const extension: AirExtension = {
  name: "codex",
  adapter: new CodexAdapter(),
};

export default extension;
