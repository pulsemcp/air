# Orchestration & Multi-Agent Patterns

AIR is a **single-session configuration layer**. Each `air start` or `air prepare` call assembles config for exactly one agent session in one working directory. AIR does not manage session lifecycles, coordinate multiple agents, schedule work, or persist state between runs.

This document clarifies what AIR handles, what it explicitly leaves to orchestration platforms, and what patterns teams should consider when building multi-agent systems on top of AIR.

## What AIR Does

1. **Config resolution** — load `air.json`, merge artifact indexes, resolve a root's defaults into a concrete set of skills, MCP servers, plugins, hooks, and references.
2. **Validation** — ensure all JSON files conform to AIR schemas.
3. **Agent translation** — convert resolved artifacts into agent-specific formats (Claude Code `.mcp.json`, etc.).
4. **Single-session setup** — `air start` assembles config and launches one agent session in the current working directory. `air prepare` writes config without launching.

## What AIR Does Not Do

These are orchestration concerns. AIR is intentionally unopinionated about them:

| Concern | Why it's out of scope |
|---------|----------------------|
| **Session persistence** | Tracking session status, history, and metadata requires a database. AIR is file-based and stateless. |
| **Subagent invocation** | Spawning child agent sessions, passing context between them, and collecting results is a coordination problem with many valid solutions. |
| **Job queuing & retries** | Retry policies, concurrency limits, and failure recovery are platform-level concerns. |
| **Secret management** | AIR supports `${ENV_VAR}` interpolation in MCP configs, but sourcing those values from vaults, credential stores, or secret managers is the platform's job. |
| **Git clone lifecycle** | Cloning repos, managing working directories, archiving artifacts after completion — these are execution environment concerns. |
| **Monitoring & observability** | Dashboards, alerts, transcript storage, cost tracking — all platform-level. |
| **Triggers & scheduling** | Cron-based, event-driven, or webhook-triggered session creation belongs in the orchestration layer. |
| **Inter-session communication** | Passing data between sessions (files, transcripts, structured results) requires conventions that depend on the execution environment. |

## Multi-Agent Patterns

Teams building multi-agent systems will encounter these patterns. AIR provides the building blocks (roots, skills, MCP servers) but the orchestration logic lives elsewhere.

### Pattern 1: Sequential Pipeline

An orchestrator agent spawns subagents one at a time, passing results between phases.

```
Orchestrator (root: discovery)
  ├── Phase 1: Ingest    (root: discovery-ingest)     → results.json
  ├── Phase 2: Enrich    (root: discovery-enrich)      ← results.json
  ├── Phase 3: Review    (root: discovery-review)      ← enriched.json
  └── Phase 4: Publish   (root: discovery-publish)     ← reviewed.json
```

**AIR's role**: Each phase is a root with its own skills and MCP servers. AIR resolves the config for each phase independently.

**Orchestration's role**: Deciding execution order, passing data between phases, handling partial failures, chunking large workloads across parallel subagents.

### Pattern 2: Fire-and-Forget Delegation

An agent spawns a subagent for a self-contained task and doesn't wait for the result.

```
Agent (root: web-app)
  └── "The deploy skill needs updating"
      → spawns session on root: agent-infra
      → reports session URL, continues working
```

**AIR's role**: Both the parent and child roots are defined in `air.json`. The child root's config is resolved independently.

**Orchestration's role**: Creating the child session, providing its URL back to the parent, managing its lifecycle independently.

### Pattern 3: Tool-Delegated Subagents

An MCP server exposes tools that internally spawn agent sessions. The parent agent calls tools without knowing subagents are involved.

```
Agent (root: onboarding)
  ├── MCP tool: research_server(url)    → internally spawns subagent
  ├── MCP tool: generate_configs(data)  → internally spawns subagent
  └── MCP tool: validate_setup(config)  → internally spawns subagent
```

**AIR's role**: The MCP server is defined in `mcp.json`. The subagent roots it spawns are defined in `roots.json`.

