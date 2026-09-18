import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * `summariseTraining` (`lib/training-adherence.ts`) is the ONE source of a
 * training count on every check-in surface — the coach's review, the client's
 * wizard, and the figure the submit freezes. There is one numerator now:
 * `completed`, every workout the client logged.
 *
 * What survives as a scan is the LIVE-versus-FROZEN split. A coach surface
 * reads the period's workouts as they are; `check_ins.workouts_completed` is
 * what they were when the client sent the check-in, and it never moves after.
 * Rendering the frozen figure beside a live one put "3/5" on the KPI ribbon
 * above an AI summary saying "completed only 2 out of 5", for the same week.
 * The column stays the CLIENT's — their own surfaces read it back legitimately,
 * and they are not scanned.
 *
 * The scan's second rule — no hand-rolled count over a status or a quality —
 * retired with migration 182. It existed because `status === "completed"`
 * silently excluded partials, so counting it by hand was a different answer;
 * now it is the same answer, and the rule was forbidding a spelling rather than
 * a defect. One derivation is still the design (CONVENTIONS §8 → "Adherence
 * math is its own decision"); this file no longer polices it by regex.
 *
 * This is the guard, in the shape of `lib/check-in-week.test.ts`: the next card
 * added to these surfaces cannot quietly reintroduce the split.
 */
const ROOT = join(__dirname, "..");

// Every check-in surface that renders or derives a training count.
// `components/client-portal/**` and `app/client/check-in/[id]` are the CLIENT
// reading back a SUBMITTED check-in's stored column, which is that column's
// legitimate audience, and are deliberately not scanned.
const SCAN: string[] = [
  "components/check-in",
  "components/clients",
  "utils/ai-prompt-builder.ts",
  "services/comparison-service.ts",
  "services/check-in-details-service.ts",
  "services/check-in-context-service.ts",
  "app/api/client/check-in-context/route.ts",
];

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

describe("summariseTraining owns the check-in training count", () => {
  it("no check-in surface reads the stored workouts_completed column", () => {
    const offenders: string[] = [];

    for (const target of SCAN) {
      for (const file of filesUnder(target)) {
        const src = stripComments(readFileSync(file, "utf8"));
        for (const match of src.matchAll(/(\w+)(\??\.)workoutsCompleted/g)) {
          // `changes.workoutsCompleted` is the DERIVED delta the comparison
          // service computes on both sides — not the stored column.
          if (match[1] === "changes") continue;
          offenders.push(`${relative(ROOT, file)} — ${match[0]}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("scans a real tree — the guard is worthless if the glob is empty", () => {
    const count = SCAN.reduce((n, t) => n + filesUnder(t).length, 0);
    expect(count).toBeGreaterThan(50);
  });
});
