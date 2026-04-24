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
 * True iff stdin + stdout are both attached to a terminal. When either is a
 * pipe or a file (CI runners, scripted wrappers), the caller should skip
 * interactive prompts.
 */
export function isInteractiveTTY(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}
