import type { AirExtension } from "@pulsemcp/air-core";
import { fileTransform } from "./file-transform.js";

export { fileTransform } from "./file-transform.js";

const extension: AirExtension = {
  name: "secrets-file",
  transform: { transform: fileTransform },
  prepareOptions: [
    {
      flag: "--secrets-file <path>",
      description:
        "Path to a JSON file containing secret values for ${VAR} interpolation",
    },
  ],
};

export default extension;
