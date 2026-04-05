# @pulsemcp/air-adapter-claude

AIR adapter extension for [Claude Code](https://claude.ai/code). Translates AIR artifacts into Claude Code's native format and prepares working directories for agent sessions.

## Installation

```bash
npm install @pulsemcp/air-adapter-claude
```

## Usage

### With the AIR CLI

```bash
# Install the adapter globally alongside the CLI
npm install -g @pulsemcp/air-cli @pulsemcp/air-adapter-claude

# Start a Claude Code session
air start claude --root web-app
```

### Programmatic

```typescript
import { resolveArtifacts } from "@pulsemcp/air-core";
import { ClaudeAdapter } from "@pulsemcp/air-adapter-claude";

const artifacts = await resolveArtifacts("./air.json");
const adapter = new ClaudeAdapter();

// Prepare a working directory for a Claude Code session
const session = await adapter.prepareSession(artifacts, "./my-project", {
  root: artifacts.roots["web-app"],
  secretResolvers: [myVaultResolver],
});

// session.configFiles  — paths written (.mcp.json, etc.)
// session.skillPaths   — skill dirs created in .claude/skills/
// session.startCommand — { command: "claude", args: [...], cwd: "..." }
```

## What `prepareSession()` does

1. **Writes `.mcp.json`** — translates AIR MCP server configs to Claude Code format, resolves `${VAR}` secrets via the provided `SecretResolver` chain
2. **Injects skills** — copies SKILL.md files and associated content into `.claude/skills/{name}/`
3. **Copies references** — attaches referenced documents into `.claude/skills/{name}/references/`
4. **Respects local priority** — if a skill directory already exists in the target, it is not overwritten

## Translation Details

| AIR Format | Claude Code Format |
|------------|-------------------|
| `mcp.json` (flat map with `type`, `title`, `description`) | `.mcp.json` (`mcpServers` wrapper, strips metadata) |
| `stdio` servers | `{ command, args, env }` |
| `sse`/`streamable-http` servers | `{ url, headers, oauth }` |
| OAuth `redirectUri` | Extracted as `callbackPort` |
| Plugin `id` | `name` |
| Plugin `path` | `path` |
