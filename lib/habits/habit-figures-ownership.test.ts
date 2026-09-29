import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * One kernel answers every habit figure (docs/HABITS-REBUILD-PLAN.md §2.2
 * rule 7, §5). Entries are read by the habit services alone — the read, the
 * writes and the figures — and counted by `lib/habits/` alone: a second place
 * that counts entries, or spells planned or met arithmetic of its own, is a
 * second answer to "how did this week go?", and the screens would disagree.
 *
 * In the shape of `lib/training-adherence-ownership.test.ts`: every source file
 * under SCAN is read, comments stripped, for a read of the entries table
 * outside the habit services, and — under the screens, the routes and the AI's
 * prompt writers — for a habit's direction compared by hand, a met figure
 * computed as done up to planned, or met or planned days counted by hand.
 */
const ROOT = join(__dirname, "..", "..");
const SCAN = ["app", "components", "hooks", "lib", "services", "utils"];

/** The files that may read `client_habit_logs`: the habit services. */
const READERS = /^services\/client-habit(s|-[a-z-]+)-service\.ts$/;

/** Where no habit arithmetic may be spelled: the screens, the routes and the AI's prompt writers. */
const SURFACES = /^(components|app)\/|^utils\/ai-prompt-/;

const ENTRIES_TABLE = /["'`]client_habit_logs["'`]/;
// A direction compared by hand — the judgement `entryMet` owns.
const DIRECTION_COMPARED = /===?\s*["']at_(least|most)["']|["']at_(least|most)["']\s*===?/;
// Met as done up to planned — the week's rule `habitWeek` owns.
const MET_ARITHMETIC = /Math\.min\(\s*[\w.]*done\b[^)]*\bplanned\b|Math\.min\(\s*[\w.]*planned\b[^)]*\bdone\b/;
// Days counted by hand — `days.filter((d) => d.met).length` — the count `habitWeek` owns.
const DAYS_COUNTED = /\.filter\(\s*\(?\s*\w+\s*\)?\s*=>\s*!?\s*\w+\.(met|planned)\b[^)]*\)\s*\.length/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      if (entry === "node_modules" || entry === ".next") continue;
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
    }
  };
  walk(join(ROOT, dir));
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

const files = SCAN.flatMap(sourceFiles).map((file) => ({
  path: relative(ROOT, file),
  src: stripComments(readFileSync(file, "utf8")),
}));

describe("the habit kernel owns every habit figure", () => {
  it("scans a real tree, the kernel and the services included — the guard is worthless if the glob is empty", () => {
    const paths = files.map((file) => file.path);
    expect(paths).toEqual(expect.arrayContaining(["lib/habits/habit-week.ts", "services/client-habits-service.ts"]));
  });

  it("reads the entries table in the habit services alone", () => {
    const offenders = files.filter((file) => ENTRIES_TABLE.test(file.src) && !READERS.test(file.path)).map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it("spells no met or planned arithmetic on a screen, a route or an AI prompt writer", () => {
    const offenders = files
      .filter((file) => SURFACES.test(file.path))
      .filter((file) => DIRECTION_COMPARED.test(file.src) || MET_ARITHMETIC.test(file.src) || DAYS_COUNTED.test(file.src))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it("recognises what it forbids", () => {
    expect(ENTRIES_TABLE.test('supabaseAdmin.from("client_habit_logs")')).toBe(true);
    expect(DIRECTION_COMPARED.test('habit.direction === "at_most" ? value <= target : value >= target')).toBe(true);
    expect(MET_ARITHMETIC.test("const met = Math.min(week.done, week.planned);")).toBe(true);
    expect(DAYS_COUNTED.test("const done = row.days.filter((d) => d.met).length;")).toBe(true);
    expect(DAYS_COUNTED.test("days.filter(day => day.planned && !day.met).length")).toBe(true);
    expect(READERS.test("services/client-habit-figures-service.ts")).toBe(true);
    expect(READERS.test("services/attention-feed-service.ts")).toBe(false);
  });
});
