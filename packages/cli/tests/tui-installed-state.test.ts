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
    // beta is still marked as a root default, though it is no longer selected.
    expect(rendered).toContain("  ○ @local/beta ★ — Beta");
    expect(rendered).toContain("> ● @local/alpha ★ — Alpha");
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

describe("air start TUI deselection removes what AIR installed, and nothing else (#122)", () => {
  const hookJson = (command: string) => ({ event: "session_start", command });

  function setupAllCategories() {
    const catalog = createTemp({
      "air.json": {
        name: "test",
        skills: ["./skills.json"],
        mcp: ["./mcp.json"],
        hooks: ["./hooks.json"],
        plugins: ["./plugins.json"],
        roots: ["./roots.json"],
      },
      "skills.json": {
        alpha: { description: "Alpha", path: "skills/alpha", default_in_roots: ["web"] },
        beta: { description: "Beta", path: "skills/beta" },
        gamma: { description: "Gamma", path: "skills/gamma" },
        // Shares its shortname with a directory the user already has.
        delta: { description: "Delta", path: "skills/delta" },
      },
      "mcp.json": {
        github: { type: "stdio", command: "gh-mcp", default_in_roots: ["web"] },
        slack: { type: "stdio", command: "slack-mcp" },
        linear: { type: "stdio", command: "linear-mcp" },
      },
      "hooks.json": {
        lint: { description: "Lint", path: "hooks/lint", default_in_roots: ["web"] },
        fmt: { description: "Format", path: "hooks/fmt" },
        audit: { description: "Audit", path: "hooks/audit" },
        review: { description: "Review", path: "hooks/review" },
      },
      "plugins.json": {
        kit: { description: "Kit", path: "./kit", default_in_roots: ["web"] },
      },
      "kit/.plugin/plugin.json": {
        skills: ["gamma"],
        mcp_servers: ["linear"],
        hooks: ["audit"],
      },
      "roots.json": { web: { description: "Web app" } },
      "skills/alpha/SKILL.md": skillMd("alpha"),
      "skills/beta/SKILL.md": skillMd("beta"),
      "skills/gamma/SKILL.md": skillMd("gamma"),
      "skills/delta/SKILL.md": skillMd("delta"),
      "hooks/lint/HOOK.json": hookJson("lint-cmd"),
      "hooks/fmt/HOOK.json": hookJson("fmt-cmd"),
      "hooks/audit/HOOK.json": hookJson("audit-cmd"),
      "hooks/review/HOOK.json": hookJson("review-cmd"),
    });
    // Everything in the target before AIR's first run belongs to the user.
    const target = createTemp({
      ".claude/skills/checked-in/SKILL.md": skillMd("checked-in"),
      ".claude/skills/delta/SKILL.md": "---\nname: delta\ndescription: My own delta\n---\n",
      ".claude/hooks/mine/HOOK.json": hookJson("mine-cmd"),
      // Shares its shortname with the catalog's review hook.
      ".claude/hooks/review/HOOK.json": hookJson("my-review-cmd"),
      ".mcp.json": { mcpServers: { "user-mcp": { type: "stdio", command: "user-cmd" } } },
      ".claude/settings.json": {
        hooks: {
          SessionStart: [
            { matcher: "", hooks: [{ type: "command", command: "user-hook.sh" }] },
          ],
        },
      },
    });
    return { config: join(catalog, "air.json"), target };
  }

  function fullDisk(target: string) {
    const settings = JSON.parse(
      readFileSync(join(target, ".claude", "settings.json"), "utf-8")
    );
    const hookCommands = (settings.hooks?.SessionStart ?? [])
      .flatMap((g: { hooks: { command: string }[] }) => g.hooks)
      .map((h: { command: string }) => h.command.split("/").pop())
      .sort();
    return {
      ...onDisk(target),
      hookDirs: readdirSync(join(target, ".claude", "hooks")).sort(),
      hookCommands,
      userDelta: readFileSync(join(target, ".claude", "skills", "delta", "SKILL.md"), "utf-8"),
      userReview: JSON.parse(
        readFileSync(join(target, ".claude", "hooks", "review", "HOOK.json"), "utf-8")
      ).command,
    };
  }

  it("removes each deselected skill, MCP server, hook and plugin, and leaves locked and user-authored items alone", async () => {
    const { config, target } = setupAllCategories();

    // Run 1 — the user picks the defaults plus one non-default of each kind,
    // and the catalog skill whose shortname collides with their own `delta`.
    await prepareSession({
      config,
      root: "web",
      target,
      adapter: "claude",
      skills: ["@local/alpha", "@local/beta", "@local/delta"],
      mcpServers: ["@local/github", "@local/slack"],
      hooks: ["@local/lint", "@local/fmt", "@local/review"],
      plugins: ["@local/kit"],
    });
    const userDelta = "---\nname: delta\ndescription: My own delta\n---\n";
    expect(fullDisk(target)).toEqual({
      skills: ["alpha", "beta", "checked-in", "delta", "gamma"],
      mcp: ["github", "linear", "slack", "user-mcp"],
      hookDirs: ["audit", "fmt", "lint", "mine", "review"],
      hookCommands: expect.arrayContaining(["user-hook.sh"]),
      userDelta,
      userReview: "my-review-cmd",
    });
    // AIR registers lint, fmt and audit; the user's own review directory is
    // neither overwritten nor registered.
    expect(fullDisk(target).hookCommands).toHaveLength(4);

    // Run 2 — the selector opens on that, with the user's own skills locked.
    const second = await enterSelector(config, target);
    expect(selectedRows(second)).toEqual({
      mcp: ["@local/github", "@local/slack"],
      plugins: ["@local/kit"],
      skills: ["@local/alpha", "@local/beta", "checked-in (locked)", "delta (locked)"],
    });
    expect(second.items.hooks.filter((i) => i.selected).map((i) => i.id)).toEqual([
      "@local/fmt",
      "@local/lint",
    ]);

    // Deselect one AIR-installed item per category, as Space would.
    toggle(second, "skills", "@local/beta");
    toggle(second, "mcp", "@local/slack");
    toggle(second, "hooks", "@local/fmt");
    const selection = toggle(second, "plugins", "@local/kit");
    expect(selection).toEqual({
      mcpServers: ["@local/github"],
      skills: ["@local/alpha"],
      hooks: ["@local/lint"],
      plugins: [],
    });
    await prepareSession({ config, root: "web", target, adapter: "claude", ...selection });

    // Each deselected item is gone — the plugin takes its skill, MCP server
    // and hook with it — and everything AIR didn't write is untouched,
    // including the user's own review hook, which the catalog's never replaced
    // and which the selection now leaves out.
    const after = fullDisk(target);
    expect(after).toEqual({
      skills: ["alpha", "checked-in", "delta"],
      mcp: ["github", "user-mcp"],
      hookDirs: ["lint", "mine", "review"],
      hookCommands: expect.any(Array),
      userDelta,
      userReview: "my-review-cmd",
    });
    expect(after.hookCommands).toHaveLength(2);
    expect(after.hookCommands).toContain("user-hook.sh");
    expect(after.hookCommands.join(" ")).not.toMatch(/fmt|audit/);

    // Run 3 — the deselections stick: nothing removed comes back preselected.
    const third = await enterSelector(config, target);
    expect(selectedRows(third)).toEqual({
      mcp: ["@local/github"],
      plugins: [],
      skills: ["@local/alpha", "checked-in (locked)", "delta (locked)"],
    });
    expect(third.items.hooks.filter((i) => i.selected).map((i) => i.id)).toEqual([
      "@local/lint",
    ]);
  });
});
