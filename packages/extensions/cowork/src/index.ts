import type { AirExtension } from "@pulsemcp/air-core";
import { CoworkEmitter } from "./cowork-emitter.js";

export { CoworkEmitter } from "./cowork-emitter.js";

const extension: AirExtension = {
  name: "cowork",
  emitter: new CoworkEmitter(),
};

export default extension;
