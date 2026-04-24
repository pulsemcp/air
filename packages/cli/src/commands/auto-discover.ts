import {
  findOfferableIndexes,
  acceptOffers,
  dismissOffers,
  type OfferableDiscoveryResult,
} from "@pulsemcp/air-sdk";
import { promptYnd, isInteractiveTTY } from "../prompts.js";

export interface RunAutoDiscoveryOptions {
  /** Target directory (defaults to process.cwd() on the SDK side). */
  cwd?: string;
  /** Path to air.json (defaults to the usual resolution). */
  configPath?: string;
  /** True if discovery should be skipped regardless of TTY state (e.g. --no-discover). */
  disabled?: boolean;
  /** True if the invocation is marked non-interactive (e.g. --skip-confirmation). */
  nonInteractive?: boolean;
}

export interface RunAutoDiscoveryResult {
  /** Whether discovery made changes to air.json — useful for callers that need to reload config. */
  airJsonChanged: boolean;
}

/**
 * Run the discover → prompt → accept/dismiss loop for `air start` / `air prepare`.
 *
 * Silently no-ops when:
 * - `disabled` is true (caller supplied --no-discover)
 * - `nonInteractive` is true (--skip-confirmation or flag-driven invocation)
 * - stdin/stdout isn't a TTY (CI, pipes)
 * - discovery finds nothing not-already-registered
 *
 * On accept, mutates `~/.air/air.json` and prints a one-line summary per entry.
 * On dismiss, writes to `~/.air/preferences.json` so the prompt doesn't return.
 */
export async function runAutoDiscovery(
  options: RunAutoDiscoveryOptions = {}
): Promise<RunAutoDiscoveryResult> {
  if (options.disabled) return { airJsonChanged: false };
  if (options.nonInteractive) return { airJsonChanged: false };
  if (!isInteractiveTTY()) return { airJsonChanged: false };

  let offers: OfferableDiscoveryResult;
  try {
    offers = findOfferableIndexes({
      cwd: options.cwd,
      configPath: options.configPath,
    });
  } catch {
    // Discovery must never break session startup.
    return { airJsonChanged: false };
  }

  if (!offers.hasOffers) return { airJsonChanged: false };

  const lines: string[] = [];
  lines.push(
    "Found AIR index files in this repo not yet in your ~/.air/air.json:"
  );
  for (const cat of offers.catalogs) {
    const typeSummary =
      cat.types.length === 1
        ? `1 index: ${cat.types[0]}`
        : `${cat.types.length} indexes: ${cat.types.join(", ")}`;
    lines.push(`  • catalog ${cat.relPath || "."} (${typeSummary})`);
  }
  for (const airJson of offers.airJsons) {
    lines.push(`  • air.json ${airJson.relPath}`);
  }
  for (const loose of offers.looseIndexes) {
    const count = loose.entryCount;
    const noun = loose.type;
    lines.push(`  • ${noun} ${loose.relPath} (${count} ${count === 1 ? "entry" : "entries"})`);
  }

  // Writing the summary to stderr keeps stdout clean for any consumer that
  // pipes the command's JSON output (e.g. `air prepare | jq`).
  process.stderr.write(lines.join("\n") + "\n");

  const answer = await promptYnd(
    "Add them to ~/.air/air.json? [Y/n/d=don't ask again] "
  );

  if (answer === "no") {
    return { airJsonChanged: false };
  }

  if (answer === "dismiss") {
    try {
      dismissOffers(offers);
      process.stderr.write(
        "Dismissed — AIR won't offer these again for this repo.\n"
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Warning: could not save preferences: ${message}\n`);
    }
    return { airJsonChanged: false };
  }

  // "yes"
  try {
    const result = acceptOffers(offers, { configPath: options.configPath });
    if (result.createdScaffold) {
      process.stderr.write(
        `Created ${result.airJsonPath} with a new scaffold.\n`
      );
    }
    for (const entry of result.added) {
      process.stderr.write(
        `Added ${entry.label} to ${result.airJsonPath}.\n`
      );
    }
    return { airJsonChanged: result.added.length > 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `Warning: could not update air.json: ${message}\n`
    );
    return { airJsonChanged: false };
  }
}
