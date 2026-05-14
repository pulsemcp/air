/**
 * Deep-merge a consumer's `x-config` overlay onto a base value pulled from
 * the materialized HOOK.json. Pure function — no I/O, no env interpolation.
 *
 * Merge rules:
 *   - Two plain objects merge recursively, overlay wins on per-key conflict.
 *   - Arrays in the overlay replace the base array entirely (no concat).
 *   - Scalars and mismatched-shape values in the overlay replace the base.
 *   - `undefined` overlay returns the base unchanged; `undefined` base returns
 *     the overlay unchanged. Either side may be absent.
 *
 * Returns a new value — neither input is mutated.
 */
export function mergeXConfig(base: unknown, overlay: unknown): unknown {
  if (overlay === undefined) return base;
  if (base === undefined) return overlay;

  if (!isPlainObject(base) || !isPlainObject(overlay)) {
    // Arrays, scalars, nulls, or shape mismatches: overlay replaces wholesale.
    return overlay;
  }

  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    result[key] = mergeXConfig(result[key], value);
  }
  return result;
}

/**
 * True for non-array, non-null plain object values. Arrays and nulls are
 * intentionally excluded — they are leaf values for merge purposes.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value)
  );
}
