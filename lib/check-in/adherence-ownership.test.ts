import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * `summariseSessions` is the ONE source of a completion count on the coach's
 * check-in surfaces (full + PARTIAL over prescribed).
 *
 * The stored `check_ins.workouts_completed` counts full completions only. It is
 * the RN wire's column (`app/api/client/check-ins/[id]/route.ts`,
 * `lib/mappers.ts`) and the client's own surfaces read it back legitimately —
 * but a COACH surface rendering it lands a second, quieter definition beside the
 * first. That is exactly what shipped: the KPI ribbon read 3/5 while the
 * comparison pane read 2 and the AI summary said "completed only 2 out of 5",
 * for the same week. All three now derive.
 *
 * This scan is the guard, in the shape of `lib/check-in-week.test.ts`: the next
 * card added to this surface cannot quietly reintroduce the split. It forbids
 * two shapes — reading the stored column, and hand-rolling a count from event
 * statuses. Both have shipped.
 */
const ROOT = join(__dirname, "..", "..");

// Coach-facing scope. `components/client-portal/**` and `app/client/**` are the
// CLIENT reading back their own submission and are deliberately not scanned.
const SCAN: string[] = [
  "components/check-in",
  "components/clients",
  "utils/ai-prompt-builder.ts",
  "services/comparison-service.ts",
  "services/check-in-details-service.ts",
];

// Known, deliberate exclusions. `components/check-in/` is the MIXED tree, so a
// client-facing file can sit beside a coach one.
const EXCLUDE: string[] = [
  // The CLIENT's own check-in wizard step (mounted only by `step-training.tsx`),
  // where they tick off the sessions they did. Its count excludes partials like
  // the coach's used to — but it is the client's view of their own week, a
  // different audience answering a different question, and changing what a
  // client sees mid-check-in is a product decision nobody has taken. Recorded
  // here rather than silently dropped from the glob.
  "components/check-in/training-session-checklist.tsx",
];

function filesUnder(target: string): string[] {
  const abs = join(ROOT, target);
  if (statSync(abs).isFile()) return [abs];
  const out: string[] = [];
  for (const entry of readdirSync(abs)) {
    const full = join(abs, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(join(target, entry)));
    else if (
      /\.tsx?$/.test(entry) &&
      !/\.test\.tsx?$/.test(entry) &&
      !EXCLUDE.includes(join(target, entry))
    )
      out.push(full);
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

describe("summariseSessions owns the coach-side completion count", () => {
  it("no coach surface reads the stored workouts_completed column", () => {
    const offenders: string[] = [];

    for (const target of SCAN) {
      for (const file of filesUnder(target)) {
        const src = stripComments(readFileSync(file, "utf8"));
        for (const match of src.matchAll(/(\w+)(\??\.)workoutsCompleted/g)) {
          // `changes.workoutsCompleted` is the DERIVED delta this service now
          // computes on both sides — not the stored column.
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
  // beneath a ribbon reading 3/5. A completion count is a filter over statuses,
  // so that is the shape to forbid, not just one property name.
  it("no coach surface hand-rolls a completion count from event statuses", () => {
    const offenders: string[] = [];
    // `.filter(... status === "completed" ...).length` — a COUNT, as opposed to
    // a single-row branch like `if (status === "completed") return <Badge/>`.
    // `[\s\S]` rather than `[^)]`: the predicate is an arrow function, so its
    // own `(d) =>` closes a paren before the comparison is reached — the first
    // version of this pattern stopped there and matched nothing at all.
    const COUNTING =
      /\.filter\([\s\S]{0,200}?status\s*===\s*"(completed|partial)"[\s\S]{0,200}?\.length/g;

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
