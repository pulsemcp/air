# Validating Configuration

The `air validate` command checks your JSON files against AIR's JSON Schemas, catching errors before they cause runtime failures.

## Basic usage

```bash
air validate <file>
```

Validate your root config:

```bash
air validate ~/.air/air.json
```

Successful output:

```
✓ ~/.air/air.json is valid (schema: air)
```

Failed output:

```
✗ ~/.air/air.json has validation errors (schema: air):
  /name: must match pattern "^[a-zA-Z0-9_-]+$"
```

## Schema detection

The validate command determines which schema to use via three mechanisms, in priority order:

1. **`--schema` flag** — explicit override, always wins
2. **`$schema` field** — if present in the JSON file, matched against known schema URIs
3. **Filename matching** — checks for substrings in the filename

For filename matching, these substrings are checked in order:

| Filename contains | Schema used |
|-------------------|-------------|
| `references` | references |
| `plugins` | plugins |
| `skills` | skills |
| `roots` | roots |
| `hooks` | hooks |
| `mcp` | mcp |
| `air` | air |

For example, `my-skills.json` is detected as a skills file. `mcp-servers.json` is detected as an MCP file.

### Overriding detection

If auto-detection picks the wrong schema, use `--schema`:

```bash
air validate config.json --schema skills
```

Valid schema types: `air`, `skills`, `references`, `mcp`, `plugins`, `roots`, `hooks`.

### Using $schema in your files

You can also set the `$schema` field in your JSON files for editor autocomplete and validation. The validate command recognizes this field:

```json
{
  "$schema": "https://raw.githubusercontent.com/pulsemcp/air/main/schemas/air.schema.json",
  "name": "my-config"
}
```

## What gets validated

The schemas check:

- **Required fields** — e.g., `name` in air.json, `id` and `description` in skills
- **Field types** — strings, arrays, objects, booleans, numbers
- **String constraints** — patterns, min/max length
- **Enum values** — e.g., hook events, MCP server types
- **Conditional requirements** — e.g., `command` required when MCP type is `stdio`
- **No additional properties** — unknown fields are rejected

## Validating all your files

Validate everything in your AIR directory:

```bash
air validate ~/.air/air.json
air validate ~/.air/skills/skills.json
air validate ~/.air/mcp/mcp.json
air validate ~/.air/references/references.json
air validate ~/.air/plugins/plugins.json
air validate ~/.air/roots/roots.json
air validate ~/.air/hooks/hooks.json
```

Or in a loop:

```bash
for f in ~/.air/air.json ~/.air/*//*.json; do
  air validate "$f"
done
```

## Reading validation errors

Errors include a JSON path and a message:

```
✗ ~/.air/mcp/mcp.json has validation errors (schema: mcp):
  /github/type: must be equal to one of the allowed values
  /analytics: must have required property 'url'
```

- `/github/type` — the `type` field inside the `github` server entry
- `/analytics` — the `analytics` server entry is missing `url`

## Common validation errors

### Missing required fields

```
/my-skill: must have required property 'description'
```

Add the missing field to your index entry.

### Invalid ID pattern

```
/name: must match pattern "^[a-zA-Z0-9_-]+$"
```

IDs and names can only contain letters, numbers, hyphens, and underscores. No spaces or special characters.

### Transport type mismatch

```
/my-server: must NOT have additional properties (url)
```

A `stdio` server cannot have a `url` field. Check that your transport type matches the fields you've provided.

### Schema type not detected

```
Error: Could not detect schema type for "config.json". Use --schema to specify.
```

The filename doesn't match any known pattern. Use `--schema` explicitly.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | File is valid |
| 1 | File is invalid or an error occurred |

This makes `air validate` usable in CI pipelines and pre-commit hooks:

```bash
air validate ~/.air/air.json || exit 1
```

## Next steps

- **[Understanding air.json](understanding-air-json.md)** — Learn about the root config file structure.
- **[Configuring MCP Servers](mcp-servers/readme.md)** — MCP server schema details.
- **[Hooks](hooks/readme.md)** — Hook schema and lifecycle events.
