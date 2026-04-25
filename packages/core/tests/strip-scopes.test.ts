import { describe, it, expect } from "vitest";
import {
  stripScopes,
  ShortnameCollisionError,
} from "../src/strip-scopes.js";
import type { ResolvedArtifacts } from "../src/types.js";

function emptyArtifacts(): ResolvedArtifacts {
  return {
    skills: {},
    references: {},
    mcp: {},
    plugins: {},
    roots: {},
    hooks: {},
  };
}

describe("stripScopes — happy path", () => {
  it("rewrites all category keys from qualified to bare shortnames", () => {
    const artifacts: ResolvedArtifacts = {
      ...emptyArtifacts(),
      skills: {
        "@local/deploy": { description: "Deploy", path: "/abs/skills/deploy" },
      },
      references: {
        "@local/style-guide": {
          description: "Style guide",
          path: "/abs/refs/style-guide.md",
        },
      },
      mcp: {
        "@local/github": {
          type: "stdio",
          command: "npx",
          args: ["-y", "@mcp/github"],
        },
      },
      plugins: {
        "@local/quality": { description: "Quality", skills: ["@local/deploy"] },
      },
      roots: {
        "@local/default": {
          description: "Default",
          default_skills: ["@local/deploy"],
          default_mcp_servers: ["@local/github"],
        },
      },
      hooks: {
        "@local/audit": {
          description: "Audit",
          path: "/abs/hooks/audit",
        },
      },
    };

    const result = stripScopes(artifacts);

    expect(Object.keys(result.skills)).toEqual(["deploy"]);
    expect(Object.keys(result.references)).toEqual(["style-guide"]);
    expect(Object.keys(result.mcp)).toEqual(["github"]);
    expect(Object.keys(result.plugins)).toEqual(["quality"]);
    expect(Object.keys(result.roots)).toEqual(["default"]);
    expect(Object.keys(result.hooks)).toEqual(["audit"]);
  });

  it("rewrites reference fields inside entries to bare shortnames", () => {
    const artifacts: ResolvedArtifacts = {
      ...emptyArtifacts(),
      skills: {
        "@local/deploy": {
          description: "Deploy",
          path: "/abs/skills/deploy",
          references: ["@local/style-guide"],
        },
      },
      references: {
        "@local/style-guide": {
          description: "Style guide",
          path: "/abs/refs/style-guide.md",
        },
      },
      mcp: {
        "@local/github": { type: "stdio", command: "npx", args: ["gh"] },
      },
      plugins: {
        "@local/quality": {
          description: "Quality",
          skills: ["@local/deploy"],
          mcp_servers: ["@local/github"],
          hooks: ["@local/audit"],
          plugins: ["@local/inner"],
        },
        "@local/inner": { description: "Inner" },
      },
      roots: {
        "@local/default": {
          description: "Default",
          default_skills: ["@local/deploy"],
          default_mcp_servers: ["@local/github"],
          default_hooks: ["@local/audit"],
          default_plugins: ["@local/quality"],
          default_subagent_roots: ["@local/sub"],
        },
        "@local/sub": { description: "Sub" },
      },
      hooks: {
        "@local/audit": {
          description: "Audit",
          path: "/abs/hooks/audit",
          references: ["@local/style-guide"],
        },
      },
    };

    const result = stripScopes(artifacts);

    expect(result.skills["deploy"].references).toEqual(["style-guide"]);
    expect(result.plugins["quality"].skills).toEqual(["deploy"]);
    expect(result.plugins["quality"].mcp_servers).toEqual(["github"]);
    expect(result.plugins["quality"].hooks).toEqual(["audit"]);
    expect(result.plugins["quality"].plugins).toEqual(["inner"]);
    expect(result.roots["default"].default_skills).toEqual(["deploy"]);
    expect(result.roots["default"].default_mcp_servers).toEqual(["github"]);
    expect(result.roots["default"].default_hooks).toEqual(["audit"]);
    expect(result.roots["default"].default_plugins).toEqual(["quality"]);
    expect(result.roots["default"].default_subagent_roots).toEqual(["sub"]);
    expect(result.hooks["audit"].references).toEqual(["style-guide"]);
  });

  it("preserves non-reference entry fields verbatim", () => {
    const artifacts: ResolvedArtifacts = {
      ...emptyArtifacts(),
      mcp: {
        "@local/github": {
          type: "stdio",
          command: "npx",
          args: ["-y", "@mcp/github"],
          env: { GITHUB_TOKEN: "x" },
          title: "GitHub",
          description: "GitHub MCP server",
        },
      },
    };

    const result = stripScopes(artifacts);
    expect(result.mcp["github"]).toEqual(artifacts.mcp["@local/github"]);
  });

  it("does not mutate the input", () => {
    const artifacts: ResolvedArtifacts = {
      ...emptyArtifacts(),
      skills: {
        "@local/deploy": { description: "Deploy", path: "/abs/skills/deploy" },
      },
    };

    stripScopes(artifacts);
    expect(Object.keys(artifacts.skills)).toEqual(["@local/deploy"]);
  });

  it("succeeds when a shortname recurs across different categories (separate namespaces)", () => {
    // Same shortname `foo` in two different categories is not a collision —
    // each category is its own namespace in the output.
    const artifacts: ResolvedArtifacts = {
      ...emptyArtifacts(),
      skills: {
        "@local/foo": { description: "skill foo", path: "/abs/skills/foo" },
      },
      mcp: {
        "@local/foo": { type: "stdio", command: "echo" },
      },
    };

    const result = stripScopes(artifacts);
    expect(result.skills["foo"]).toBeDefined();
    expect(result.mcp["foo"]).toBeDefined();
  });
});

