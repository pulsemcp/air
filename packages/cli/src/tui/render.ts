import chalk from "chalk";
import type { TuiState, ArtifactItem } from "./types.js";
import {
  CATEGORY_LABELS,
  OVERRIDABLE_CATEGORIES,
  getVisibleItems,
  getAllSelectionSummary,
} from "./types.js";

/** Number of fixed lines: header(3) + tab bar(2) */
const HEADER_LINES = 5;
/** Fixed footer lines: scroll indicator(1) + search bar(1) + separator(1) + legend blank(1) + legend(1) + trailing blank(1) = 6 */
const FIXED_FOOTER_LINES = 6;

export function getViewportHeight(tabCount: number): number {
  const rows = process.stdout.rows || 24;
  // Footer varies: 6 fixed lines + one summary line per tab
  const footerLines = FIXED_FOOTER_LINES + tabCount;
  return Math.max(rows - HEADER_LINES - footerLines, 3);
}

export function render(state: TuiState, viewportHeight: number): string[] {
  const lines: string[] = [];

  // ── Header ──
  lines.push("");
  const rootLabel = state.root?.display_name || state.rootId || "unknown";
  const rootInfo = state.root
    ? `${rootLabel}${state.rootAutoDetected ? chalk.dim(" (auto-detected)") : ""}`
    : "none";
  lines.push(`  AIR Session ${chalk.dim("—")} Root: ${chalk.cyan(rootInfo)}`);
  lines.push("");

  // ── Tab bar ──
  const tabParts: string[] = [];
  for (let i = 0; i < state.tabs.length; i++) {
    const cat = state.tabs[i];
    const label = CATEGORY_LABELS[cat];
    const items = state.items[cat];
    const selectedCount = items.filter((it) => it.selected).length;
    const countStr = `${selectedCount}/${items.length}`;
    const isOverridable = OVERRIDABLE_CATEGORIES.has(cat);

    if (i === state.activeTab) {
      tabParts.push(chalk.bold.inverse(` ${label} (${countStr}) `));
    } else {
      tabParts.push(chalk.dim(` ${label} (${countStr}) `));
    }
  }
  lines.push("  " + tabParts.join(" "));
  lines.push("");

  // ── Item list (scrollable viewport) ──
  const activeCat = state.tabs[state.activeTab];
  const isOverridable = activeCat
    ? OVERRIDABLE_CATEGORIES.has(activeCat)
    : false;
  const visibleItems = getVisibleItems(state);
  const cursor = activeCat ? state.cursors[activeCat] : 0;
  const scrollOffset = activeCat ? state.scrollOffsets[activeCat] : 0;

  if (activeCat && !isOverridable) {
    lines.push(chalk.dim("  (read-only \u2014 override not yet supported)"));
  }

  if (visibleItems.length === 0) {
    if (state.searchActive && state.searchQuery) {
      lines.push(chalk.dim("  No matches"));
    } else {
      lines.push(chalk.dim("  (no items)"));
    }
    // Pad remaining viewport
    for (let i = 1; i < viewportHeight; i++) {
      lines.push("");
    }
  } else {
    const end = Math.min(scrollOffset + viewportHeight, visibleItems.length);
    const start = scrollOffset;

    for (let i = start; i < end; i++) {
      const item = visibleItems[i];
      lines.push(renderItem(item, i === cursor, isOverridable));
    }
    // Pad remaining viewport lines
    for (let i = end - start; i < viewportHeight; i++) {
      lines.push("");
    }

    // Scroll indicator
    if (visibleItems.length > viewportHeight) {
      const pct = Math.round(
        ((scrollOffset + viewportHeight) / visibleItems.length) * 100
      );
      lines.push(
        chalk.dim(`  ── ${scrollOffset + 1}-${end} of ${visibleItems.length} (${pct}%) ──`)
      );
    } else {
      lines.push("");
    }
  }

  // ── Search bar ──
  if (state.searchActive) {
    lines.push(`  ${chalk.cyan("/")}${state.searchQuery}${chalk.cyan("█")}`);
  } else {
    lines.push("");
  }

  // ── Cross-artifact selection summary ──
  lines.push(chalk.dim("  ─────────────────────────────────────────"));
  const summaries = getAllSelectionSummary(state);
  const maxWidth = (process.stdout.columns || 80) - 4;

  for (const s of summaries) {
    const isActive = s.category === activeCat;
    const prefix = isActive ? chalk.cyan("▸") : " ";
    const label = `${s.label} (${s.selected.length}/${s.total})`;

    if (s.selected.length === 0) {
      lines.push(`  ${prefix} ${chalk.dim(label)}: ${chalk.dim("(none)")}`);
    } else {
      const ids = s.selected.join(", ");
      const availableWidth = Math.max(maxWidth - label.length - 6, 0);
      const display =
        ids.length > availableWidth
          ? ids.slice(0, Math.max(availableWidth - 3, 0)) + "..."
          : ids;
      lines.push(`  ${prefix} ${chalk.white(label)}: ${chalk.green(display)}`);
    }
  }

  // ── Key legend ──
  lines.push("");
  const legendParts: string[] = [];
  if (state.searchActive) {
    legendParts.push(`${chalk.dim("↑↓")} navigate`);
    if (isOverridable) {
      legendParts.push(`${chalk.dim("Space")} toggle`);
    }
    legendParts.push(
      `${chalk.dim("Enter")} confirm`,
      `${chalk.dim("Esc")} cancel`
    );
  } else {
    legendParts.push(
      `${chalk.dim("←→")} types`,
      `${chalk.dim("↑↓")} navigate`
    );
    if (isOverridable) {
      legendParts.push(
        `${chalk.dim("Space")} toggle`,
        `${chalk.dim("a")} all`,
        `${chalk.dim("n")} none`,
        `${chalk.dim("o")} only`
      );
    }
    legendParts.push(
      `${chalk.dim("/")} search`,
      `${chalk.dim("Enter")} start`,
      `${chalk.dim("q")} quit`
    );
  }
  lines.push("  " + legendParts.join("  "));
  lines.push("");

  return lines;
}

function renderItem(
  item: ArtifactItem,
  isCursor: boolean,
  isOverridable: boolean
): string {
  const marker = item.selected ? chalk.green("●") : chalk.dim("○");

  let id: string;
  let desc: string;
  if (!isOverridable) {
    id = chalk.dim(item.id);
    desc = chalk.dim(` — ${truncate(item.description, 60)}`);
  } else if (item.selected) {
    id = chalk.white(item.id);
    desc = chalk.dim(` — ${truncate(item.description, 60)}`);
  } else {
    id = chalk.dim(item.id);
    desc = chalk.dim(` — ${truncate(item.description, 60)}`);
  }

  const prefix = isCursor ? chalk.cyan("> ") : "  ";
  return `${prefix}${marker} ${id}${desc}`;
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen - 1) + "…" : str;
}
