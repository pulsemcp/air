# @pulsemcp/air-adapter-pi

AIR adapter extension for the Pi coding agent. Injects AIR skills into Pi's native skills location and prepares working directories for agent sessions.

**Scope: skills only.** Pi does not ship with pre-baked MCP servers, hooks, references, or plugins, so this adapter translates *only* skills. MCP servers, hooks, and standalone references are intentionally not translated — see "What NOT to Do".

## Folder Hierarchy

```
packages/extensions/adapter-pi/
├── src/
│   ├── index.ts             # AirExtension default export + re-exports
│   ├── pi-adapter.ts         # PiAdapter class implementing AgentAdapter
│   └── scan-local-skills.ts  # Discovers user-managed skills in .pi/skills/
├── tests/
│   ├── pi-adapter.test.ts        # Skill translation, prepareSession, clean tests
│   └── scan-local-skills.test.ts # Local skill discovery tests
└── package.json
```

## Domain Context

This package implements the `AgentAdapter` interface from `@pulsemcp/air-core` for the Pi coding agent (`pi`, published as `@earendil-works/pi-coding-agent`). The most important method is `prepareSession()` which is the single entry point for setting up a working directory — it injects skills + their references into `.pi/skills/<name>/` and records them in the per-target manifest.

Pi expects:
- Skills as directories under `.pi/skills/<name>/SKILL.md`. Pi auto-discovers project skills from `<cwd>/.pi/skills/`: any directory containing a `SKILL.md` is treated as a skill root, and Pi stops recursing into it — so reference files bundled inside the skill directory travel with it safely.
- References copied alongside the skill in `<skill>/references/`.

Because Pi discovers skills purely from the filesystem, no config file is written. `prepareSession()` returns an **empty `configFiles` array** and an **empty `hookPaths` array` — there is no JSON config for AIR's transform pipeline to post-process, and hooks are never materialized.

### Why skills-only

Pi's value to AIR is as a lightweight skills consumer. It has no pre-baked MCP server registry or hook lifecycle that AIR would translate into, so the adapter deliberately implements only the skill path. The `generateConfig` / `prepareSession` / `cleanSession` methods still satisfy the full `AgentAdapter` contract, but the non-skill categories are stubbed: MCP servers and hooks are never materialized, the manifest records `hooks: []` and `mcpServers: []`, and `cleanSession` reports empty `removedHooks` / `removedMcpServers`. Plugins are honored only as composition sugar — a plugin's declared *skills* are merged into the activation set; its MCP servers and hooks are ignored.

## Core Principles

### prepareSession is the primary interface
Callers should use `prepareSession()` rather than calling `generateConfig` and copying skill directories separately. The adapter owns the full "make this directory ready" contract.

### Local artifacts take priority
If `.pi/skills/<name>/` already exists in the target directory, the catalog version is not written. This allows repos to override catalog skills.

### Reconcile, don't clobber
The per-target manifest tracks which skills AIR wrote. Re-running `prepareSession` removes skills that are no longer activated (stale entries) before injecting the current set, and `cleanSession` removes exactly what AIR previously wrote — leaving user-authored `.pi/skills/` directories untouched.

## What NOT to Do

- Do not translate MCP servers, hooks, or standalone references — Pi is skills-only. Stub the non-skill categories (empty manifest entries, empty result arrays); do not invent a Pi MCP/hook format.
- Do not write a config file or surface anything via `configFiles` — Pi discovers `.pi/skills/` from the filesystem.
- Do not write files outside the target directory.
- Do not overwrite a skill directory that already exists in the target — local versions win.
