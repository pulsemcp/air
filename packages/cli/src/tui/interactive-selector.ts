import * as readline from "readline";
import type {
  LocalArtifacts,
  ResolvedArtifacts,
  RootEntry,
} from "@pulsemcp/air-sdk";
import {
  buildInitialState,
  getSelectedIds,
  getVisibleItems,
  OVERRIDABLE_CATEGORIES,
  type TuiResult,
  type TuiState,
} from "./types.js";
import { render, getViewportHeight } from "./render.js";

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;]*[A-Za-z]/g;

function visibleLength(s: string): number {
  return s.replace(ANSI_RE, "").length;
}

function padLine(line: string, width: number): string {
  const vl = visibleLength(line);
  if (vl >= width) return line;
  return line + " ".repeat(width - vl);
}

/**
 * Render the full frame using absolute cursor positioning for every line.
 * No \n, no clears — just direct row,col placement. Runs inside the
 * alternate screen buffer so the main scrollback is untouched.
 */
function draw(state: TuiState): void {
  const viewportHeight = getViewportHeight(state.tabs.length);
  const lines = render(state, viewportHeight);
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;

  let buf = "\x1B[?25l"; // hide cursor

  // Fill every terminal row: content lines, then blank padding
  for (let row = 0; row < rows; row++) {
    const line = row < lines.length ? lines[row] : "";
    // Absolute move to row+1, col 1 (1-indexed)
    buf += `\x1B[${row + 1};1H` + padLine(line, cols);
  }

  buf += "\x1B[?25h"; // show cursor
  process.stdout.write(buf);
}

/** Keep cursor within visible items and adjust scroll offset */
function clampScroll(state: TuiState): void {
  const cat = state.tabs[state.activeTab];
  if (!cat) return;
  const visible = getVisibleItems(state);
  const viewportHeight = getViewportHeight(state.tabs.length);

  if (state.cursors[cat] >= visible.length) {
    state.cursors[cat] = Math.max(0, visible.length - 1);
  }
  if (state.cursors[cat] < 0) {
    state.cursors[cat] = 0;
  }

  const cursor = state.cursors[cat];
  if (cursor < state.scrollOffsets[cat]) {
    state.scrollOffsets[cat] = cursor;
  }
  if (cursor >= state.scrollOffsets[cat] + viewportHeight) {
    state.scrollOffsets[cat] = cursor - viewportHeight + 1;
  }
}

