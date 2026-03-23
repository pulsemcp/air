import { describe, it, expect } from "vitest";
import {
  isAgentSupported,
  isAgentKnown,
  SUPPORTED_AGENTS,
  COMING_SOON_AGENTS,
  ALL_AGENTS,
} from "../src/lib/agents/types.js";

describe("Agent Types", () => {
  describe("SUPPORTED_AGENTS", () => {
    it("includes claude", () => {
      expect(SUPPORTED_AGENTS).toContain("claude");
    });

    it("does not include coming soon agents", () => {
      for (const agent of COMING_SOON_AGENTS) {
        expect(SUPPORTED_AGENTS).not.toContain(agent);
      }
    });
  });

  describe("COMING_SOON_AGENTS", () => {
    it("includes opencode, cursor, pi", () => {
      expect(COMING_SOON_AGENTS).toContain("opencode");
      expect(COMING_SOON_AGENTS).toContain("cursor");
      expect(COMING_SOON_AGENTS).toContain("pi");
    });
  });

  describe("ALL_AGENTS", () => {
    it("is the union of supported and coming soon", () => {
      expect(ALL_AGENTS).toHaveLength(
        SUPPORTED_AGENTS.length + COMING_SOON_AGENTS.length
      );
      for (const agent of SUPPORTED_AGENTS) {
        expect(ALL_AGENTS).toContain(agent);
      }
      for (const agent of COMING_SOON_AGENTS) {
        expect(ALL_AGENTS).toContain(agent);
      }
    });
  });

  describe("isAgentSupported", () => {
    it("returns true for claude", () => {
      expect(isAgentSupported("claude")).toBe(true);
    });

    it("returns false for coming soon agents", () => {
      expect(isAgentSupported("opencode")).toBe(false);
      expect(isAgentSupported("cursor")).toBe(false);
      expect(isAgentSupported("pi")).toBe(false);
    });

    it("returns false for unknown agents", () => {
      expect(isAgentSupported("unknown")).toBe(false);
      expect(isAgentSupported("")).toBe(false);
    });
  });

  describe("isAgentKnown", () => {
    it("returns true for all known agents", () => {
      for (const agent of ALL_AGENTS) {
        expect(isAgentKnown(agent)).toBe(true);
      }
    });

    it("returns false for unknown agents", () => {
      expect(isAgentKnown("unknown")).toBe(false);
      expect(isAgentKnown("")).toBe(false);
    });
  });
});
