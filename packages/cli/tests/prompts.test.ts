import { describe, it, expect } from "vitest";
import { isAffirmative } from "../src/prompts.js";

/**
 * `isAffirmative` decides whether an irreversible `npm install -g` runs, so
 * the rule is "only a clear yes", not "anything that isn't a clear no".
 */
describe("isAffirmative", () => {
  it("treats a bare Enter as yes — the [Y/n] contract", () => {
    expect(isAffirmative("")).toBe(true);
    expect(isAffirmative("   ")).toBe(true);
  });

  it("accepts y and yes, in any case and with surrounding space", () => {
    for (const answer of ["y", "Y", "yes", "YES", " Yes ", "yEs"]) {
      expect(isAffirmative(answer), answer).toBe(true);
    }
  });

  it("treats every other answer as no, including near-misses", () => {
    // The bug this guards: falling back to "yes" on unrecognised input, which
    // `promptYnd` does for auto-discovery, would confirm a version bump on a
    // stray keystroke or an answer that plainly means no.
    for (const answer of [
      "n",
      "N",
      "no",
      "NO",
      "nope",
      "cancel",
      "q",
      "quit",
      "abort",
      "x",
      "later",
      "yy",
      "ye",
      "y!",
      "0",
    ]) {
      expect(isAffirmative(answer), answer).toBe(false);
    }
  });
});
