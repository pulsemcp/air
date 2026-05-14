import { describe, it, expect } from "vitest";
import { mergeXConfig } from "../src/x-config.js";

describe("mergeXConfig", () => {
  describe("absent inputs", () => {
    it("returns base when overlay is undefined", () => {
      expect(mergeXConfig({ a: 1 }, undefined)).toEqual({ a: 1 });
    });

    it("returns overlay when base is undefined", () => {
      expect(mergeXConfig(undefined, { a: 1 })).toEqual({ a: 1 });
    });

    it("returns undefined when both are undefined", () => {
      expect(mergeXConfig(undefined, undefined)).toBeUndefined();
    });
  });

  describe("scalar replacement", () => {
    it("overlay scalar replaces base scalar", () => {
      expect(mergeXConfig("foo", "bar")).toBe("bar");
      expect(mergeXConfig(1, 2)).toBe(2);
      expect(mergeXConfig(true, false)).toBe(false);
    });

    it("overlay scalar replaces base object", () => {
      expect(mergeXConfig({ a: 1 }, "bar")).toBe("bar");
    });

    it("overlay object replaces base scalar", () => {
      expect(mergeXConfig("foo", { a: 1 })).toEqual({ a: 1 });
    });

    it("overlay null replaces base value", () => {
      expect(mergeXConfig({ a: 1 }, null)).toBeNull();
    });
  });

  describe("array replacement", () => {
    it("overlay array replaces base array entirely (no concat)", () => {
      expect(mergeXConfig([1, 2, 3], [4, 5])).toEqual([4, 5]);
    });

    it("overlay array replaces base object", () => {
      expect(mergeXConfig({ a: 1 }, [1, 2])).toEqual([1, 2]);
    });

    it("overlay object replaces base array", () => {
      expect(mergeXConfig([1, 2], { a: 1 })).toEqual({ a: 1 });
    });

    it("nested arrays inside objects are replaced, not merged", () => {
      const merged = mergeXConfig(
        { tags: ["a", "b"], extra: 1 },
        { tags: ["c"] }
      );
      expect(merged).toEqual({ tags: ["c"], extra: 1 });
    });
  });

  describe("object deep merge", () => {
    it("merges disjoint top-level keys", () => {
      expect(mergeXConfig({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
    });

    it("overlay key wins on flat scalar conflict", () => {
      expect(mergeXConfig({ a: 1, b: 2 }, { b: 3 })).toEqual({ a: 1, b: 3 });
    });

    it("recursively merges nested objects", () => {
      const base = { outer: { a: 1, b: 2 }, untouched: "x" };
      const overlay = { outer: { b: 99, c: 3 } };
      expect(mergeXConfig(base, overlay)).toEqual({
        outer: { a: 1, b: 99, c: 3 },
        untouched: "x",
      });
    });

    it("merges three levels deep", () => {
      const base = { l1: { l2: { l3: { a: 1, b: 2 } } } };
      const overlay = { l1: { l2: { l3: { b: 99, c: 3 } } } };
      expect(mergeXConfig(base, overlay)).toEqual({
        l1: { l2: { l3: { a: 1, b: 99, c: 3 } } },
      });
    });
  });

  describe("immutability", () => {
    it("does not mutate the base input", () => {
      const base = { a: { b: 1 }, c: [1, 2] };
      const overlay = { a: { b: 99, d: 3 } };
      mergeXConfig(base, overlay);
      expect(base).toEqual({ a: { b: 1 }, c: [1, 2] });
    });

    it("does not mutate the overlay input", () => {
      const base = { a: { b: 1 } };
      const overlay = { a: { b: 99, d: 3 } };
      mergeXConfig(base, overlay);
      expect(overlay).toEqual({ a: { b: 99, d: 3 } });
    });
  });
});
