import { describe, it, expect } from "vitest";
import {
  LOCAL_SCOPE,
  validateScope,
  isQualified,
  qualifyId,
  parseQualifiedId,
  deriveScope,
  buildShortnameIndex,
  lookupArtifactId,
  resolveReference,
} from "../src/scope.js";
import type { CatalogProvider } from "../src/types.js";

describe("validateScope", () => {
  it("accepts simple scopes", () => {
    expect(() => validateScope("local")).not.toThrow();
    expect(() => validateScope("acme")).not.toThrow();
  });

  it("accepts scopes with slashes (org/repo)", () => {
    expect(() => validateScope("acme/skills")).not.toThrow();
  });

  it("accepts scopes with dots, underscores, dashes", () => {
    expect(() => validateScope("a.b_c-d")).not.toThrow();
  });

  it("rejects empty scopes", () => {
    expect(() => validateScope("")).toThrow(/non-empty/);
  });

  it("rejects scopes with leading or trailing slash", () => {
    expect(() => validateScope("/x")).toThrow(/start or end with/);
    expect(() => validateScope("x/")).toThrow(/start or end with/);
  });

  it("rejects scopes with invalid characters", () => {
    expect(() => validateScope("a b")).toThrow(/Invalid scope/);
    expect(() => validateScope("a@b")).toThrow(/Invalid scope/);
  });
});

describe("isQualified / qualifyId / parseQualifiedId", () => {
  it("isQualified returns true for @-prefixed strings", () => {
    expect(isQualified("@local/foo")).toBe(true);
    expect(isQualified("@acme/skills/foo")).toBe(true);
    expect(isQualified("foo")).toBe(false);
  });

  it("qualifyId combines scope and id", () => {
    expect(qualifyId("local", "foo")).toBe("@local/foo");
    expect(qualifyId("acme/skills", "lint")).toBe("@acme/skills/lint");
  });

  it("qualifyId rejects already-qualified IDs", () => {
    expect(() => qualifyId("local", "@other/foo")).toThrow(
      /already-qualified/,
    );
  });

  it("qualifyId rejects empty IDs", () => {
    expect(() => qualifyId("local", "")).toThrow(/empty/);
  });

  it("parseQualifiedId splits scope and id", () => {
    expect(parseQualifiedId("@local/foo")).toEqual({
      scope: "local",
      id: "foo",
    });
  });

  it("parseQualifiedId handles multi-segment scopes by taking everything before the last slash", () => {
    expect(parseQualifiedId("@acme/skills/lint")).toEqual({
      scope: "acme/skills",
      id: "lint",
    });
  });

  it("parseQualifiedId rejects unqualified strings", () => {
    expect(() => parseQualifiedId("foo")).toThrow(/Not a qualified ID/);
  });

  it("parseQualifiedId rejects malformed input", () => {
    expect(() => parseQualifiedId("@x")).toThrow(/Malformed/);
    expect(() => parseQualifiedId("@/x")).toThrow();
  });
});

describe("deriveScope", () => {
  it("returns LOCAL_SCOPE for plain paths", () => {
    expect(deriveScope("./skills.json", [])).toBe(LOCAL_SCOPE);
    expect(deriveScope("/abs/path.json", [])).toBe(LOCAL_SCOPE);
    expect(deriveScope("relative/path.json", [])).toBe(LOCAL_SCOPE);
  });

  it("returns LOCAL_SCOPE for file:// URIs", () => {
    expect(deriveScope("file:///abs/path.json", [])).toBe(LOCAL_SCOPE);
  });

  it("delegates to provider.getScope when matching scheme", () => {
    const provider: CatalogProvider = {
      scheme: "github",
      resolve: async () => ({}),
      getScope: (uri: string) => {
        const m = uri.match(/^github:\/\/([^/]+)\/([^/@]+)/);
        return m ? `${m[1]}/${m[2]}` : "unknown";
      },
    };
    expect(deriveScope("github://acme/skills@v1", [provider])).toBe(
      "acme/skills",
    );
  });

  it("falls back to LOCAL_SCOPE when provider has no getScope", () => {
    const provider: CatalogProvider = {
      scheme: "mock",
      resolve: async () => ({}),
    };
    expect(deriveScope("mock://x/y", [provider])).toBe(LOCAL_SCOPE);
  });

  it("falls back to LOCAL_SCOPE when no provider matches", () => {
    expect(deriveScope("unknown://x/y", [])).toBe(LOCAL_SCOPE);
  });
});

describe("buildShortnameIndex / lookupArtifactId", () => {
  const artifacts = {
    "@local/foo": {},
    "@local/bar": {},
    "@acme/skills/foo": {}, // shares shortname "foo" with @local
  };

  it("builds an index with single-scope shortnames mapped to qualified", () => {
    const index = buildShortnameIndex(artifacts);
    expect(index.get("bar")).toBe("@local/bar");
  });

  it("flags ambiguous shortnames with null", () => {
    const index = buildShortnameIndex(artifacts);
    expect(index.get("foo")).toBeNull();
  });

  it("lookupArtifactId returns qualified IDs for short refs when unambiguous", () => {
    expect(lookupArtifactId(artifacts, "bar", undefined)).toBe("@local/bar");
  });

  it("lookupArtifactId returns null for ambiguous short refs without fromScope", () => {
    expect(lookupArtifactId(artifacts, "foo", undefined)).toBeNull();
  });

  it("lookupArtifactId honors intra-catalog rule via fromScope", () => {
    expect(lookupArtifactId(artifacts, "foo", "local")).toBe("@local/foo");
    expect(lookupArtifactId(artifacts, "foo", "acme/skills")).toBe(
      "@acme/skills/foo",
    );
  });

  it("lookupArtifactId returns qualified ID directly when input is already qualified", () => {
    expect(lookupArtifactId(artifacts, "@local/foo", undefined)).toBe(
      "@local/foo",
    );
  });

  it("lookupArtifactId returns null when qualified ID is not in pool", () => {
    expect(lookupArtifactId(artifacts, "@nope/foo", undefined)).toBeNull();
  });
});

describe("resolveReference", () => {
  const artifacts = {
    "@local/foo": {},
    "@local/bar": {},
    "@acme/skills/foo": {},
  };

  it("returns ok for unambiguous short references", () => {
    const result = resolveReference(artifacts, "bar", undefined);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.qualified).toBe("@local/bar");
    }
  });

  it("returns missing when reference does not exist", () => {
    const result = resolveReference(artifacts, "missing", undefined);
    expect(result.status).toBe("missing");
  });

  it("returns ambiguous with candidates when multiple scopes contribute the shortname", () => {
    const result = resolveReference(artifacts, "foo", undefined);
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") {
      expect(result.candidates.sort()).toEqual([
        "@acme/skills/foo",
        "@local/foo",
      ]);
    }
  });

  it("intra-catalog rule resolves ambiguous shortnames via fromScope", () => {
    const result = resolveReference(artifacts, "foo", "local");
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.qualified).toBe("@local/foo");
    }
  });

  it("qualified references resolve directly when present", () => {
    const result = resolveReference(artifacts, "@acme/skills/foo", undefined);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.qualified).toBe("@acme/skills/foo");
    }
  });

  it("qualified references that don't exist return missing", () => {
    const result = resolveReference(artifacts, "@nope/x", undefined);
    expect(result.status).toBe("missing");
  });
});
