# Managing Skills in Your Repo

AIR is usually run against a central `~/.air/air.json` that lists the catalogs your roots pull from. But most real repos also contain AIR-shaped config of their own — a `skills.json` a team committed alongside a feature, a `mcp.json` for the servers this service talks to, or a nested `air.json` that describes a team's full configuration.

This guide covers three patterns for putting AIR-managed content inside a repo, and how `air start` / `air prepare` offer to register those files with your `air.json` automatically.

## The three patterns

### 1. `.claude/skills/` — adapter-owned, always active

A repo can check `SKILL.md` files into `.claude/skills/` and they will be available to every agent session run against that repo. This is the right choice when:

- The skills are specific to this codebase and every contributor should get them
- You don't want teammates to have to opt in via their `air.json`
- You're happy for the files to live under the Claude adapter's conventional path

Local skills are never overwritten by AIR. The adapter's "local wins" rule means a catalog skill with the same ID is hidden in favor of the local file. In the `air start` TUI these entries appear with a 🔒 marker and can't be toggled off — see [Managing Skills → Local skills tracked in the repo](managing-skills.md#local-skills-tracked-in-the-repo).

This pattern is **not** discovered by AIR's auto-discovery prompt: `.claude/skills/` is adapter-owned, not AIR-managed, and the directory is deliberately skipped when scanning for AIR index files.

### 2. In-repo AIR indexes — toggleable, per-type

The repo contains a `skills.json`, `mcp.json`, `hooks.json`, `plugins.json`, `roots.json`, or `references.json` (at the root or nested in a subdirectory like `config/` or `team/`). These files follow the same schema as entries in the central catalog — they're just checked in so a team can version them together with the code they describe.

Unlike `.claude/skills/`, these files aren't picked up automatically. For AIR to use them, they have to be listed in your `air.json`:

```json
{
  "name": "my-config",
  "skills": ["./skills.json"],
  "mcp": ["./mcp.json"]
}
```

AIR's auto-discovery prompt (below) will offer to add these for you the first time it finds them.

### 3. Repo-scoped `air.json` — full composition

A repo can carry its own `air.json` (for example at `team/air.json`) that declares a complete composition of skills, MCP servers, roots, and defaults. Pulling a repo-scoped `air.json` into your user config turns the whole team's configuration on at once, without having to hand-roll the individual arrays.

```json
{
  "name": "my-config",
  "catalogs": ["./team"]
}
```

The `catalogs` field is expanded at load time — a single entry can light up all six artifact types in one go.

## Auto-discovery: the prompt you'll see

The first time you run `air start` or `air prepare` in a repo that contains AIR indexes you haven't registered, AIR shows you what it found and asks whether to add them to your `~/.air/air.json`:

```
Found AIR index files in this repo not yet in your ~/.air/air.json:
  • catalog team (3 indexes: skills, mcp, hooks)
  • skills skills.json (4 entries)
Add them to ~/.air/air.json? [Y/n/d=don't ask again]
```

Responses:

- `Y` (default — just hit Enter): AIR writes the entries to your `air.json` and continues with the session. Catalog directories go in `catalogs[]` so you get all their artifact types with a single entry; loose indexes go into the matching per-type array.
- `n`: Skip this time. The prompt will return on the next run.
- `d`: Dismiss these specific paths permanently. AIR records them in `~/.air/preferences.json` and will not offer them again in this repo.

The prompt is **TTY-only**. In non-interactive contexts (CI, piped stdin, `--skip-confirmation`, `--dry-run`, or any of the `--skill` / `--mcp-server` / etc. selection flags), discovery runs silently: nothing is printed and nothing is written. Pass `--no-discover` to suppress the prompt even in a TTY.

### How paths get routed

The prompt uses a simple rule of thumb: prefer the coarsest registration that still captures what's there.

| Discovered shape                          | Added to                    |
| ----------------------------------------- | --------------------------- |
| `<dir>/<type>/<type>.json` (catalog)      | `catalogs[]`                |
| Nested `air.json`                         | `catalogs[]` (parent dir)   |
| A single `skills.json` at the repo root   | `skills[]`                  |
| A single `mcp.json` under `config/`       | `mcp[]`                     |

This keeps the generated `air.json` small — a team folder with six artifact types becomes a single `catalogs` entry instead of six parallel array pushes.

### What gets skipped

Auto-discovery is deliberately conservative. It skips:

- `.git/`, `node_modules/`, `dist/`, `build/`, `coverage/`, hidden directories
- `.claude/` (adapter-owned, handled separately by the read-only local-skills flow)
- Files already referenced from your `air.json` (by relative path or absolute path, normalized)
- Anything deeper than 3 levels below the git root
- Files whose `$schema` points to a non-AIR schema, or contradicts the filename
- `*.schema.json` files

Anchor resolution: AIR uses `git rev-parse --show-toplevel` to find the repo root and scans from there. Outside a git repo, it scans from the target directory. Running from a subdirectory still scans the full repo.

### Preferences file

Dismissals live in `~/.air/preferences.json`:

```json
{
  "autoDiscovery": {
    "dismissed": [
      {
        "repoRoot": "/Users/you/work/my-repo",
        "indexPath": "vendor/third-party-skills.json"
      }
    ]
  }
}
```

You can hand-edit this file to un-dismiss a path (remove the entry) or to pre-populate dismissals in a shared dotfile setup.

## Choosing a pattern

- **Just need a couple of skills everyone gets?** Put them in `.claude/skills/`. Zero `air.json` changes required.
- **Want teammates to be able to toggle skills on and off per session?** Use an in-repo `skills.json` and accept the auto-discovery prompt.
- **Have a team config with multiple artifact types that belong together?** Put them under a `team/` directory in the catalog layout and register `./team` in `catalogs[]`.

## Next steps

- **[Managing Skills](managing-skills.md)** — Define skills and understand the SKILL.md format.
- **[Understanding air.json](understanding-air-json.md)** — Deep dive into the composition rules that back these registrations.
- **[Running Sessions](running-sessions.md)** — Use `air start` and `air prepare` once your indexes are registered.
