import type { AirExtension } from "@pulsemcp/air-core";
import { CursorAdapter } from "./cursor-adapter.js";

export { CursorAdapter } from "./cursor-adapter.js";

const extension: AirExtension = {
  name: "cursor",
  adapter: new CursorAdapter(),
};

export default extension;
