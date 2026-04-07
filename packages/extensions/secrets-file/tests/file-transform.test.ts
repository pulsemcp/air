import { describe, it, expect, afterEach } from "vitest";
import { resolve, join } from "path";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "fs";
import { tmpdir } from "os";
import { fileTransform } from "../src/file-transform.js";
import type { McpConfig, TransformContext, ResolvedArtifacts } from "@pulsemcp/air-core";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  tempDirs.length = 0;
});

function createTemp(files: Record<string, unknown>): string {
  const dir = resolve(
    tmpdir(),
    `air-secrets-file-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    const path = resolve(dir, name);
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(
      path,
      typeof content === "string" ? content : JSON.stringify(content, null, 2)
    );
  }
  return dir;
}

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

describe("fileTransform", () => {
  it("resolves ${VAR} from a JSON secrets file", async () => {
    const dir = createTemp({
      "secrets.json": { MY_SECRET: "file-secret-value", TOKEN: "file-token" },
    });

    const config: McpConfig = {
      mcpServers: {
        server: {
          command: "npx",
          env: { API_KEY: "${MY_SECRET}", AUTH: "Bearer ${TOKEN}" },
        },
      },
    };

    const result = await fileTransform(
      config,
      makeContext({ options: { "secrets-file": join(dir, "secrets.json") } })
    );

    expect((result.mcpServers.server.env as any).API_KEY).toBe("file-secret-value");
    expect((result.mcpServers.server.env as any).AUTH).toBe("Bearer file-token");
  });

  it("is a no-op when --secrets-file option is not provided", async () => {
    const config: McpConfig = {
      mcpServers: {
        server: {
          command: "npx",
          env: { KEY: "${UNRESOLVED}" },
        },
      },
    };

    const result = await fileTransform(config, makeContext());
    expect((result.mcpServers.server.env as any).KEY).toBe("${UNRESOLVED}");
  });

  it("leaves unresolvable ${VAR} patterns as-is", async () => {
    const dir = createTemp({
      "secrets.json": { KNOWN: "value" },
    });

    const config: McpConfig = {
      mcpServers: {
        server: {
          command: "npx",
          env: { A: "${KNOWN}", B: "${UNKNOWN_KEY}" },
        },
      },
    };

    const result = await fileTransform(
      config,
      makeContext({ options: { "secrets-file": join(dir, "secrets.json") } })
    );

    expect((result.mcpServers.server.env as any).A).toBe("value");
    expect((result.mcpServers.server.env as any).B).toBe("${UNKNOWN_KEY}");
  });

  it("resolves ${VAR} in URLs and headers", async () => {
    const dir = createTemp({
      "secrets.json": { API_TOKEN: "tok_abc123" },
    });

    const config: McpConfig = {
      mcpServers: {
        remote: {
          type: "streamable-http",
          url: "https://api.example.com?token=${API_TOKEN}",
          headers: { Authorization: "Bearer ${API_TOKEN}" },
        },
      },
    };

    const result = await fileTransform(
      config,
      makeContext({ options: { "secrets-file": join(dir, "secrets.json") } })
    );

    expect(result.mcpServers.remote.url).toBe(
      "https://api.example.com?token=tok_abc123"
    );
    expect((result.mcpServers.remote.headers as any).Authorization).toBe(
      "Bearer tok_abc123"
    );
  });

  it("resolves multiple ${VAR} patterns in one string", async () => {
    const dir = createTemp({
      "secrets.json": { USER: "admin", PASS: "s3cret" },
    });

    const config: McpConfig = {
      mcpServers: {
        db: {
          command: "psql",
          env: { DSN: "postgresql://${USER}:${PASS}@localhost/mydb" },
        },
      },
    };

    const result = await fileTransform(
      config,
      makeContext({ options: { "secrets-file": join(dir, "secrets.json") } })
    );

    expect((result.mcpServers.db.env as any).DSN).toBe(
      "postgresql://admin:s3cret@localhost/mydb"
    );
  });
});
