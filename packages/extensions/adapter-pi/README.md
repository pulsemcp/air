# @pulsemcp/air-adapter-pi

AIR adapter extension for the [Pi coding agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) (`pi`). Injects AIR skills into Pi's native skills location and prepares working directories for agent sessions.

> **Scope: skills only.** Pi does not ship with pre-baked MCP servers, hooks, references, or plugins, so this adapter translates *only* skills. MCP servers, hooks, and standalone references are intentionally not translated (see [Known gaps](#known-gaps)).

## Installation

```bash
npm install @pulsemcp/air-adapter-pi
```

## Usage

### With the AIR CLI

```bash
# Install the adapter globally alongside the CLI
npm install -g @pulsemcp/air-cli @pulsemcp/air-adapter-pi

# Start a Pi session
air start pi --root web-app
```

### Programmatic

```typescript
import { resolveArtifacts } from "@pulsemcp/air-core";
import { PiAdapter } from "@pulsemcp/air-adapter-pi";

const artifacts = await resolveArtifacts("./air.json");
const adapter = new PiAdapter();

// Prepare a working directory for a Pi session
const session = await adapter.prepareSession(artifacts, "./my-project", {
  root: artifacts.roots["web-app"],
});

// session.configFiles  — [] (Pi discovers skills from the filesystem)
// session.skillPaths   — skill dirs created in .pi/skills/
// session.hookPaths    — [] (Pi is skills-only)
// session.startCommand — { command: "pi", args: [], cwd: "..." }
```

## What `prepareSession()` does

1. **Injects skills** — copies `SKILL.md` files and associated content into `.pi/skills/{name}/`, where Pi auto-discovers them. Any directory containing a `SKILL.md` is treated by Pi as a skill root.
2. **Copies references** — attaches a skill's referenced documents into `<skill>/references/`, so they travel with the self-contained skill directory.
3. **Reconciles via the manifest** — re-runs remove skills that are no longer activated before injecting the current set, keeping `air clean` and re-`prepare` idempotent.
4. **Respects local priority** — if a skill directory already exists in the target, it is not overwritten.

No config file is written: Pi loads `.pi/skills/` directly from the filesystem, so `prepareSession()` returns an **empty `configFiles` array**.

## Translation Details

| AIR Format | Pi Format |
|------------|-----------|
| Skills (`SKILL.md` + content) | `.pi/skills/{name}/` (auto-discovered as a project skill) |
| Skill-owned references | `.pi/skills/{name}/references/` |
| Plugin-declared skills | merged into the skill activation set (composition sugar) |

## Known gaps

These AIR features are intentionally **not** translated, because Pi is a skills-only target for AIR:

- **MCP servers** — Pi does not ship with an AIR-translatable MCP server registry. MCP server entries are ignored; the manifest records `mcpServers: []`.
- **Hooks** — Pi has no AIR-translatable hook lifecycle. Hook entries are ignored; the manifest records `hooks: []` and `prepareSession()` returns an empty `hookPaths` array.
- **Standalone references** — only skill-*owned* references are copied (alongside the skill). There is no standalone reference materialization.
- **Plugins** — honored only as composition sugar: a plugin's declared *skills* are merged into the activation set; its MCP servers and hooks are ignored.
- **Subagent context** — this adapter does not wire an AIR-driven system-prompt flag, so subagent-root context is returned to the caller via `PreparedSession.subagentContext` rather than passed to the CLI.
