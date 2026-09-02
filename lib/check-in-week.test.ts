import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { checkInWeekday, NO_SCHEDULE_WEEK_ANCHOR } from "./check-in-week";
import { getTrainingWeekStart, getTrainingWeekEnd } from "./date-helpers";

describe("checkInWeekday", () => {
  it("takes the weekday of the client's due date", () => {
    // 2026-06-10 is a Wednesday, 2026-06-14 a Sunday.
    expect(checkInWeekday({ nextCheckInDue: "2026-06-10" })).toBe("wednesday");
    expect(checkInWeekday({ nextCheckInDue: "2026-06-14" })).toBe("sunday");
  });

  it("reads the WEEKDAY, not the date, so a fortnightly client keeps a weekly rhythm", () => {
    // Two due dates a fortnight apart are the same anchor. "The 7 days ending
    // on the due date" would leave every other week unassigned.
    expect(checkInWeekday({ nextCheckInDue: "2026-06-10" })).toBe(
      checkInWeekday({ nextCheckInDue: "2026-06-24" })
    );
  });

  it("tolerates a full timestamp, since the column crosses the wire as a string", () => {
    expect(checkInWeekday({ nextCheckInDue: "2026-06-10T00:00:00+00:00" })).toBe("wednesday");
  });

  it("falls back to the no-schedule anchor for every unset spelling", () => {
    // Five ways a caller can arrive without a schedule. Each used to be one
    // caller's chance to spell the default itself.
    expect(checkInWeekday(null)).toBe(NO_SCHEDULE_WEEK_ANCHOR);
    expect(checkInWeekday(undefined)).toBe(NO_SCHEDULE_WEEK_ANCHOR);
    expect(checkInWeekday({})).toBe(NO_SCHEDULE_WEEK_ANCHOR);
    expect(checkInWeekday({ nextCheckInDue: null })).toBe(NO_SCHEDULE_WEEK_ANCHOR);
    expect(checkInWeekday({ nextCheckInDue: undefined })).toBe(NO_SCHEDULE_WEEK_ANCHOR);
  });
});

describe("the no-schedule anchor is Mon-Sun", () => {
  // Owner decision 2026-08-28. This is §11.5's whole subject: the anchor used
  // to be spelled `?? "monday"` in one service and `?? null` in eleven others,
  // and because the week starts the day AFTER the check-in day those two
  // spellings produced Tue-Mon and Mon-Sun for the same client.
  it("puts a scheduleless client's week on Monday through Sunday", () => {
    const anchor = checkInWeekday(null);
    // 2026-06-10 is a Wednesday.
    expect(getTrainingWeekStart("2026-06-10", anchor)).toBe("2026-06-08"); // Monday
    expect(getTrainingWeekEnd("2026-06-10", anchor)).toBe("2026-06-14"); // Sunday
  });

  it("is NOT the Tue-Mon week that `?? \"monday\"` produced", () => {
    expect(getTrainingWeekStart("2026-06-10", "monday")).toBe("2026-06-09"); // Tuesday
    expect(getTrainingWeekStart("2026-06-10", checkInWeekday(null))).toBe("2026-06-08");
  });
});

// ---------------------------------------------------------------------------
// The scan. The bug this module exists to kill was not a wrong default — it was
// a default spelled twelve times, so the fix is only durable if a THIRTEENTH
// caller cannot quietly spell it a thirteenth way.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(__dirname, "..");
const SCANNED_DIRS = ["app", "components", "hooks", "lib", "services", "utils"];
const WEEK_FN = /\bgetTrainingWeek(Start|End|Days)\s*\(/;

/**
 * Files allowed to call getTrainingWeek* without importing `checkInWeekday`.
 * Each needs a reason, and "it was already like that" is not one.
 */
const EXEMPT: Record<string, string> = {
  "lib/date-helpers.ts": "defines the three functions",
  "lib/check-in-week.test.ts": "this file",
  "lib/tracking-triggers.ts": "takes the anchor as a parameter; attention-feed-helpers resolves it",
  "services/habits-weekly-service.ts": "takes the anchor as a parameter; the habits/weekly route resolves it",
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      if (entry === "node_modules" || entry === ".next") continue;
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
  };
  walk(join(REPO_ROOT, dir));
  return out;
}

describe("no caller sources the week anchor itself", () => {
  it("every getTrainingWeek* call site resolves its day through checkInWeekday", () => {
    const offenders: string[] = [];

    for (const dir of SCANNED_DIRS) {
      for (const file of sourceFiles(dir)) {
        const rel = relative(REPO_ROOT, file);
        if (EXEMPT[rel]) continue;
        const src = readFileSync(file, "utf8");
        if (!WEEK_FN.test(src)) continue;
        // Either it derives the anchor itself, or it was handed one by a file
        // that did — which in practice means importing the resolver or the
        // service wrapping it.
        const resolves =
          src.includes("checkInWeekday") || src.includes("getClientWeekAnchor");
        if (!resolves) offenders.push(rel);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("nothing spells a week default of its own", () => {
    const offenders: string[] = [];
    // The exact shape of the §11.5 bug: a weekday literal defaulted in beside
    // a week call. `checkInWeekday` is the only place a default belongs.
    const HARDCODED_DEFAULT = /\?\?\s*["'](monday|tuesday|wednesday|thursday|friday|saturday|sunday)["']/;

    for (const dir of SCANNED_DIRS) {
      for (const file of sourceFiles(dir)) {
        const rel = relative(REPO_ROOT, file);
        if (rel === "lib/check-in-week.ts" || rel === "lib/check-in-week.test.ts") continue;
        const src = readFileSync(file, "utf8");
        if (HARDCODED_DEFAULT.test(src) && /checkIn|check_in|WeekStart|WeekEnd/.test(src)) {
          offenders.push(rel);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
