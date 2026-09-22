import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Goal position is composed ONCE, by `deriveGoalProgress` (`./goal-progress.ts`),
 * from a goal and the readings in force AT A DATE. A check-in's goal section
 * is composed once more narrowly still: when the copy the check-in saves is
 * built (lib/check-in/sent-snapshot.ts, migration 195) — at Send, or by the
 * one-off fill for a check-in sent before copies existed — through
 * `composeGoalSection`, and frozen. The date is the check-in's own day: the
 * goal judged is the one in force that day, the position comes from the
 * reading as of that day (`getReadingsAsOf`, or the reported value at Send —
 * never the client record's current reading, which is today's; never a bare
 * check-in field), and the goal's progress runs from the client's reading on
 * the goal's own start day (`getReadingsOnDay`). The review then reads the
 * saved section and composes nothing (owner ruling 2026-09-22: a sent
 * check-in is frozen in time). The Overview and the Journey keep reading
 * today, so the as-of read belongs to the two builders alone.
 *
 * This scan, in the shape of `lib/check-in/adherence-ownership.test.ts`, keeps
 * the composition in one place, the check-in out of it, the section judged on
 * the check-in's day from the as-of and start-day reads, and the review off
 * the kernel.
 */
const ROOT = join(__dirname, "..", "..");
const KERNEL = "lib/goals/goal-progress.ts";
const COMPOSER = "lib/check-in/sent-snapshot-goal.ts";
const BUILDERS = [
  "services/check-in-sent-snapshot-service.ts",
  "services/check-in-sent-snapshot-fill.ts",
];
const REVIEW = "services/comparison-service.ts";
const SCAN: string[] = ["services", "lib/goals", "lib/check-in"];
// Where a second caller of the as-of read would appear.
const AS_OF_SCAN: string[] = ["app", "components", "hooks", "lib", "services", "utils"];
const AS_OF_OWNERS = new Set<string>(["services/measurements-service.ts", ...BUILDERS]);

const PRIMITIVES = /\b(calculateGoalProgress|deriveGoalStatus|computeGoalPace)\b/g;
// `currentCheckIn`, `firstCheckIn`, `checkIns`, `CheckIn`… — any identifier
// naming a check-in. The hyphenated import path `@/types/check-in` is not one.
const CHECK_IN_IDENT = /\b\w*[cC]heckIn\w*\b/g;
// The client record's reading — today's, through `client_current_measurements`.
const RECORD_READING = /\bclient\.(currentWeight|currentBodyFatPercentage)\b/g;
const AS_OF_READS = /\bgetReadingsAsOf\b/g;
// What composing a goal section takes; the review may call none of it.
const COMPOSING = /\b(deriveGoalProgress|composeGoalSection|getReadingsAsOf|getReadingsOnDay|goalAsOf|checkInTrend)\b/g;

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

const source = (file: string) => stripComments(readFileSync(join(ROOT, file), "utf8"));

describe("deriveGoalProgress owns goal position", () => {
  it("is the only caller of the three primitives under services/, lib/goals/ and lib/check-in/", () => {
    const offenders: string[] = [];

    for (const target of SCAN) {
      for (const file of filesUnder(target)) {
        const rel = relative(ROOT, file);
        // The kernel composes them; goal-pace.ts is where `computeGoalPace` lives.
        if (rel === KERNEL || rel === "lib/check-in/goal-pace.ts") continue;
        const src = stripComments(readFileSync(file, "utf8"));
        for (const match of src.matchAll(PRIMITIVES)) offenders.push(`${rel} — ${match[0]}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("takes a goal and readings, and knows nothing of a check-in", () => {
    expect([...source(KERNEL).matchAll(CHECK_IN_IDENT)].map((match) => match[0])).toEqual([]);
  });

  it("is called by the goal section's composer alone, and never handed a check-in's field", () => {
    const callers: string[] = [];
    const offenders: string[] = [];

    for (const target of SCAN) {
      for (const file of filesUnder(target)) {
        const rel = relative(ROOT, file);
        const src = stripComments(readFileSync(file, "utf8"));
        const calls = callArguments(src, "deriveGoalProgress(");
        if (calls.length > 0 && rel !== KERNEL) callers.push(rel);
        for (const args of calls) {
          for (const match of args.matchAll(CHECK_IN_IDENT)) offenders.push(`${rel} — ${match[0]}`);
        }
      }
    }

    expect(callers).toEqual([COMPOSER]);
    expect(offenders).toEqual([]);
  });
});

describe("a check-in's goal section is composed once, when its copy is saved", () => {
  it("is composed by the two builders of the saved copy and nothing else", () => {
    const callers: string[] = [];
    for (const target of AS_OF_SCAN) {
      for (const file of filesUnder(target)) {
        const rel = relative(ROOT, file);
        if (rel === COMPOSER) continue;
        if (/\bcomposeGoalSection\(/.test(stripComments(readFileSync(file, "utf8")))) callers.push(rel);
      }
    }
    expect(callers.sort()).toEqual([...BUILDERS].sort());
  });

  it("the review reads the saved section and composes nothing", () => {
    const src = source(REVIEW);
    expect([...src.matchAll(COMPOSING)].map((match) => match[0])).toEqual([]);
    // …it reads the check-in's copy.
    expect(src).toMatch(/\bsentSnapshot\b/);
  });

  for (const builder of BUILDERS) {
    describe(builder, () => {
      it("judges the goal in force on the check-in's day, with that day's deadline", () => {
        const src = source(builder);
        const judged = /const\s+(\w+)\s*=\s*goalOnDay\(\s*\w+\s*,\s*day\s*\)/.exec(src)?.[1];
        expect(judged).toBeDefined();
        expect(callArguments(src, "goalAsOf(").map(splitTopLevel)).toContainEqual([judged, "day"]);
      });

      it("takes the position from the as-of read — never the client record's reading of today", () => {
        const src = source(builder);
        expect(src).toMatch(/\bgetReadingsAsOf\(/);
        expect([...src.matchAll(RECORD_READING)].map((match) => match[0])).toEqual([]);
        const [args] = callArguments(src, "composeGoalSection(");
        expect(args).toMatch(/\bstanding\b/);
      });

      it("runs the goal's progress from the reading on the judged goal's start day", () => {
        const src = source(builder);
        const judged = /const\s+(\w+)\s*=\s*goalOnDay\(/.exec(src)?.[1];
        const reads = callArguments(src, "getReadingsOnDay(").map(splitTopLevel);
        expect(reads).toHaveLength(1);
        expect(reads[0][1]).toBe(`${judged}.startsOn`);
      });
    });
  }

  it("the as-of read belongs to the two builders — the Overview and the Journey keep reading today", () => {
    const offenders: string[] = [];

    for (const target of AS_OF_SCAN) {
      for (const file of filesUnder(target)) {
        const rel = relative(ROOT, file);
        if (AS_OF_OWNERS.has(rel)) continue;
        const src = stripComments(readFileSync(file, "utf8"));
        for (const match of src.matchAll(AS_OF_READS)) offenders.push(`${rel} — ${match[0]}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("scans a real tree — the guard is worthless if the glob is empty", () => {
    const count = SCAN.reduce((n, t) => n + filesUnder(t).length, 0);
    expect(count).toBeGreaterThan(40);
    const wide = AS_OF_SCAN.reduce((n, t) => n + filesUnder(t).length, 0);
    expect(wide).toBeGreaterThan(200);
  });
});
