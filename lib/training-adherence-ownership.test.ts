import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * `summariseTraining` (`lib/training-adherence.ts`) is the ONE source of a
 * training count on every check-in surface — the coach's review, the client's
 * wizard, and the figure the submit freezes.
 *
 * Both numerators come out of it: the coach's review reads `completed` (full +
 * PARTIAL over planned), the client's wizard and the stored
 * `check_ins.workouts_completed` read `full`. What is forbidden is a SECOND
 * definition — and two shapes of it have shipped. Reading the stored column on
 * a coach surface put "3/5" on the KPI ribbon above an AI summary saying
 * "completed only 2 out of 5", for the same week. Counting statuses by hand put
 * a third spelling beside both.
 *
 * Counting a *quality* by hand is the same defect in the shape it takes now
 * that quality is what decides a count, so the scan forbids that too.
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

  // The first version of this guard forbade only the stored-column READ, and
  // missed `ai-prompt-builder.ts` counting `status === "completed"` itself —
  // a third spelling that excluded partials and told the model "2 out of 5"
  // beneath a ribbon reading 3/5. A completion count is a filter over the two
  // facts a workout carries, so those are the shapes to forbid, not one
  // property name.
  it("no check-in surface hand-rolls a count over statuses or qualities", () => {
    const offenders: string[] = [];
    // `.filter(... status === "completed" ...).length` — a COUNT, as opposed to
    // a single-row branch like `if (status === "completed") return <Badge/>`.
    // `[\s\S]` rather than `[^)]`: the predicate is an arrow function, so its
    // own `(d) =>` closes a paren before the comparison is reached — the first
    // version of this pattern stopped there and matched nothing at all.
    const COUNTING =
      /\.filter\([\s\S]{0,200}?(status|completionQuality|quality)\s*===\s*"(completed|partial|full)"[\s\S]{0,200}?\.length/g;

    for (const target of SCAN) {
      for (const file of filesUnder(target)) {
        const src = stripComments(readFileSync(file, "utf8"));
        for (const match of src.matchAll(COUNTING)) {
          offenders.push(`${relative(ROOT, file)} — ${match[0].slice(0, 60)}`);
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
