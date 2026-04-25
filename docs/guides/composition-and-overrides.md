# Composition and Overrides

AIR's composition model lets you assemble configuration from multiple sources — local directories, catalogs your team ships, remote org-wide catalogs, or any mix — without any of those sources needing to know about each other.

`~/.air/air.json` is the single composition surface: every active artifact in a session comes from the arrays you list there. Nothing else contributes to a session's config, and you are not required to use remote catalogs — a fully local setup is a supported first-class shape.

## The scoped identity model

Every artifact in AIR has a **qualified identity** of the form `@scope/id`:

- **`@local/<id>`** for artifacts contributed by local index files (anything that does not come from a catalog provider).
- **`@<org>/<repo>/<id>`** for artifacts contributed by a `github://` catalog. The scope is derived from the `org/repo` part of the URI.
- Other catalog providers may define their own scope shape — e.g. `@<bucket>/<id>` for an S3 provider — see [Extensions System](extensions.md).

The `<id>` portion is the **shortname**: the bare key inside an index file (e.g. `deploy`, `github`, `lint-fix`). Inside a single scope, shortnames must be unique. Across scopes, shortnames may collide — the qualified form is what disambiguates.

You will see qualified IDs everywhere AIR talks about artifacts:

```bash
$ air list skills
@local/deploy        — Deploy to staging
@local/lint-fix      — Run linters and apply fixes
@acme/air-org/review — Code-review skill from the org catalog
```

### Why scopes?

Scopes solve a real problem: two catalogs may legitimately ship a skill called `review`, and a team consuming both should not be forced to rename one. With scopes, both `@acme/air-org/review` and `@local/review` coexist — you reference whichever you want.

Scopes also make it impossible for a catalog you depend on to silently change a different catalog's artifact. Catalog A cannot publish anything that lives under catalog B's scope, so there is no "later-wins" replacement to reason about.

## Composition rules

### 1. Disjoint qualified IDs union

Different catalogs ship different scopes, so their artifacts simply accumulate:

```json
{
  "name": "platform-team",
  "extensions": ["@pulsemcp/air-provider-github"],
  "catalogs": [
    "github://acme/air-org",
    "./platform-team-catalog"
  ]
}
```

Result: `@acme/air-org/<…>` artifacts and `@local/<…>` artifacts all coexist.

### 2. Duplicate qualified IDs hard-fail

If two indexes contribute the **same** qualified ID, AIR refuses to resolve:

```
Error: Duplicate skill ID "@local/deploy" produced by both
"./skills/team.json" and "./skills/local.json". Two catalogs with
the same scope contributed the same shortname; rename one or
remove the duplicate from your air.json.
```

This applies whenever two indexes resolve to the same scope — most commonly two local index files defining the same shortname. It also catches a catalog provider that erroneously emits the same qualified ID twice.

There is no "later-wins" override. The only way to drop an artifact is `exclude`.

### 3. Cross-scope shortname collisions warn

When two **different** scopes happen to ship the same shortname, AIR warns once at resolution time and keeps both:

```
Warning: Shortname "review" appears in multiple scopes
(@local/review, @acme/air-org/review). Short references to
"review" must use the qualified form to disambiguate.
```

The artifacts both stay in the resolved set — the warning just tells you that any short reference to `review` will need the qualified form.

### 4. `exclude` drops artifacts by qualified ID

`exclude` is the only composition control. It takes a list of **qualified** IDs to remove from the resolved set:

```json
{
  "name": "platform-team",
  "extensions": ["@pulsemcp/air-provider-github"],
  "catalogs": [
    "github://acme/air-org",
    "./platform-team-catalog"
  ],
  "exclude": [
    "@acme/air-org/legacy-deploy",
    "@acme/air-org/dont-use-this-mcp-server"
  ]
}
```

Notes:

- Entries **must** be qualified — bare shortnames are rejected with a hard error.
- An `exclude` entry that does not match any resolved artifact emits a warning (typo guard, not an error).
- `exclude` runs after composition, so a catalog you depend on cannot bypass it.

There is no field-level patch, no "override this one field" knob. If you want a different behavior for a skill, ship a new skill under your own scope.

## Reference syntax

