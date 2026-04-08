import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { envTransform } from "../src/env-transform.js";
import type { McpConfig, TransformContext, ResolvedArtifacts } from "@pulsemcp/air-core";

function emptyArtifacts(): ResolvedArtifacts {
  return { skills: {}, references: {}, mcp: {}, plugins: {}, roots: {}, hooks: {} };
}

function makeContext(overrides?: Partial<TransformContext>): TransformContext {
  return {
    targetDir: "/tmp/test",
    artifacts: emptyArtifacts(),
    options: {},
    mcpConfigPath: "/tmp/test/.mcp.json",
    ...overrides,
  };
}

describe("envTransform", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.MY_SECRET = process.env.MY_SECRET;
    savedEnv.ANOTHER_VAR = process.env.ANOTHER_VAR;
    savedEnv.DB_USER = process.env.DB_USER;
    savedEnv.DB_PASS = process.env.DB_PASS;
    process.env.MY_SECRET = "resolved-secret-value";
    process.env.ANOTHER_VAR = "another-value";
    process.env.DB_USER = "admin";
    process.env.DB_PASS = "s3cret";
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("resolves ${VAR} in env values from process.env", async () => {
    const config: McpConfig = {
      mcpServers: {
        server: {
          command: "npx",
          env: { API_KEY: "${MY_SECRET}" },
        },
      },
    };

    const result = await envTransform(config, makeContext());
    expect((result.mcpServers.server.env as any).API_KEY).toBe("resolved-secret-value");
  });

  it("resolves ${VAR} in URL values", async () => {
    const config: McpConfig = {
      mcpServers: {
        remote: {
          type: "streamable-http",
          url: "https://api.example.com?token=${MY_SECRET}",
        },
      },
    };

    const result = await envTransform(config, makeContext());
    expect(result.mcpServers.remote.url).toBe(
      "https://api.example.com?token=resolved-secret-value"
    );
  });

  it("resolves ${VAR} in header values", async () => {
    const config: McpConfig = {
      mcpServers: {
        remote: {
          type: "sse",
          url: "https://mcp.example.com",
          headers: { Authorization: "Bearer ${MY_SECRET}" },
        },
      },
    };

    const result = await envTransform(config, makeContext());
    expect((result.mcpServers.remote.headers as any).Authorization).toBe(
      "Bearer resolved-secret-value"
    );
  });

  it("leaves unresolvable ${VAR} patterns as-is", async () => {
    const config: McpConfig = {
      mcpServers: {
        server: {
          command: "npx",
          env: { KEY: "${NONEXISTENT_VAR_12345}" },
        },
      },
    };

    const result = await envTransform(config, makeContext());
    expect((result.mcpServers.server.env as any).KEY).toBe("${NONEXISTENT_VAR_12345}");
  });

  it("resolves multiple ${VAR} patterns in one string", async () => {
    const config: McpConfig = {
      mcpServers: {
        db: {
          command: "psql",
          env: {
            DSN: "postgresql://${DB_USER}:${DB_PASS}@localhost/mydb",
          },
        },
      },
    };

    const result = await envTransform(config, makeContext());
    expect((result.mcpServers.db.env as any).DSN).toBe(
      "postgresql://admin:s3cret@localhost/mydb"
    );
  });

  it("passes through config with no ${VAR} patterns unchanged", async () => {
    const config: McpConfig = {
      mcpServers: {
        server: {
          command: "npx",
          args: ["-y", "@mcp/github"],
          env: { TOKEN: "literal-value" },
        },
      },
    };

    const result = await envTransform(config, makeContext());
    expect(result.mcpServers.server.command).toBe("npx");
    expect(result.mcpServers.server.env).toEqual({ TOKEN: "literal-value" });
  });

  it("passes through non-string values unchanged", async () => {
    const config: McpConfig = {
      mcpServers: {
        server: {
          command: "npx",
          args: ["-y", "pkg"],
          env: { PORT: "${MY_SECRET}" },
        },
      },
    };

    const result = await envTransform(config, makeContext());
    expect(result.mcpServers.server.args).toEqual(["-y", "pkg"]);
    expect((result.mcpServers.server.env as any).PORT).toBe("resolved-secret-value");
  });

  it("resolves ${VAR:-default} using the default when env var is unset", async () => {
    const config: McpConfig = {
      mcpServers: {
        server: {
          command: "npx",
          env: {
            BASE_URL: "${NONEXISTENT_VAR_12345:-https://ao.pulsemcp.com}",
          },
        },
      },
    };

    const result = await envTransform(config, makeContext());
    expect((result.mcpServers.server.env as any).BASE_URL).toBe(
      "https://ao.pulsemcp.com"
    );
  });

  it("resolves ${VAR:-} to empty string when env var is unset", async () => {
    const config: McpConfig = {
      mcpServers: {
        server: {
          command: "npx",
          env: { API_KEY: "${NONEXISTENT_VAR_12345:-}" },
        },
      },
    };

    const result = await envTransform(config, makeContext());
    expect((result.mcpServers.server.env as any).API_KEY).toBe("");
  });

  it("resolves ${VAR:-default} using env value when env var is set", async () => {
    const config: McpConfig = {
      mcpServers: {
        server: {
          command: "npx",
          env: {
            API_KEY: "${MY_SECRET:-fallback-value}",
          },
        },
      },
    };

    const result = await envTransform(config, makeContext());
    expect((result.mcpServers.server.env as any).API_KEY).toBe("resolved-secret-value");
  });

  it("resolves ${VAR} in nested objects", async () => {
    const config: McpConfig = {
      mcpServers: {
        server: {
          type: "sse",
          url: "https://example.com",
          oauth: {
            clientId: "${MY_SECRET}",
            scopes: ["read"],
          },
        },
      },
    };

    const result = await envTransform(config, makeContext());
    expect((result.mcpServers.server.oauth as any).clientId).toBe("resolved-secret-value");
  });
});
