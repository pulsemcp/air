import { createInterface } from "readline";

export type YndResponse = "yes" | "no" | "dismiss";

/**
 * Ask a single yes/no/don't-ask-again question on stdin.
 *
 * - Prints `question` to stderr, reads a line from stdin, maps the answer.
 * - Default (empty input) is `"yes"`.
 * - `y`, `yes` → yes; `n`, `no` → no; `d`, `don't`, `dont`, `dismiss` → dismiss.
 * - Anything else → yes. We intentionally fall back to "yes" (not "no") so a
 *   distracted user pressing Enter opts in — discovery is designed to be low
 *   risk, and the user can still dismiss on the next run.
 *
 * @param question The full prompt line (include trailing "? [Y/n/d] " yourself).
 */
export async function promptYnd(question: string): Promise<YndResponse> {
  // Short-circuit when not running in a TTY — the caller is responsible for
  // gating on `isTTY()`, but this guard makes the function safe to misuse.
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return "no";
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer: string = await new Promise((resolveP) => {
      rl.question(question, (input: string) => resolveP(input));
    });
    const normalized = answer.trim().toLowerCase();
    if (normalized === "" || normalized === "y" || normalized === "yes") {
      return "yes";
    }
    if (normalized === "n" || normalized === "no") {
      return "no";
    }
    if (
      normalized === "d" ||
      normalized === "dismiss" ||
      normalized === "don't" ||
      normalized === "dont" ||
      normalized.startsWith("don")
    ) {
      return "dismiss";
    }
    return "yes";
  } finally {
    rl.close();
  }
}

/**
 * Ask a single yes/no question on stdin.
 *
 * - Prints `question` to stderr, reads a line from stdin, maps the answer.
 * - Empty input (a bare Enter) is `true` — the `[Y/n]` contract.
 * - `y` / `yes` → true. **Everything else → false.**
 *
 * Note the asymmetry with {@link promptYnd} above, which falls back to "yes"
 * on an unrecognised answer. That is right for auto-discovery, which is cheap
 * and offered again next run. It is wrong here: this prompt gates an
 * irreversible version bump, so `cancel`, `q`, `nope` or a stray keystroke
 * must not install anything. Only an answer that clearly means yes does.
 *
 * Returns false outright when not on a TTY. Callers gate on
 * {@link isInteractiveTTY} before ever reaching this, but a non-interactive
 * caller that slipped through must get the safe answer, not a hang.
 *
 * @param question The full prompt line (include the trailing "? [Y/n] ").
 */
export async function promptYesNo(question: string): Promise<boolean> {
  if (!isInteractiveTTY()) return false;

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer: string = await new Promise((resolveP) => {
      rl.question(question, (input: string) => resolveP(input));
      // EOF (Ctrl-D) never fires `question`'s callback, so settle the promise
      // here rather than hanging forever — and settle it as a decline.
      rl.once("close", () => resolveP("n"));
    });
    return isAffirmative(answer);
  } finally {
    rl.close();
  }
}

/**
 * Map a raw `[Y/n]` answer to a decision. Empty (a bare Enter), `y` and `yes`
 * mean yes; **everything else means no.**
 *
 * Split out from {@link promptYesNo} so the rule that guards an irreversible
 * version bump can be tested without a terminal.
 */
export function isAffirmative(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  return normalized === "" || normalized === "y" || normalized === "yes";
}

/**
 * True iff stdin + stdout are both attached to a terminal. When either is a
 * pipe or a file (CI runners, scripted wrappers), the caller should skip
 * interactive prompts.
 */
export function isInteractiveTTY(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}