Roots, plugins, and skills frequently reference other artifacts (e.g. a root's `default_skills`, a plugin's `mcp_servers`, a skill's `references`). References accept three forms:

| Form | Example | When to use |
|------|---------|-------------|
| Short, unambiguous | `"deploy"` | The shortname appears in only one scope across the resolved set. AIR canonicalizes it to `@local/deploy` (or whichever scope owns it). |
| Qualified | `"@acme/air-org/deploy"` | Always works; required when shortnames collide across scopes. |
| Short, intra-catalog | `"deploy"` (inside `github://acme/air-org/...`) | A reference inside a catalog index resolves to the same catalog's scope first, even if the same shortname exists elsewhere. This lets a catalog reference its own artifacts without using its own scope name in every file. |

If a short reference is ambiguous (multiple scopes ship it and the intra-catalog rule does not apply), AIR fails with the candidate list:

```
Error: Reference "review" is ambiguous — candidates: @acme/air-org/review,
@local/review. Use the qualified form to disambiguate.
```

After resolution, root and plugin reference fields are stored in **canonical (qualified) form** so adapters and consumers do not need to re-resolve them.

## Whole-catalog composition

When you want to layer two or more full catalogs you don't need to list every artifact type separately. The `catalogs` field in `air.json` accepts an ordered array of catalog roots, and AIR expands each one into all six artifact arrays automatically.

A **catalog** is a directory (local or remote) containing AIR artifact index files. AIR walks the catalog root up to 3 directory levels deep and discovers any file that looks like an AIR artifact index — either by filename (`skills.json`, `roots.json`, `mcp.json`, `references.json`, `plugins.json`, `hooks.json`, or any filename with those keywords as delimited tokens) or by `$schema`. Your folder layout is up to you:

```
<catalog>/
├── skills/skills.json                 # conventional layout
├── mcp/mcp.json
├── agents/agent-roots/roots.json      # custom subdirectories work too
├── config/mcp-servers/mcp.json
└── hooks.json                         # files at the root work as well
```

This is the same layout `air init` creates by default, and it's what each official example in this repo uses — but any layout up to 3 levels deep is accepted. You don't need all six artifact types — a catalog that only ships skills and MCP servers works fine.

**Traversal rules:**

- **Depth cap**: 3 levels below the catalog root. Indexes deeper than that must be referenced via the explicit per-type arrays.
- **Skipped directories**: `node_modules`, `.git`, `dist`, `build`, `coverage`, `.next`, `.turbo`, `target`, `vendor`, and any directory starting with `.`.
- **`.gitignore`** at the catalog root is honored — ignored paths are not descended into.
- **`$schema` check**: a JSON file whose `$schema` points to a non-AIR schema is skipped even if its filename matches. Files without `$schema` are identified by filename alone.

Within a single catalog, multiple indexes of the same type contribute to the **same scope**. They must therefore have disjoint shortnames — duplicates hard-fail with the same error as in rule 2 above.

### Two-catalog composition (the common case)

```json
{
  "name": "platform-team",
  "extensions": ["@pulsemcp/air-provider-github"],
  "catalogs": [
    "github://acme/air-org",
    "./platform-team-catalog"
  ]
}
```

That's it. Both catalogs contribute skills, MCP servers, plugins, roots, hooks, and references. Their qualified IDs live in different scopes (`@acme/air-org/...` vs `@local/...`), so they never collide.

### Mixing catalogs and explicit arrays

You can use `catalogs` and the per-type arrays together. Catalogs expand first; the per-type arrays add to the same scope (`@local/...` for local arrays):

```json
{
  "catalogs": [
    "github://acme/air-org",
    "./team-catalog"
  ],
  "mcp": [
    "./local-mcp.json"
  ]
}
```

Both `./team-catalog/mcp/...` and `./local-mcp.json` contribute under `@local/...`, so an MCP server defined in both still hard-fails — there is no override path to choose. Use a different shortname or `exclude` the one you don't want.

### When to prefer `catalogs` over per-type arrays

- You're layering full catalogs (org + team + local). `catalogs: [A, B, C]` beats writing each of the six artifact arrays for every catalog.
- The catalog's index files live within 3 directory levels of the catalog root.

Use the per-type arrays when you want to pull just one artifact type from a source, or when an index file lives deeper than the discovery depth cap.

## Layering patterns

### Local-only

You don't need a remote source to use AIR. A team that maintains its skills in a private directory can point `air.json` straight at local index files:

```json
{
  "name": "my-team",
  "skills": ["./skills/skills.json"],
  "mcp": ["./mcp/mcp.json"]
}
```

Everything resolves under `@local/...`. No providers required, no network calls at resolution time.

### Local team catalog + shared remote catalog

A common shape is a private catalog kept as a sibling directory under `~/.air/` (often a git submodule or a checked-out team repo), composed alongside a shared org-wide catalog. Using the `catalogs` field keeps this compact — one entry per catalog rather than six paths per catalog:

```json
{
  "name": "platform-team",
  "extensions": ["@pulsemcp/air-provider-github"],
  "catalogs": [
    "github://acme/air-org",
    "./platform-team-catalog"
  ]
}
```

The org catalog ships under `@acme/air-org/...`. Your team catalog ships under `@local/...`. No collisions, no merge logic.

If you only need some artifact types from a source, or the indexes live deeper than the 3-level discovery cap, use the per-type arrays instead:

```json
{
  "name": "platform-team",
  "extensions": ["@pulsemcp/air-provider-github"],
  "skills": [
    "github://acme/air-org/skills/skills.json",
    "./platform-team-catalog/skills/skills.json"
  ],
  "mcp": [
    "github://acme/air-org/mcp/mcp.json",
    "./platform-team-catalog/mcp/mcp.json"
  ]
}
```

The `github://` URIs contribute under `@acme/air-org/...`; the local paths contribute under `@local/...`.

Local paths are resolved relative to the directory containing `air.json`. If your catalog lives elsewhere on disk, use an absolute path like `/opt/team-catalog/skills/skills.json`. **Tildes (`~/`) are not expanded** — either use a relative path or spell out the absolute path.

### Pulling from multiple GitHub catalogs

```json
{
  "extensions": ["@pulsemcp/air-provider-github"],
  "catalogs": [
    "github://acme/air-org",
    "github://acme/air-platform-team",
    "./local-overrides"
  ]
}
```

Three scopes coexist: `@acme/air-org/...`, `@acme/air-platform-team/...`, and `@local/...`.

### Excluding org defaults you don't want

```json
{
  "extensions": ["@pulsemcp/air-provider-github"],
  "catalogs": ["github://acme/air-org"],
  "exclude": [
    "@acme/air-org/legacy-deploy",
    "@acme/air-org/old-mcp-server"
  ]
}
```

The two excluded artifacts disappear from the resolved set; everything else from `@acme/air-org` is kept.

## Remote configuration with providers

Providers resolve remote URIs in artifact paths, enabling shared configuration hosted in git repositories.

### GitHub provider

With `@pulsemcp/air-provider-github` installed, use `github://` URIs:

```json
{
  "extensions": ["@pulsemcp/air-provider-github"],
  "skills": [
    "github://acme/shared-air-config/skills/skills.json",
    "./skills/local-skills.json"
  ]
}
```

URI format:

```
github://owner/repo/path/to/file.json
github://owner/repo@ref/path/to/file.json
```

The scope derived from a `github://` URI is `<owner>/<repo>` — so artifacts contributed by `github://acme/shared-air-config/...` show up as `@acme/shared-air-config/...`.

The `@ref` is appended to the repo name (preferred) to specify a branch, tag, or commit SHA. Without `@ref`, the default branch is used. The legacy syntax `github://owner/repo/path/to/file.json@ref` is also supported.

### Authentication for private repos

Set `AIR_GITHUB_TOKEN`:

```bash
export AIR_GITHUB_TOKEN=ghp_xxxxxxxxxxxx
```

### Caching

GitHub provider caches repository clones at `~/.air/cache/github/`. To force a refresh:

```bash
rm -rf ~/.air/cache/github/acme/shared-air-config
```

## Plugin composition

Plugins can compose other plugins, creating hierarchical capability bundles. References inside a plugin entry use the same short / qualified rules described above:

```json
{
  "full-stack-dev": {
    "description": "Full-stack developer toolkit",
    "plugins": ["code-quality", "deploy-toolkit"],
    "skills": ["monitor-logs"]
  }
}
```

When `full-stack-dev` is activated, its referenced plugins' skills, MCP servers, and hooks are recursively expanded. Each reference resolves through the same canonicalization process (short → qualified), and the result is stored canonically.

Circular plugin references are detected and rejected at resolution time.

## Subagent root composition

Roots can declare dependencies on other roots via `default_subagent_roots`:

```json
{
  "orchestrator": {
    "description": "Main orchestrator agent",
    "default_subagent_roots": ["web-app", "api-service"],
    "default_skills": ["orchestrate"]
  }
}
```

By default, both `air start` and `air prepare` merge the subagent roots' skills and MCP servers into the parent session. Opt out with `--no-subagent-merge`.

Subagent root references follow the same short / qualified rules.

## Removing an artifact you don't want

`exclude` is the only way to drop an artifact:

```json
{
  "catalogs": ["github://acme/air-org"],
  "exclude": ["@acme/air-org/skill-i-dont-want"]
}
```

There is no "disabled" flag, no override-with-empty-entry trick. If you want a tweaked version of an artifact, ship the tweak under your own scope (e.g. `@local/skill-i-dont-want-but-fixed`).

## Composition behavior reference

| Scenario | Behavior |
|----------|----------|
| Different scopes contribute different shortnames | All artifacts kept (additive) |
| Different scopes contribute the same shortname | All kept; warning logged; short refs must qualify |
| Same scope, two indexes, same shortname | Hard-fail (duplicate qualified ID) |
| `exclude` matches a qualified ID | Artifact removed from the resolved set |
| `exclude` entry matches nothing | Warning logged; resolution continues |
| `exclude` entry is not qualified | Hard-fail (must be `@scope/id`) |
| Short reference, unambiguous | Resolved to its qualified ID |
| Short reference, ambiguous | Hard-fail with candidate list |
| Short reference inside a catalog index | Resolved to the catalog's own scope first |
| Plugin references another plugin | Recursive expansion; references canonicalized |
| Subagent root artifacts | Merged into parent session |
| Catalog missing an artifact file | Silently skipped — that catalog contributes nothing for that type |
| Index deeper than 3 levels in a catalog | Not discovered — reference it via the explicit per-type array |

## Next steps

- **[Understanding air.json](understanding-air-json.md)** — Root config file structure.
- **[Extensions System](extensions.md)** — Providers that enable remote configuration.
- **[Roots and Multi-Root Setups](roots.md)** — Subagent composition.
