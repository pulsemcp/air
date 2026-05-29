import type { AirExtension } from "@pulsemcp/air-core";
import { PiAdapter } from "./pi-adapter.js";

export { PiAdapter } from "./pi-adapter.js";

const extension: AirExtension = {
  name: "pi",
  adapter: new PiAdapter(),
};

export default extension;
