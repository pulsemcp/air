# Installing Extensions

The `air install` command installs extension packages declared in your `air.json` that aren't yet available locally.

## Basic usage

```bash
air install
```

This reads the `extensions` array from your `air.json`, checks which packages are already installed, and runs `npm install` for the missing ones.

## How it works

Given this `air.json`:

```json
{
  "name": "my-config",
  "extensions": [
    "@pulsemcp/air-adapter-claude",
    "@pulsemcp/air-provider-github",
    "./my-local-extension"
  ]
}
```

Running `air install`:

1. Reads the `extensions` array
2. Checks `node_modules/` for each npm package
3. Skips local paths (starting with `./`, `../`, or `/`)
4. Runs `npm install` for missing packages
5. Reports what happened

Output (stderr):

```
Installed: @pulsemcp/air-adapter-claude, @pulsemcp/air-provider-github
Skipped (local paths): ./my-local-extension
```

It also outputs structured JSON to stdout for programmatic consumption:

```json
{
  "installed": ["@pulsemcp/air-adapter-claude", "@pulsemcp/air-provider-github"],
  "alreadyInstalled": [],
  "skipped": ["./my-local-extension"]
}
```

## Options

| Flag | Description |
|------|-------------|
| `--config <path>` | Path to air.json (default: `~/.air/air.json` or `AIR_CONFIG`) |
| `--prefix <dir>` | npm install prefix directory (default: directory containing air.json) |

### Custom config path

```bash
air install --config /path/to/project/air.json
```

### Custom install prefix

By default, packages are installed in the directory containing `air.json`. Override with `--prefix`:

```bash
air install --prefix /path/to/node_modules/parent
```

This runs `npm install --prefix /path/to/node_modules/parent`.

## When to run air install

Run `air install` when:

- **Setting up a new machine** — after cloning your AIR config
- **After adding extensions to air.json** — to install newly declared packages
- **In CI/CD pipelines** — before running `air prepare`

```bash
# Typical CI setup
air install --config /path/to/air.json
air prepare claude --config /path/to/air.json --target /workspace
```

## Local extensions

Extensions can be local paths instead of npm packages:

```json
{
  "extensions": [
    "./my-extension",
    "../shared/transform"
  ]
}
```

Local paths are resolved relative to the directory containing `air.json`. They don't need installation — `air install` skips them and reports them as "Skipped (local paths)".

## Next steps

- **[Extensions System](extensions.md)** — How adapters, providers, and transforms work.
- **[Understanding air.json](understanding-air-json.md)** — The `extensions` field in detail.
- **[Running Sessions](running-sessions.md)** — Using extensions in session preparation.
