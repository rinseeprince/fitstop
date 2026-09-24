import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * A client's wellness series is their daily log, one value per day they
 * logged a score, through `wellnessDayValues` (`./day-values.ts`) — the
 * kernel the coach's Journey reads too (docs/MEASUREMENT-LOG-PLAN.md §6
 * commit 11). A check-in's five wellness figures are the week's averages it
 * reported when it was sent: they belong to that check-in and feed no series.
 * The client's progress read used to chart them — one point per check-in,
 * dated the day it was sent — so the client's charts and their coach's
 * disagreed about the same days, with no error anywhere.
 *
 * This scan, in the shape of `lib/measurements/baseline-ownership.test.ts`,
 * forbids the way that read comes back: a `check_ins` read on the client's
 * side that takes a wellness score — by name, by `*`, or by a column list it
 * cannot see — outside the one read that returns a single check-in by id. One
 * positive check keeps the progress read on the log and the kernel.
 */
const ROOT = join(__dirname, "..", "..");

// The client's read side: every client route, and the portal services.
const ROUTES = "app/api/client";
const PORTAL_SERVICE = /^client-portal[^/]*\.ts$/;

// The one check-in read that may take every column: a single check-in by id,
// which reports what that check-in sent.
const ONE_CHECK_IN_READS = new Set<string>(["app/api/client/check-ins/[id]/route.ts"]);

const PROGRESS_READ = "services/client-portal-progress.ts";

// `.from("check_ins").select("<columns>"` — the columns are group 2; a select
// with no literal column list (a variable, or none at all) leaves it unset.
const CHECK_IN_SELECT = /\.from\(\s*["'`]check_ins["'`]\s*\)\s*\.select\(\s*(?:(["'`])([\s\S]*?)\1)?/g;
const TAKES_A_SCORE = /\b(mood|energy|sleep|stress|soreness)\b|\*/;

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

function clientReadSide(): string[] {
  const services = readdirSync(join(ROOT, "services"))
    .filter((entry) => PORTAL_SERVICE.test(entry) && !/\.test\.ts$/.test(entry))
    .map((entry) => join(ROOT, "services", entry));
  return [...filesUnder(ROUTES), ...services];
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

describe("the client's wellness series is their daily log, never a check-in", () => {
  it("no client-side read takes a wellness score off check_ins — a check-in's figures are what it reported", () => {
    const offenders: string[] = [];
    for (const file of clientReadSide()) {
      const rel = relative(ROOT, file);
      if (ONE_CHECK_IN_READS.has(rel)) continue;
      const src = stripComments(readFileSync(file, "utf8"));
      for (const match of src.matchAll(CHECK_IN_SELECT)) {
        const columns = match[2] ?? "*";
        if (TAKES_A_SCORE.test(columns)) offenders.push(`${rel} — ${match[0].slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the one check-in read allowed every column still reads one check-in", () => {
    for (const rel of ONE_CHECK_IN_READS) {
      const src = stripComments(readFileSync(join(ROOT, rel), "utf8"));
      expect(src).toMatch(/\.from\(\s*["']check_ins["']\s*\)/);
      expect(src).toMatch(/\.single\(\)/);
    }
  });

  it("the progress read builds its wellness series from the log, through the kernel", () => {
    const src = stripComments(readFileSync(join(ROOT, PROGRESS_READ), "utf8"));
    expect(src).toMatch(/\.from\(\s*["']wellness_logs["']\s*\)/);
    expect(src).toMatch(/\bwellnessDayValues\(/);
  });

  it("scans a real tree — the guard is worthless if the glob is empty", () => {
    const files = clientReadSide().map((file) => relative(ROOT, file));
    expect(files.length).toBeGreaterThan(25);
    expect(files).toContain(PROGRESS_READ);
  });
});
