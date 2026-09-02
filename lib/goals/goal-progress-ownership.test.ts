import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Goal position is composed ONCE, by `deriveGoalProgress` (`./goal-progress.ts`),
 * from a goal and the CLIENT RECORD's readings. A check-in is a report of what
 * the client typed that week — every field on it optional — and a goal row
 * built from its own weight column reads a weightless one as "No goals" for a
 * client whose weight is on the record the whole time.
 *
 * This scan, in the shape of `lib/check-in/adherence-ownership.test.ts`, keeps
 * the composition in one place and the check-in out of it: nothing under
 * `services/` or `lib/goals/` reaches the three primitives directly, the
 * kernel does not know what a check-in is, and no call into it hands it one.
 */
const ROOT = join(__dirname, "..", "..");
const KERNEL = "lib/goals/goal-progress.ts";
const SCAN: string[] = ["services", "lib/goals"];

const PRIMITIVES = /\b(calculateGoalProgress|deriveGoalStatus|computeGoalPace)\b/g;
// `currentCheckIn`, `firstCheckIn`, `checkIns`, `CheckIn`… — any identifier
// naming a check-in. The hyphenated import path `@/types/check-in` is not one.
const CHECK_IN_IDENT = /\b\w*[cC]heckIn\w*\b/g;

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

/** The argument text of every `deriveGoalProgress(` call in `src`, by balanced parens. */
function callArguments(src: string): string[] {
  const needle = "deriveGoalProgress(";
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

  it("takes a goal and a client, and knows nothing of a check-in", () => {
    const src = stripComments(readFileSync(join(ROOT, KERNEL), "utf8"));

    expect([...src.matchAll(CHECK_IN_IDENT)].map((match) => match[0])).toEqual([]);
  });

  it("is never handed a check-in's field", () => {
    const offenders: string[] = [];
    let calls = 0;

    for (const file of filesUnder("services")) {
      const src = stripComments(readFileSync(file, "utf8"));
      for (const args of callArguments(src)) {
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

  it("scans a real tree — the guard is worthless if the glob is empty", () => {
    const count = SCAN.reduce((n, t) => n + filesUnder(t).length, 0);
    expect(count).toBeGreaterThan(40);
  });
});
