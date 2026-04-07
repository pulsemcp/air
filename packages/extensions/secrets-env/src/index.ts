import type { AirExtension } from "@pulsemcp/air-core";
import { envTransform } from "./env-transform.js";

export { envTransform } from "./env-transform.js";

const extension: AirExtension = {
  name: "secrets-env",
  transform: { transform: envTransform },
};

export default extension;
