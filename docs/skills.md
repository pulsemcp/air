# Skills

Skills are reusable, invocable units of work defined as structured Markdown (SKILL.md) and associated files. Skills represent internal (often proprietary) knowledge or processes where foundation models cannot be trained or have been proven to underperform.

## Why Skills?

Without skills, agents rely entirely on their training data and ad-hoc instructions. Skills fill the gap for organizational knowledge that models don't have — deployment procedures, code review checklists, internal API conventions. Skills give you:

- **Consistency** — the same procedure every time, across every agent session
- **Institutional knowledge** — encode team conventions, deployment processes, review checklists
- **Composability** — skills can reference shared documents and be combined in roots
- **Auditability** — skills are version-controlled and reviewable like any other code

## Index Format

Skills are registered in `skills.json`:

```json
{
  "deploy-staging": {
    "title": "Deploy to Staging",
    "description": "Deploy the current PR branch to the staging environment for testing",
    "path": "skills/deploy-staging",
    "references": ["git-workflow", "staging-env"]
  }
}
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `title` | No | Human-readable display name. |
| `description` | Yes | What this skill does. Clear enough for anyone in the org. |
| `path` | Yes | Relative path to the skill directory containing `SKILL.md`. |
| `references` | No | IDs of reference documents this skill depends on. |

## SKILL.md Format

Each skill directory contains a `SKILL.md` file with YAML frontmatter and structured Markdown:

```markdown
---
name: deploy-staging
title: Deploy to Staging
description: Deploy the current PR branch to the staging environment for testing
argument-hint: <branch-name> (optional, defaults to current branch)
user-invocable: true
---

# Deploy to Staging

## Checklist
- [ ] Verify branch has passing CI
- [ ] Deploy to staging
- [ ] Run smoke tests
- [ ] Report deployment URL

## Pre-requisites
- GitHub MCP server must be available
- CI must be passing on the current branch

## Input
- `$ARGUMENTS`: Optional branch name (defaults to current branch)

## Procedure

### Step 1: Verify CI Status
Check that CI is passing on the target branch. Hard-stop if CI is failing.

### Step 2: Deploy
Run the deployment command for the staging environment.

### Step 3: Verify
Run smoke tests against the staging URL and verify the deployment is healthy.

## Output
- Staging deployment URL
- Smoke test results summary
```

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Skill identifier (matches the ID in skills.json) |
| `title` | No | Human-readable name |
| `description` | Yes | What the skill does |
| `argument-hint` | No | Hint for what arguments the skill accepts |
| `user-invocable` | No | Whether users can invoke this skill directly (default: true) |

### Sections

| Section | Purpose |
|---------|---------|
| **Checklist** | Scannable step-level overview. Agents track progress here. |
| **Pre-requisites** | Required MCP servers, tools, or conditions. Hard-stop if missing. |
| **Input** | What data the skill expects (arguments, context, files). |
| **Procedure** | Step-by-step instructions. Use high-level directives, not prescriptive sub-steps. |
| **Output** | What the skill produces when complete. |

## References and DRY

Skills declare their reference dependencies via the `references` array in skills.json. This keeps knowledge DRY — instead of embedding your git workflow conventions in every skill, you write it once as a reference and attach it to any skill that needs it.

```json
{
  "deploy-staging": {
    "description": "Deploy to staging",
    "path": "skills/deploy-staging",
    "references": ["git-workflow", "staging-env"]
  },
  "create-pr": {
    "description": "Create a pull request",
    "path": "skills/create-pr",
    "references": ["git-workflow", "code-standards"]
  }
}
```

Both skills share the `git-workflow` reference without duplicating its content.

## Best Practices

1. **Always start with a checklist** — gives agents (and humans) a scannable overview
2. **Define pre-requisites and hard-stop on failure** — don't let agents guess
3. **Be explicit about inputs and outputs** — no ambiguity
4. **Write for autonomous execution** — the agent should be able to complete the skill without asking questions
5. **Prefer high-level directives** — "Deploy to staging" not "Run `bin/deploy staging`, then wait 30 seconds, then curl..."
6. **Specify when to stop** — clear completion criteria
7. **Keep skills focused** — one skill, one task. Compose skills for complex workflows.
8. **Design for composability** — skills should be self-contained units that combine cleanly

## Anti-patterns

- **Giant monolithic skills** — break them up
- **Hardcoded schemas or API payloads** — reference docs instead
- **Vague instructions** — "do the deployment" vs "deploy the current branch to staging and verify with smoke tests"
- **Missing edge cases** — what happens when CI fails? When staging is down?
- **No checklist** — agents need a progress tracker
- **No output specification** — how do you know the skill completed?