describe("stripScopes — collisions", () => {
  it("throws ShortnameCollisionError when two scopes contribute the same shortname", () => {
    const artifacts: ResolvedArtifacts = {
      ...emptyArtifacts(),
      mcp: {
        "@local/github": { type: "stdio", command: "npx", args: ["local-gh"] },
        "@acme/skills/github": {
          type: "stdio",
          command: "npx",
          args: ["acme-gh"],
        },
      },
    };

    expect(() => stripScopes(artifacts)).toThrow(ShortnameCollisionError);
  });

  it("error message names the colliding shortname and qualified IDs", () => {
    const artifacts: ResolvedArtifacts = {
      ...emptyArtifacts(),
      mcp: {
        "@local/github": { type: "stdio", command: "npx" },
        "@reframe-systems/agentic-engineering/github": {
          type: "stdio",
          command: "npx",
        },
      },
    };

    let err: ShortnameCollisionError | null = null;
    try {
      stripScopes(artifacts);
    } catch (e) {
      err = e as ShortnameCollisionError;
    }
    expect(err).toBeInstanceOf(ShortnameCollisionError);
    expect(err!.message).toContain(
      "--no-scope requires unique shortnames across all scopes"
    );
    expect(err!.message).toContain('shortname "github" maps to multiple qualified IDs');
    expect(err!.message).toContain("- @local/github");
    expect(err!.message).toContain(
      "- @reframe-systems/agentic-engineering/github"
    );
    expect(err!.message).toContain("air.json#exclude");
  });

  it("collects every collision instead of bailing on the first one", () => {
    const artifacts: ResolvedArtifacts = {
      ...emptyArtifacts(),
      mcp: {
        "@local/github": { type: "stdio", command: "npx" },
        "@acme/github": { type: "stdio", command: "npx" },
      },
      skills: {
        "@local/deploy": { description: "Local deploy", path: "/abs/d" },
        "@acme/deploy": { description: "Acme deploy", path: "/abs/d2" },
      },
    };

    let err: ShortnameCollisionError | null = null;
    try {
      stripScopes(artifacts);
    } catch (e) {
      err = e as ShortnameCollisionError;
    }
    expect(err).toBeInstanceOf(ShortnameCollisionError);
    expect(err!.collisions).toHaveLength(2);
    const shortnames = err!.collisions.map((c) => c.shortname).sort();
    expect(shortnames).toEqual(["deploy", "github"]);
  });

  it("treats collisions as per-category — same shortname in different categories is fine", () => {
    const artifacts: ResolvedArtifacts = {
      ...emptyArtifacts(),
      mcp: {
        "@local/foo": { type: "stdio", command: "echo" },
        "@acme/foo": { type: "stdio", command: "echo" },
      },
      skills: {
        // Same shortname `foo` in skills, but only one scope — not a collision.
        "@local/foo": { description: "skill", path: "/abs/foo" },
      },
    };

    let err: ShortnameCollisionError | null = null;
    try {
      stripScopes(artifacts);
    } catch (e) {
      err = e as ShortnameCollisionError;
    }
    expect(err).toBeInstanceOf(ShortnameCollisionError);
    // Only one collision: the mcp one.
    expect(err!.collisions).toHaveLength(1);
    expect(err!.collisions[0].category).toBe("mcp");
    expect(err!.collisions[0].shortname).toBe("foo");
  });
});
