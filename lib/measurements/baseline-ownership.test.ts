import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * The baseline — the client's reading as of their start date — is derived
 * ONCE, by the database view `client_baseline_measurements` (migration 158),
 * and read through `getBaseline` in `services/measurements-service.ts` or the
 * view's embed beside a client row. Nothing else may derive it: the Journey
 * hero used to anchor "since <date>" on the first LOADED point while the
 * Overview subtracted a stored column, and the two printed different numbers
 * for the same client with no error anywhere.
 *
 * This scan, in the shape of `lib/goals/goal-progress-ownership.test.ts`,
 * forbids the two ways a second derivation appears: reading the view from a
 * file not on the allow-list, and comparing a reading's date against a start
 * date in code — the shape `recorded_on <= start_date` IS the derivation.
 */
const ROOT = join(__dirname, "..", "..");
const SCAN: string[] = ["app", "components", "hooks", "lib", "services", "utils"];

// The accessor, the reads that embed the view beside a client row, the type
// that names the embed, and the mapper that lifts it onto `Client`.
const VIEW_READERS = new Set<string>([
  "services/measurements-service.ts",
  "services/client-service.ts",
  "services/client-portal-service.ts",
  "services/client-portal-progress.ts",
  "lib/database-helpers.ts",
  "lib/mappers.ts",
]);

const VIEW = /\bclient_baseline_measurements\b/g;
// `recorded_on <= start_date`, `p.date >= startDate`, `startDate < row.date`…
// — a reading's day held against a start date, in either order.
const AS_OF_COMPARISON =
  /(\b(recorded_on|recordedOn|entry_date|entryDate|date)\b\s*(<=?|>=?)\s*\w*(start_date|startDate)\b)|(\b\w*(start_date|startDate)\b\s*(<=?|>=?)\s*\w*\.?(recorded_on|recordedOn|entry_date|entryDate|date)\b)/g;

// The Journey and the chart SPLIT a series at the start date (before-start
// readings are listed, not charted) — a partition, not a derivation. These
// files are read by eye instead: their comparisons pick no single reading.
const PARTITION_SITES = new Set<string>([
  "components/clients/metrics/hooks/use-merged-metrics.ts",
  "components/clients/overview/progression-chart.tsx",
  "components/clients/overview/status-band.tsx",
  "utils/metric-derived-stats.ts",
]);

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

describe("the baseline is derived once, by the database", () => {
  it("only the accessor and the two client reads name the baseline view", () => {
    const offenders: string[] = [];
    for (const target of SCAN) {
      for (const file of filesUnder(target)) {
        const rel = relative(ROOT, file);
        if (VIEW_READERS.has(rel)) continue;
        const src = stripComments(readFileSync(file, "utf8"));
        if (VIEW.test(src)) offenders.push(rel);
        VIEW.lastIndex = 0;
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no file compares a reading's date against a start date", () => {
    const offenders: string[] = [];
    for (const target of SCAN) {
      for (const file of filesUnder(target)) {
        const rel = relative(ROOT, file);
        if (PARTITION_SITES.has(rel)) continue;
        const src = stripComments(readFileSync(file, "utf8"));
        for (const match of src.matchAll(AS_OF_COMPARISON)) {
          offenders.push(`${rel} — ${match[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the accessor really reads the view", () => {
    const src = readFileSync(join(ROOT, "services/measurements-service.ts"), "utf8");
    expect(src).toMatch(/from\("client_baseline_measurements"\)/);
  });

  it("scans a real tree — the guard is worthless if the glob is empty", () => {
    const count = SCAN.reduce((n, t) => n + filesUnder(t).length, 0);
    expect(count).toBeGreaterThan(200);
  });
});