**Orchestration's role**: The MCP server implementation handles subagent lifecycle, result extraction, and error handling.

## Security Boundary: Constraining Subagent Access

When an agent can spawn subagents, it needs constraints on what it can spawn. This is a critical security concern that orchestration platforms must address.

Common pattern: **locked-down MCP server variants** that restrict which roots an agent can target. An orchestrator agent gets an MCP server that can only create sessions on a predefined set of subagent roots — it cannot escalate its own access.

```
Orchestrator root: discovery
  └── MCP server: "orchestrator-discovery" (can only spawn: ingest, enrich, review, publish)

Subagent root: discovery-ingest
  └── MCP servers: domain-specific tools only (no orchestrator access — cannot spawn further subagents)
```

AIR can express this structure (roots with different MCP server sets), but enforcement of access boundaries is the orchestration platform's responsibility.

## Challenges for Subagent Systems

These are open problems that teams will need to solve. AIR does not prescribe solutions, but they're worth understanding when designing multi-agent architectures:

### Transcript Exposure

When a parent agent needs to understand what a subagent did, it needs access to the subagent's transcript or a structured summary. This requires:
- A mechanism to retrieve transcripts (API, file system, shared storage)
- Conventions for how subagents report their results (structured output, files, final message format)
- Decisions about how much context to pass back (full transcript vs. summary vs. structured result)

### Result Passing

Subagents need to return results to their parent. Common approaches:
- **File-based**: Subagent writes results to a known path; parent reads it. Simple but requires shared filesystem.
- **Transcript extraction**: Parent reads the subagent's final message and parses structured data from it. Fragile but works across execution environments.
- **Structured output**: Subagent uses `--output-format json --json-schema <schema>` to return validated JSON. Clean but agent-specific.

### Session Identity & Traceability

Multi-agent runs need traceability — knowing which subagent belongs to which parent, which pipeline run, which trigger. This typically requires:
- Session metadata (parent ID, run ID, phase number)
- Dependency graphs for visualization
- Log correlation across sessions

### Cost & Resource Management

Each subagent is a full agent session with its own token budget. Orchestration platforms need to manage:
- Budget caps per subagent and per pipeline
- Concurrency limits (how many subagents run in parallel)
- Resource cleanup (clones, temp files, MCP server processes)

## Building an Orchestration Layer

If you're building an orchestration platform on top of AIR, here's a suggested architecture:

```
┌──────────────────────────────────────────┐
│           Orchestration Platform          │
│                                           │
│  Sessions · Jobs · Triggers · Monitoring  │
│  Secret Vault · Clone Management · UI     │
├──────────────────────────────────────────┤
│  @pulsemcp/air-core                       │
│    resolveArtifacts() · validateJson()    │
│    mergeArtifacts()                       │
│                                           │
│  @pulsemcp/air-adapter-claude (or other)  │
│    adapter.prepareSession(artifacts, dir) │
├──────────────────────────────────────────┤
│           Agent Runtime                   │
│                                           │
│  claude -p · opencode · cursor            │
└──────────────────────────────────────────┘
```

The typical session setup flow:

1. **Resolve config** — call `resolveArtifacts(airJsonPath)` from `@pulsemcp/air-core` to merge all artifact indexes
2. **Prepare the working directory** — call `prepareSession({ config, root, target, adapter })` from `@pulsemcp/air-sdk`. This resolves artifacts, delegates to the adapter to write .mcp.json and inject skills, then runs any transforms declared in `air.json`'s `extensions` array.
3. **Spawn the agent** — use `result.startCommand` to start the agent process in the prepared directory

An orchestration platform typically depends on just two AIR packages:
- `@pulsemcp/air-core` — for `resolveArtifacts()`, types, and validation
- `@pulsemcp/air-adapter-<agent>` — for `prepareSession()` and agent-specific config translation

This separation keeps AIR focused on config — a problem with a clean, general solution — and leaves orchestration to platforms that can make opinionated choices about persistence, security, and workflow.
