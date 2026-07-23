/**
 * Typography-label gate. Asserts the mono=numbers-only token discipline
 * (docs/newdesignsystem.md, "Typography") and exits non-zero on any violation.
 *
 *   npx tsx scripts/check-labels.ts          (or: npm run check:labels)
 *
 *   1. The literal `font-mono-display` appears ONLY in the token modules —
 *      every call site imports a token (MONO, MONO_META_CLASS, …), so a raw
 *      utility string cannot drift back in.
 *   2. No hand-rolled uppercase label treatment — a class string carrying both
 *      `uppercase` and a `tracking-` value must come from a token
 *      (LABEL_CLASS / MONO_LABEL_CLASS / SECTION_LABEL_CLASS /
 *      STAT_LABEL_DARK_CLASS / HEADER_EYEBROW_CLASS).
 *
 * WHY THIS EXISTS
 * The 2026-07-23 typography sweep classified 361 sites: 67 violated the
 * mono=numbers-only rule and 236 more were compliant but hand-rolled — each
 * one a future drift. Review didn't catch them accumulating, so the gate must
 * read the tree, mirroring scripts/assert-rls.ts (review failed there too).
 *
 * The whitelist (scripts/check-labels-whitelist.ts) encodes the scope decision:
 * client-facing web-harness trees, frozen legacy, and un-migrated pages. It is
 * an explicit file so widening scope = deleting a line there, not editing this.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { LABEL_WHITELIST } from "./check-labels-whitelist";

/** Modules allowed to define label/mono class literals. */
export const TOKEN_MODULES: readonly string[] = [
  "components/clients/training/program-builder/builder-tokens.ts",
  "components/clients/training/calendar/calendar-tokens.ts",
];

/** Directories the gate scans (repo-relative). */
export const SCAN_ROOTS: readonly string[] = ["app", "components"];

export type LabelViolation = {
  file: string;
  line: number;
  clause: string;
  detail: string;
};

export function isWhitelisted(
  file: string,
  whitelist: readonly string[] = LABEL_WHITELIST,
): boolean {
  return whitelist.some((prefix) => file.startsWith(prefix));
}

/**
 * Scan one file's content. Pure, so the clauses can be unit-tested without
 * touching the tree.
 */
export function findLabelViolations(
  file: string,
  content: string,
  whitelist: readonly string[] = LABEL_WHITELIST,
): LabelViolation[] {
  if (TOKEN_MODULES.includes(file) || isWhitelisted(file, whitelist)) return [];

  const violations: LabelViolation[] = [];
  const lines = content.split("\n");

  lines.forEach((text, i) => {
    // The CSS-variable form `var(--font-mono-display)` is legitimate outside
    // token modules (recharts style objects can't take a class), so only the
    // bare class utility counts.
    if (/(?<!-)\bfont-mono-display\b/.test(text)) {
      violations.push({
        file,
        line: i + 1,
        clause: "1 (raw mono literal)",
        detail: "font-mono-display outside a token module — import MONO or a MONO_* token from builder-tokens",
      });
    }
    // Hand-rolled uppercase label treatment: `uppercase` composed with a
    // tracking value in the same class string. `tracking-normal` is the
    // sanctioned reset appended AFTER a token (e.g. MONO_LABEL_CLASS +
    // "normal-case tracking-normal"), so it does not count as hand-rolling.
    if (
      /\buppercase\b/.test(text) &&
      /\btracking-(?!normal\b)/.test(text)
    ) {
      violations.push({
        file,
        line: i + 1,
        clause: "2 (hand-rolled uppercase label)",
        detail: "uppercase + tracking-* outside a token module — use LABEL_CLASS / MONO_LABEL_CLASS / SECTION_LABEL_CLASS / STAT_LABEL_DARK_CLASS / HEADER_EYEBROW_CLASS",
      });
    }
  });

  return violations;
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      yield* walk(full);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      yield full;
    }
  }
}

function main(): void {
  const root = process.cwd();
  const failures: LabelViolation[] = [];
  let scanned = 0;

  for (const scanRoot of SCAN_ROOTS) {
    for (const abs of walk(join(root, scanRoot))) {
      const rel = relative(root, abs).replaceAll("\\", "/");
      scanned += 1;
      failures.push(...findLabelViolations(rel, readFileSync(abs, "utf8")));
    }
  }

  if (failures.length > 0) {
    console.error(`\nFAILED — ${failures.length} typography-label violation(s):\n`);
    for (const f of failures) {
      console.error(`  [clause ${f.clause}] ${f.file}:${f.line} — ${f.detail}`);
    }
    console.error(
      "\nFix by importing a token from builder-tokens.ts (mono = numbers only —" +
        "\nsee docs/newdesignsystem.md, Typography). Only genuinely out-of-scope" +
        "\ntrees belong in scripts/check-labels-whitelist.ts.",
    );
    process.exit(1);
  }

  console.info(`OK — ${scanned} files scanned, typography tokens hold.`);
}

// Only run when invoked directly, so the scanner above can be unit-tested
// without the test suite walking the real tree.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
