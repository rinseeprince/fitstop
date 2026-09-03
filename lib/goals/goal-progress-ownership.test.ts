import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Goal position is composed ONCE, by `deriveGoalProgress` (`./goal-progress.ts`),
 * from a goal and the readings in force AT A DATE — and on the check-in review
 * that date is the check-in's own day (docs/MEASUREMENT-LOG-PLAN.md commit 8b):
 * the position comes from `getReadingsAsOf` and nothing else. Never the client
 * record's current reading, which is today's; never a bare check-in field,
 * which is a report with every field optional — a goal row built from one read
 * a weightless check-in as "No goals" for a client whose weight was in the log.
 * The Overview and the Journey keep reading today, so the two as-of reads have
 * exactly one caller.
 *
 * This scan, in the shape of `lib/check-in/adherence-ownership.test.ts`, keeps
 * the composition in one place, the check-in out of it, the review's readings
 * coming from the as-of read, and the as-of reads on the review path alone.
 */
const ROOT = join(__dirname, "..", "..");
const KERNEL = "lib/goals/goal-progress.ts";
const REVIEW = "services/comparison-service.ts";
const SCAN: string[] = ["services", "lib/goals"];
// Where a second caller of the as-of reads would appear.
const AS_OF_SCAN: string[] = ["app", "components", "hooks", "lib", "services", "utils"];
const AS_OF_OWNERS = new Set<string>([
  "services/measurements-service.ts",
  "services/client-goals-service.ts",
]);

const PRIMITIVES = /\b(calculateGoalProgress|deriveGoalStatus|computeGoalPace)\b/g;
// `currentCheckIn`, `firstCheckIn`, `checkIns`, `CheckIn`… — any identifier
// naming a check-in. The hyphenated import path `@/types/check-in` is not one.
const CHECK_IN_IDENT = /\b\w*[cC]heckIn\w*\b/g;
// The client record's reading — today's, through `client_current_measurements`.
const RECORD_READING = /\bclient\.(currentWeight|currentBodyFatPercentage)\b/g;
const AS_OF_READS = /\b(getReadingsAsOf|getGoalAsOf)\b/g;

function filesUnder(target: string): string[] {
  const abs = join(ROOT, target);
  if (statSync(abs).isFile()) return [abs];
  const out: string[] = [];
  for (const entry of readdirSync(abs)) {
    const full = join(abs, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(join(target, entry)));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

// Comments explain the rule and must not trip it.
const stripComments = (src: string) =>
  src
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

/** The argument text of every `${needle}` call in `src`, by balanced parens. */
function callArguments(src: string, needle: string): string[] {
  const out: string[] = [];
  let from = src.indexOf(needle);
  while (from !== -1) {
    let depth = 1;
    let i = from + needle.length;
    while (i < src.length && depth > 0) {
      if (src[i] === "(") depth += 1;
      else if (src[i] === ")") depth -= 1;
      i += 1;
    }
    out.push(src.slice(from + needle.length, i - 1));
    from = src.indexOf(needle, i);
  }
  return out;
}

/** Top-level comma split, honouring (), [] and {} nesting. */
function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    else if (ch === "," && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.map((part) => part.trim()).filter((part) => part.length > 0);
}

/**
 * The identifier the review binds `getReadingsAsOf`'s result to — from its
 * `const [a, b, …] = await Promise.all([…])` destructure, matched by position.
 */
function asOfBinding(src: string): string | null {
  const match = /const\s*\[([^\]]*)\]\s*=\s*await\s+Promise\.all\(\[/.exec(src);
  if (!match) return null;
  const names = splitTopLevel(match[1]);
  const arrayStart = match.index + match[0].length;
  let depth = 1;
  let i = arrayStart;
  while (i < src.length && depth > 0) {
    if (src[i] === "[" || src[i] === "(" || src[i] === "{") depth += 1;
    else if (src[i] === "]" || src[i] === ")" || src[i] === "}") depth -= 1;
    i += 1;
  }
  const elements = splitTopLevel(src.slice(arrayStart, i - 1));
  const index = elements.findIndex((element) => element.startsWith("getReadingsAsOf("));
  return index === -1 ? null : (names[index] ?? null);
}

describe("deriveGoalProgress owns goal position", () => {
  it("is the only caller of the three primitives under services/ and lib/goals/", () => {
    const offenders: string[] = [];

    for (const target of SCAN) {
      for (const file of filesUnder(target)) {
        const rel = relative(ROOT, file);
        if (rel === KERNEL) continue;
        const src = stripComments(readFileSync(file, "utf8"));
        for (const match of src.matchAll(PRIMITIVES)) offenders.push(`${rel} — ${match[0]}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("takes a goal and readings, and knows nothing of a check-in", () => {
    const src = stripComments(readFileSync(join(ROOT, KERNEL), "utf8"));

    expect([...src.matchAll(CHECK_IN_IDENT)].map((match) => match[0])).toEqual([]);
  });

  it("is never handed a check-in's field", () => {
    const offenders: string[] = [];
    let calls = 0;

    for (const file of filesUnder("services")) {
      const src = stripComments(readFileSync(file, "utf8"));
      for (const args of callArguments(src, "deriveGoalProgress(")) {
        calls += 1;
        for (const match of args.matchAll(CHECK_IN_IDENT)) {
          offenders.push(`${relative(ROOT, file)} — ${match[0]}`);
        }
      }
    }

    // The guard is worthless if it found nothing to guard.
    expect(calls).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it("on the review, the position is the reading as of the check-in's day — from getReadingsAsOf, never the record's reading", () => {
    const src = stripComments(readFileSync(join(ROOT, REVIEW), "utf8"));

    const binding = asOfBinding(src);
    expect(binding).not.toBeNull();

    const calls = callArguments(src, "deriveGoalProgress(");
    expect(calls).toHaveLength(1);
    const [args] = calls;
    expect([...args.matchAll(RECORD_READING)].map((match) => match[0])).toEqual([]);
    expect(args).toMatch(new RegExp(`\\b${binding}\\.weight\\b`));
    expect(args).toMatch(new RegExp(`\\b${binding}\\.bodyFat\\b`));
  });

  it("the as-of reads have one caller, the review — the Overview and the Journey keep reading today", () => {
    const offenders: string[] = [];

    for (const target of AS_OF_SCAN) {
      for (const file of filesUnder(target)) {
        const rel = relative(ROOT, file);
        if (rel === REVIEW || AS_OF_OWNERS.has(rel)) continue;
        const src = stripComments(readFileSync(file, "utf8"));
        for (const match of src.matchAll(AS_OF_READS)) offenders.push(`${rel} — ${match[0]}`);
      }
    }

    expect(offenders).toEqual([]);

    // …and the review really calls both.
    const review = stripComments(readFileSync(join(ROOT, REVIEW), "utf8"));
    expect(review).toMatch(/\bgetReadingsAsOf\(/);
    expect(review).toMatch(/\bgetGoalAsOf\(/);
  });

  it("scans a real tree — the guard is worthless if the glob is empty", () => {
    const count = SCAN.reduce((n, t) => n + filesUnder(t).length, 0);
    expect(count).toBeGreaterThan(40);
    const wide = AS_OF_SCAN.reduce((n, t) => n + filesUnder(t).length, 0);
    expect(wide).toBeGreaterThan(200);
  });
});
