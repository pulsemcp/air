import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve, join } from "path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import {
  computeMergedDefaults,
  getInstalledSelection,
  prepareSession,
  startSession,
} from "@pulsemcp/air-sdk";
import { buildInitialState, getSelectedIds } from "../src/tui/types.js";
import { render } from "../src/tui/render.js";

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;]*[A-Za-z]/g;

const tempDirs: string[] = [];
let airHomeDir: string;
let originalAirHome: string | undefined;

beforeEach(() => {
  airHomeDir = resolve(
    tmpdir(),
    `air-home-tui-installed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  originalAirHome = process.env.AIR_HOME;
  process.env.AIR_HOME = airHomeDir;
});

afterEach(() => {
  for (const dir of [...tempDirs, airHomeDir]) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
  if (originalAirHome === undefined) delete process.env.AIR_HOME;
  else process.env.AIR_HOME = originalAirHome;
});

function createTemp(files: Record<string, unknown>): string {
  const dir = resolve(
    tmpdir(),
    `air-cli-tui-installed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

const skillMd = (id: string) =>
  `---\nname: ${id}\ndescription: The ${id} skill\n---\n`;

/**
 * `plugins` is the thin plugins.json index (description + path +
 * default_in_roots); `pluginBodies` maps a plugin id to the
 * `<id>/.plugin/plugin.json` manifest its entry points at. Inline plugin
 * bodies were removed in https://github.com/pulsemcp/air/issues/157, so the
 * two halves are always written together.
 */
function setup(
  plugins: Record<string, unknown> = {},
  pluginBodies: Record<string, unknown> = {}
) {
  const catalog = createTemp({
    "air.json": {
      name: "test",
      skills: ["./skills.json"],
      mcp: ["./mcp.json"],
      plugins: ["./plugins.json"],
      roots: ["./roots.json"],
    },
    "plugins.json": plugins,
    "skills.json": {
      alpha: { description: "Alpha", path: "skills/alpha", default_in_roots: ["web"] },
      beta: { description: "Beta", path: "skills/beta", default_in_roots: ["web"] },
      gamma: { description: "Gamma", path: "skills/gamma" },
    },
    "mcp.json": {
      github: { type: "stdio", command: "gh-mcp", default_in_roots: ["web"] },
      slack: { type: "stdio", command: "slack-mcp" },
    },
    "roots.json": { web: { description: "Web app" } },
    "skills/alpha/SKILL.md": skillMd("alpha"),
    "skills/beta/SKILL.md": skillMd("beta"),
    "skills/gamma/SKILL.md": skillMd("gamma"),
    ...Object.fromEntries(
      Object.entries(pluginBodies).map(([id, body]) => [
        `${id}/.plugin/plugin.json`,
        body,
      ])
    ),
  });
  const target = createTemp({
    ".claude/skills/checked-in/SKILL.md": skillMd("checked-in"),
  });
  return { config: join(catalog, "air.json"), target };
}

/** Enter the selector the way `air start claude` does and return its state. */
async function enterSelector(config: string, target: string) {
  const result = await startSession("claude", {
    config,
    root: "web",
    checkAvailability: false,
    localScanDir: target,
  });
  const merged = computeMergedDefaults(result.root, result.artifacts);
  const installed = getInstalledSelection({
    target,
    adapter: result.adapterName,
    artifacts: result.artifacts,
    defaults: {
      skills: merged.skillIds,
      mcpServers: merged.mcpServerIds,
      hooks: merged.hookIds,
      plugins: merged.pluginIds,
    },
  });
  return buildInitialState(
    result.artifacts,
    result.root,
    "web",
    false,
    false,
    result.localArtifacts,
    installed ?? undefined
  );
}

function selectedRows(state: ReturnType<typeof buildInitialState>) {
  return {
    mcp: state.items.mcp.filter((i) => i.selected).map((i) => i.id),
    plugins: state.items.plugins.filter((i) => i.selected).map((i) => i.id),
    skills: state.items.skills
      .filter((i) => i.selected)
      .map((i) => (i.readOnly ? `${i.id} (locked)` : i.id)),
  };
}

function onDisk(target: string) {
  const mcpJson = JSON.parse(readFileSync(join(target, ".mcp.json"), "utf-8"));
  return {
    skills: readdirSync(join(target, ".claude", "skills")).sort(),
    mcp: Object.keys(mcpJson.mcpServers).sort(),
  };
}

/** Flip one row, as Space on it would, and return what Enter hands back. */
function toggle(
  state: ReturnType<typeof buildInitialState>,
  category: "mcp" | "skills" | "hooks" | "plugins",
  id: string
) {
  const item = state.items[category].find((i) => i.id === id);
  if (!item) throw new Error(`no ${category} row ${id}`);
  item.selected = !item.selected;
  return getSelectedIds(state);
}

describe("air start TUI preselection follows what is installed (#122)", () => {
  it("preselects root defaults on the first run, then the prior selection on the next", async () => {
    const { config, target } = setup();

    // Run 1 — nothing installed yet: root defaults, plus the locked local skill.
    const first = await enterSelector(config, target);
    expect(selectedRows(first)).toEqual({
      mcp: ["@local/github"],
      plugins: [],
      skills: ["@local/alpha", "@local/beta", "checked-in (locked)"],
    });

    // The user picks a non-default set; AIR writes it to disk.
    await prepareSession({
      config,
      root: "web",
      target,
      adapter: "claude",
      skills: ["@local/alpha", "@local/gamma"],
      mcpServers: ["@local/slack"],
    });
    expect(onDisk(target)).toEqual({
      skills: ["alpha", "checked-in", "gamma"],
      mcp: ["slack"],
    });

    // Run 2 — the TUI opens on what is on disk, not on the root defaults.
    const second = await enterSelector(config, target);
    expect(selectedRows(second)).toEqual({
      mcp: ["@local/slack"],
      plugins: [],
      skills: ["@local/alpha", "@local/gamma", "checked-in (locked)"],
    });
    const skillsTab = second.tabs.indexOf("skills");
    second.activeTab = skillsTab;
    const rendered = render(second, 10).map((l) => l.replace(ANSI_RE, ""));
    expect(rendered).toContain("  ● @local/gamma — Gamma");
    expect(rendered).toContain("  ○ @local/beta — Beta");
    // AIR's own copies are not mistaken for skills checked into the repo.
    expect(rendered.filter((l) => l.includes("🔒"))).toEqual([
      expect.stringContaining("local skills are tracked"),
      "  🔒 checked-in — The checked-in skill",
    ]);

    // Enter without toggling anything leaves the directory exactly as it was.
    await prepareSession({
      config,
      root: "web",
      target,
      adapter: "claude",
      ...getSelectedIds(second),
    });
    expect(onDisk(target)).toEqual({
      skills: ["alpha", "checked-in", "gamma"],
      mcp: ["slack"],
    });
  });
  it("does not preselect a non-default plugin, so deselecting one of its skills still removes it", async () => {
    // bundle covers exactly the default skills, but nobody picked it.
    const { config, target } = setup(
      { bundle: { description: "Bundle", path: "./bundle" } },
      { bundle: { skills: ["alpha", "beta"] } }
    );
    await prepareSession({ config, root: "web", target, adapter: "claude" });
    expect(onDisk(target).skills).toEqual(["alpha", "beta", "checked-in"]);

    const second = await enterSelector(config, target);
    expect(selectedRows(second).plugins).toEqual([]);

    await prepareSession({
      config,
      root: "web",
      target,
      adapter: "claude",
      ...toggle(second, "skills", "@local/alpha"),
    });
    expect(onDisk(target).skills).toEqual(["beta", "checked-in"]);
  });

  it("preselects a kept default plugin and leaves its skills to it, so Enter is a no-op and deselecting it removes them", async () => {
    const { config, target } = setup(
      {
        kit: {
          description: "Kit",
          path: "./kit",
          default_in_roots: ["web"],
        },
      },
      { kit: { skills: ["gamma"] } }
    );
    // Run 1 keeps the defaults: alpha, beta, and gamma via the kit plugin.
    await prepareSession({ config, root: "web", target, adapter: "claude" });
    expect(onDisk(target).skills).toEqual(["alpha", "beta", "checked-in", "gamma"]);

    const second = await enterSelector(config, target);
    expect(selectedRows(second)).toEqual({
      mcp: ["@local/github"],
      plugins: ["@local/kit"],
      skills: ["@local/alpha", "@local/beta", "checked-in (locked)"],
    });
    await prepareSession({
      config,
      root: "web",
      target,
      adapter: "claude",
      ...getSelectedIds(second),
    });
    expect(onDisk(target).skills).toEqual(["alpha", "beta", "checked-in", "gamma"]);

    const third = await enterSelector(config, target);
    await prepareSession({
      config,
      root: "web",
      target,
      adapter: "claude",
      ...toggle(third, "plugins", "@local/kit"),
    });
    expect(onDisk(target).skills).toEqual(["alpha", "beta", "checked-in"]);

    // And it stays off: the kit's skill is gone, so the kit isn't preselected.
    expect(selectedRows(await enterSelector(config, target)).plugins).toEqual([]);
  });
});
