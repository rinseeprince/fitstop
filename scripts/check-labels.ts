/**
 * Shared-token gate. Asserts that the treatments with a single owner are
 * IMPORTED rather than retyped (docs/newdesignsystem.md), and exits non-zero on
 * any violation.
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
 *   4. No hand-rolled focus treatment — there is exactly ONE focus ring in this
 *      system (FOCUS_RING). A class string that names the brand colour inside a
 *      `focus:`/`focus-visible:` ring or border is spelling it by hand. Added
 *      2026-08-22 after a sweep found FOUR different treatments for the same
 *      control: `focus:ring-1 ring-[#0d9488]/20`, `focus-visible:ring-[#0d9488]`
 *      with neither width nor opacity, `focus:shadow-[0_0_0_3px_...]` with
 *      `focus:ring-0` disabling the shared one, and the correct literal simply
 *      retyped instead of imported.
 *
 *   3. No hand-rolled segmented control — the pill-track markup (the brand
 *      `0.05` tint plus the 2px inset that makes the track) belongs only to
 *      `<SegmentedControl>`. Added 2026-08-21 after FIVE copies were found in
 *      the tree at five different sizes and two different active weights,
 *      despite the recipe being documented since the design system landed. A
 *      recipe nobody's tooling enforces decays; this clause is why the next one
 *      cannot.
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

/** The one module allowed to spell the segmented-control track (clause 3). */
export const SEGMENTED_CONTROL_MODULE =
  "components/programs/shared/segmented-control.tsx";

/**
 * Modules exempt from clause 4. The toast's focus ring is genuinely a different
 * treatment — it carries a ring-offset and a per-variant colour (destructive,
 * success, warning) that FOCUS_RING does not model.
 */
export const FOCUS_RING_EXEMPT: readonly string[] = ["components/ui/toast.tsx"];

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

  // Clause 3 is per-file, not per-line: the track is one element, and matching
  // both halves of it on ONE line is what keeps this precise. The brand 0.05
  // tint alone appears ~60 times legitimately (hover washes, count badges, rest
  // badges); it is only a segmented-control track when it also carries the 2px
  // inset that makes the pill sit inside it.
  if (file !== SEGMENTED_CONTROL_MODULE) {
    lines.forEach((text, i) => {
      if (
        text.includes("bg-[rgba(13,148,136,0.05)]") &&
        /\bp-\[2px\]|\bp-0\.5\b/.test(text)
      ) {
        violations.push({
          file,
          line: i + 1,
          clause: "3 (hand-rolled segmented control)",
          detail:
            "segmented-control track outside the component — import <SegmentedControl> from components/programs/shared/segmented-control",
        });
      }
    });
  }

  // Clause 4: one focus ring. Matches a `focus:`/`focus-visible:` ring or
  // border naming the brand colour. Selection and "today" indicators are
  // `ring-1 ring-[#0d9488]` with NO focus prefix, so they do not match.
  if (!FOCUS_RING_EXEMPT.includes(file)) {
    lines.forEach((text, i) => {
      if (/focus(-visible)?:(ring|border)-\[#0d9488\]/.test(text)) {
        violations.push({
          file,
          line: i + 1,
          clause: "4 (hand-rolled focus treatment)",
          detail:
            "focus ring spelled by hand — import FOCUS_RING from builder-tokens",
        });
      }
    });
  }

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
    console.error(`\nFAILED — ${failures.length} shared-token violation(s):\n`);
    for (const f of failures) {
      console.error(`  [clause ${f.clause}] ${f.file}:${f.line} — ${f.detail}`);
    }
    console.error(
      "\nFix by importing the shared thing rather than retyping it: a token from" +
        "\nbuilder-tokens.ts for clauses 1-2 (mono = numbers only), or" +
        "\n<SegmentedControl> for clause 3. See docs/newdesignsystem.md. Only" +
        "\ngenuinely out-of-scope trees belong in check-labels-whitelist.ts.",
    );
    process.exit(1);
  }

  console.info(`OK — ${scanned} files scanned, shared tokens hold.`);
}

// Only run when invoked directly, so the scanner above can be unit-tested
// without the test suite walking the real tree.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
