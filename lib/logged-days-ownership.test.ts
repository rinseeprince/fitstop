import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * "Did the client log today?" is answered ONCE, by `loggedDays` in
 * `./logged-days.ts`, from the five sources a client writes themselves. It
 * used to be answered three ways: the check-in header and the logging-gap
 * alert counted `daily_logs` spine rows, which only wellness and nutrition
 * create, while the no-engagement alert unioned the spine, the habit logs and
 * the completed events itself — so a client who only trained read as silent
 * on two surfaces and as active on the third, with no error anywhere.
 *
 * This scan, in the shape of `lib/check-in/adherence-ownership.test.ts`,
 * forbids the three shapes a second definition takes: reading the spine as an
 * activity flag, spelling the union over raw rows, and counting day-form rows
 * as logged days. One positive check keeps the two assemblers on the kernel.
 */
const ROOT = join(__dirname, "..");

// Every reader of the question: the trigger modules, the feed's assembly and
// service, the adherence kernel, the check-in detail service and hook, and the
// coach check-in tree.
const SCAN: string[] = [
  "lib/wellness-triggers.ts",
  "lib/tracking-triggers.ts",
  "lib/activity-triggers.ts",
  "lib/engagement-triggers.ts",
  "lib/attention-feed-helpers.ts",
  "services/attention-feed-service.ts",
  "services/client-adherence-service.ts",
  "services/check-in-details-service.ts",
  "hooks/use-check-in-detail-data.ts",
  "components/clients/check-ins",
  "components/check-in",
];

// Known, deliberate exclusions. `components/check-in/` is the MIXED tree, so a
// client-facing file can sit beside a coach one.
const EXCLUDE: string[] = [
  // The CLIENT's own wizard step: "Week at a Glance" is their WELLNESS week,
  // read back to them over the wellness averages, and its "days logged" counts
  // days with a wellness reading. A different audience answering a narrower
  // question, on the web harness rather than the real client (owner decision
  // 2026-09-03). Recorded here rather than silently dropped from the glob.
  "components/check-in/daily-logs-summary.tsx",
];

// The two places the five sources are assembled from rows already in hand.
const ASSEMBLERS = ["services/client-adherence-service.ts", "lib/attention-feed-helpers.ts"];

// The bare spine. `daily_logs_full` is a different string and stays readable:
// the wellness and nutrition pattern triggers need its values.
const SPINE_READ = /\.from\(\s*["']daily_logs["']\s*\)/g;
// `logs.some((log) => log.date >= cutoff)` — an activity test over raw rows,
// the shape the old union was written in.
const RAW_ACTIVITY_TEST = /\.some\(\s*\(?\s*\w+\s*\)?\s*=>\s*\w+\.date\s*>=/g;
// The spine as an engagement flag, by either name it carried.
const SPINE_FLAG = /\b(spineDates|hasSpineRow)\b/g;
// `daysLogged: dailyLogs.length` — day-form rows counted as logged days.
const DAY_FORM_COUNT = /\b(dailyLogs|logs)\.length\b|daysLogged:\s*\w+\.length/g;

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

function offenders(pattern: RegExp, targets: string[]): string[] {
  const out: string[] = [];
  for (const target of targets) {
    for (const file of filesUnder(target)) {
      const src = stripComments(readFileSync(file, "utf8"));
      for (const match of src.matchAll(pattern)) {
        out.push(`${relative(ROOT, file)} — ${match[0].slice(0, 60)}`);
      }
    }
  }
  return out;
}

describe("a logged day is derived once", () => {
  it("no reader reads the daily_logs spine — it is the day-form's parent, not an activity flag", () => {
    expect(offenders(SPINE_READ, SCAN)).toEqual([]);
  });

  it("no reader spells the union over raw rows, or keeps the spine as an engagement flag", () => {
    expect(offenders(RAW_ACTIVITY_TEST, SCAN)).toEqual([]);
    expect(offenders(SPINE_FLAG, SCAN)).toEqual([]);
  });

  it("no coach check-in surface counts day-form rows as logged days", () => {
    expect(
      offenders(DAY_FORM_COUNT, [
        "components/clients/check-ins",
        "components/check-in",
        "hooks/use-check-in-detail-data.ts",
      ])
    ).toEqual([]);
  });

  it("the two assemblers ask the kernel", () => {
    for (const file of ASSEMBLERS) {
      const src = stripComments(readFileSync(join(ROOT, file), "utf8"));
      expect(src, file).toMatch(/\bloggedDays\(/);
      expect(src, file).toMatch(/from "@\/lib\/logged-days"/);
    }
  });

  it("scans a real tree — the guard is worthless if the glob is empty", () => {
    const count = SCAN.reduce((n, t) => n + filesUnder(t).length, 0);
    expect(count).toBeGreaterThan(30);
  });
});