export async function runInteractiveSelector(
  artifacts: ResolvedArtifacts,
  root?: RootEntry,
  rootId?: string,
  rootAutoDetected = false,
  skipSubagentMerge = false,
  localArtifacts?: LocalArtifacts
): Promise<TuiResult | null> {
  const state = buildInitialState(
    artifacts,
    root,
    rootId,
    rootAutoDetected,
    skipSubagentMerge,
    localArtifacts
  );

  if (state.tabs.length === 0) {
    return getSelectedIds(state);
  }

  return new Promise<TuiResult | null>((resolve) => {
    readline.emitKeypressEvents(process.stdin);
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();

    // Switch to alternate screen buffer (like vim/htop)
    process.stdout.write("\x1B[?1049h");
    draw(state);

    const onResize = () => draw(state);
    process.stdout.on("resize", onResize);

    const cleanup = () => {
      process.stdin.removeListener("keypress", onKeypress);
      process.stdout.removeListener("resize", onResize);
      process.removeListener("SIGTERM", onSignal);
      process.removeListener("SIGHUP", onSignal);
      process.stdin.setRawMode(wasRaw ?? false);
      process.stdin.pause();
      // Leave alternate screen buffer — restores original terminal content
      process.stdout.write("\x1B[?25h\x1B[?1049l");
    };

    const onSignal = () => {
      cleanup();
      resolve(null);
    };
    process.on("SIGTERM", onSignal);
    process.on("SIGHUP", onSignal);

    const onKeypress = (
      str: string | undefined,
      key: readline.Key
    ) => {
      try {
      if (!key) return;

      const activeCat = state.tabs[state.activeTab];
      if (!activeCat) return;
      const isOverridable = OVERRIDABLE_CATEGORIES.has(activeCat);

      // ── Search mode input handling ──
      if (state.searchActive) {
        if (key.name === "escape") {
          state.searchActive = false;
          state.searchQuery = "";
          state.cursors[activeCat] = 0;
          state.scrollOffsets[activeCat] = 0;
          clampScroll(state);
          draw(state);
          return;
        }
        if (key.name === "return") {
          state.searchActive = false;
          const visible = getVisibleItems(state);
          if (visible.length > 0) {
            const targetId = visible[state.cursors[activeCat]]?.id;
            state.searchQuery = "";
            if (targetId) {
              const fullIdx = state.items[activeCat].findIndex(
                (i) => i.id === targetId
              );
              if (fullIdx !== -1) state.cursors[activeCat] = fullIdx;
            }
          } else {
            state.searchQuery = "";
          }
          state.scrollOffsets[activeCat] = 0;
          clampScroll(state);
          draw(state);
          return;
        }
        if (key.name === "backspace") {
          state.searchQuery = state.searchQuery.slice(0, -1);
          state.cursors[activeCat] = 0;
          state.scrollOffsets[activeCat] = 0;
          clampScroll(state);
          draw(state);
          return;
        }
        if (key.name === "up" || key.name === "down") {
          const visible = getVisibleItems(state);
          if (visible.length > 0) {
            const cursor = state.cursors[activeCat];
            if (key.name === "up") {
              state.cursors[activeCat] =
                (cursor - 1 + visible.length) % visible.length;
            } else {
              state.cursors[activeCat] = (cursor + 1) % visible.length;
            }
            clampScroll(state);
          }
          draw(state);
          return;
        }
        if (key.name === "space" && isOverridable) {
          const visible = getVisibleItems(state);
          const cursor = state.cursors[activeCat];
          if (visible[cursor]) {
            const targetId = visible[cursor].id;
            const item = state.items[activeCat].find(
              (i) => i.id === targetId
            );
            if (item && !item.readOnly) item.selected = !item.selected;
          }
          draw(state);
          return;
        }
        if (str && str.length === 1 && !key.ctrl && !key.meta) {
          state.searchQuery += str;
          state.cursors[activeCat] = 0;
          state.scrollOffsets[activeCat] = 0;
          clampScroll(state);
          draw(state);
          return;
        }
        draw(state);
        return;
      }

      // ── Normal mode ──

      if (key.name === "q" || (key.ctrl && key.name === "c")) {
        cleanup();
        resolve(null);
        return;
      }

      if (key.name === "return") {
        cleanup();
        resolve(getSelectedIds(state));
        return;
      }

      if (str === "/") {
        state.searchActive = true;
        state.searchQuery = "";
        state.cursors[activeCat] = 0;
        state.scrollOffsets[activeCat] = 0;
        draw(state);
        return;
      }

      if (key.name === "left") {
        state.activeTab =
          (state.activeTab - 1 + state.tabs.length) % state.tabs.length;
        clampScroll(state);
        draw(state);
        return;
      }
      if (key.name === "right") {
        state.activeTab = (state.activeTab + 1) % state.tabs.length;
        clampScroll(state);
        draw(state);
        return;
      }

      const items = state.items[activeCat];
      if (key.name === "up" && items.length > 0) {
        state.cursors[activeCat] =
          (state.cursors[activeCat] - 1 + items.length) % items.length;
        clampScroll(state);
        draw(state);
        return;
      }
      if (key.name === "down" && items.length > 0) {
        state.cursors[activeCat] =
          (state.cursors[activeCat] + 1) % items.length;
        clampScroll(state);
        draw(state);
        return;
      }

      if (!isOverridable) return;

      if (key.name === "space" && items.length > 0) {
        const idx = state.cursors[activeCat];
        if (!items[idx].readOnly) {
          items[idx].selected = !items[idx].selected;
        }
        draw(state);
        return;
      }

      if (str === "a") {
        for (const item of items) {
          if (!item.readOnly) item.selected = true;
        }
        draw(state);
        return;
      }

      if (str === "n") {
        for (const item of items) {
          if (!item.readOnly) item.selected = false;
        }
        draw(state);
        return;
      }

      if (str === "o" && items.length > 0) {
        const idx = state.cursors[activeCat];
        if (!items[idx].readOnly) {
          for (const item of items) {
            if (!item.readOnly) item.selected = false;
          }
          items[idx].selected = true;
        }
        draw(state);
        return;
      }
      } catch {
        cleanup();
        resolve(null);
      }
    };

    process.stdin.on("keypress", onKeypress);
  });
}
