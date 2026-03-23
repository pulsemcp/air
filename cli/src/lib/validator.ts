import Ajv from "ajv";
import addFormats from "ajv-formats";
import { loadSchema, type SchemaType } from "./schemas.js";

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  path: string;
  message: string;
}

export function validateJson(
  data: unknown,
  schemaType: SchemaType
): ValidationResult {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  const schema = loadSchema(schemaType);
  const validate = ajv.compile(schema);
  const valid = validate(data);

  if (valid) {
    return { valid: true, errors: [] };
  }

  const errors: ValidationError[] = (validate.errors || []).map((err) => ({
    path: err.instancePath || "/",
    message: err.message || "Unknown validation error",
  }));

  return { valid: false, errors };
}
