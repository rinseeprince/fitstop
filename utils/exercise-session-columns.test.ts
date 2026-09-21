import { afterEach, describe, expect, it } from "vitest";
import type { ExerciseProgressionPoint } from "@/types/training";
import { aggregateSessionMarkers, type MarkerSet } from "./exercise-session-markers";
import { PROGRESS_MARKER_SPECS, offeredMarkers, type ProgressMarker } from "./exercise-progress-markers";
import { emptyLoggedActuals } from "./set-log-measures";
import {
  DEFAULT_SESSION_SORT,
  SESSION_COLUMNS,
  SESSION_COLUMN_SPECS,
  effectiveSessionSort,
  formatSessionCell,
  formatSessionDate,
  nextSessionSort,
  sessionColumnHeading,
  sessionColumnsIn,
  sessionSortLabel,
  sortSessions,
  type SessionColumn,
} from "./exercise-session-columns";

/** A session as the kernel makes it from its sets — the only shape the table ever reads. */
function session(
  date: string,
  sets: Partial<MarkerSet>[],
  extra: Partial<ExerciseProgressionPoint> = {},
): ExerciseProgressionPoint {
  const { tempo: _tempo, ...measures } = emptyLoggedActuals();
  return {
    date,
    sessionLogId: `sl-${date}`,
    ...aggregateSessionMarkers(sets.map((s) => ({ setType: "working", ...measures, ...s }))),
    prescribedSets: null,
    prescribedRepsMin: null,
    prescribedRepsMax: null,
    ...extra,
  };
}

const bench = (date: string, weight: number, extra: Partial<MarkerSet> = {}) =>
  session(date, [{ reps: 5, weight, rpe: 8, ...extra }], { prescribedSets: 3 });

describe("the column table", () => {
  it("names every column once, each with a spec", () => {
    expect(new Set(SESSION_COLUMNS).size).toBe(SESSION_COLUMNS.length);
    expect(Object.keys(SESSION_COLUMN_SPECS).sort()).toEqual([...SESSION_COLUMNS].sort());
  });

  it("reads a chart marker's own value wherever the column has a chart twin — the RPE lens and column read one value", () => {
    const twins: Partial<Record<SessionColumn, ProgressMarker>> = {
      load: "weight",
      bodyweight_reps: "reps",
      rpe: "rpe",
      e1rm: "e1rm",
      volume: "volume",
      distance: "distance",
      time: "time",
      hold: "hold",
      pace: "pace",
      split: "split",
      power: "power",
      sets: "compliance",
    };
    for (const [column, marker] of Object.entries(twins) as [SessionColumn, ProgressMarker][]) {
      expect(SESSION_COLUMN_SPECS[column].value, column).toBe(PROGRESS_MARKER_SPECS[marker].value);
    }
  });

  it("carries a run's RPE to its RPE column and its RPE lens alike", () => {
    const run = session("2026-09-01", [{ distanceMeters: 5000, durationSeconds: 1570, rpe: 7.5 }]);
    expect(formatSessionCell("rpe", run, "metric")?.value).toBe("7.5");
    expect(offeredMarkers("endurance", [run], "coach")).toContain("rpe");
  });
});

describe("sessionColumnsIn", () => {
  it("shows only what the window's sessions recorded, in the table's order, Sets whenever there is a session", () => {
    const columns = sessionColumnsIn([
      bench("2026-09-01", 100),
      session("2026-09-03", [{ distanceMeters: 5000, durationSeconds: 1570, paceSecondsPerKm: 314, heartRate: 165 }]),
    ]);
    expect(columns).toEqual(["load", "reps", "rpe", "e1rm", "volume", "distance", "time", "pace", "heart_rate", "sets"]);
  });

  it("has nothing to show for no sessions", () => {
    expect(sessionColumnsIn([])).toEqual([]);
  });

  it("gives a bodyweight set its own reps column, apart from the top set's", () => {
    expect(sessionColumnsIn([session("2026-09-01", [{ reps: 12 }])])).toEqual(["bodyweight_reps", "sets"]);
    expect(sessionColumnsIn([session("2026-09-01", [{ reps: 12 }, { reps: 5, weight: 10 }])])).toEqual([
      "load",
      "reps",
      "bodyweight_reps",
      "e1rm",
      "volume",
      "sets",
    ]);
  });
});

describe("headings and cells", () => {
  it("names the unit a load's bare numbers are in, and the measure elsewhere", () => {
    expect(sessionColumnHeading("load", "metric")).toBe("Load (kg)");
    expect(sessionColumnHeading("e1rm", "imperial")).toBe("e1RM (lbs)");
    expect(sessionColumnHeading("volume", "metric")).toBe("Volume (kg)");
    expect(sessionColumnHeading("heart_rate_zone", "metric")).toBe("HR zone");
    expect(sessionColumnHeading("ftp_percent", "imperial")).toBe("% FTP");
  });

  it("reads each cell in the viewer's units", () => {
    const lift = bench("2026-09-01", 100);
    expect(formatSessionCell("load", lift, "metric")?.value).toBe("100");
    expect(formatSessionCell("load", lift, "imperial")?.value).toBe("220");
    expect(formatSessionCell("volume", session("2026-09-01", [{ reps: 5, weight: 100 }, { reps: 10, weight: 100 }]), "metric")?.value).toBe("1,500");

    const run = session("2026-09-01", [{ distanceMeters: 5000, durationSeconds: 1570, paceSecondsPerKm: 314, heartRateZone: 4 }]);
    expect(formatSessionCell("distance", run, "metric")?.value).toBe("5 km");
    expect(formatSessionCell("distance", run, "imperial")?.value).toBe("3.11 mi");
    expect(formatSessionCell("pace", run, "metric")?.value).toBe("5:14 /km");
    expect(formatSessionCell("pace", run, "imperial")?.value).toBe("8:25 /mi");
    expect(formatSessionCell("heart_rate_zone", run, "metric")?.value).toBe("Z4");

    const row = session("2026-09-01", [{ distanceMeters: 1000, durationSeconds: 222.1, splitSecondsPer500m: 111 }]);
    expect(formatSessionCell("split", row, "metric")?.value).toBe("1:51 /500m");

    const plank = session("2026-09-01", [{ durationSeconds: 90 }]);
    expect(formatSessionCell("hold", plank, "metric")).toEqual({ value: "1:30", aside: null });
  });

  it("reads the fastest time with its distance beside it", () => {
    const run = session("2026-09-01", [
      { distanceMeters: 5000, durationSeconds: 1570 },
      { distanceMeters: 800, durationSeconds: 170 },
    ]);
    expect(formatSessionCell("time", run, "metric")).toEqual({ value: "2:50", aside: "800 m" });
    expect(formatSessionCell("time", run, "imperial")).toEqual({ value: "2:50", aside: "875 yd" });
  });

  it("reads sets done over sets prescribed, or the count alone with no prescription", () => {
    const logged = session("2026-09-01", [{ reps: 5, weight: 100 }, { reps: 5, weight: 100 }]);
    expect(formatSessionCell("sets", { ...logged, prescribedSets: 3 }, "metric")?.value).toBe("2/3");
    expect(formatSessionCell("sets", logged, "metric")?.value).toBe("2");
  });

  it("reads the average rest taken as a clock", () => {
    const rested = session("2026-09-01", [{ reps: 5, weight: 100, restSeconds: 90 }, { reps: 5, weight: 100, restSeconds: 121 }]);
    expect(formatSessionCell("rest", rested, "metric")?.value).toBe("1:46");
  });

  it("has no cell where the session recorded nothing", () => {
    expect(formatSessionCell("pace", bench("2026-09-01", 100), "metric")).toBeNull();
  });

  describe("the date", () => {
    const original = process.env.TZ;
    afterEach(() => {
      process.env.TZ = original;
    });

    it("reads the day the session's stamp names, west of Greenwich too", () => {
      expect(formatSessionDate("2026-09-17T00:00:00+00:00")).toBe("Sep 17, 2026");
      process.env.TZ = "America/Los_Angeles";
      expect(formatSessionDate("2026-09-17T00:00:00+00:00")).toBe("Sep 17, 2026");
    });
  });
});

describe("the sort", () => {
  it("sorts a heading's first click the way its column leads, and a second click the other way", () => {
    expect(nextSessionSort(DEFAULT_SESSION_SORT, "load")).toEqual({ column: "load", order: "desc" });
    expect(nextSessionSort({ column: "load", order: "desc" }, "load")).toEqual({ column: "load", order: "asc" });
    expect(nextSessionSort({ column: "load", order: "asc" }, "load")).toEqual({ column: "load", order: "desc" });
    // Fastest first is the lowest pace, split and time
    expect(nextSessionSort({ column: "load", order: "desc" }, "pace")).toEqual({ column: "pace", order: "asc" });
    expect(nextSessionSort(DEFAULT_SESSION_SORT, "time")).toEqual({ column: "time", order: "asc" });
    // The date leads newest first, then flips
    expect(nextSessionSort({ column: "pace", order: "asc" }, "date")).toEqual(DEFAULT_SESSION_SORT);
    expect(nextSessionSort(DEFAULT_SESSION_SORT, "date")).toEqual({ column: "date", order: "asc" });
  });

  it("words every sort with the owner's words", () => {
    const words = SESSION_COLUMNS.map((column) => [sessionSortLabel({ column, order: "desc" }), sessionSortLabel({ column, order: "asc" })]);
    expect(words).toContainEqual(["Heaviest load first", "Lightest load first"]);
    expect(words).toContainEqual(["Longest distance first", "Shortest distance first"]);
    expect(words).toContainEqual(["Slowest time first", "Fastest time first"]);
    expect(words).toContainEqual(["Highest % FTP first", "Lowest % FTP first"]);
    expect(words).toContainEqual(["Most bodyweight reps first", "Fewest bodyweight reps first"]);
    expect(words).toContainEqual(["Longest rest first", "Shortest rest first"]);
    expect(sessionSortLabel(DEFAULT_SESSION_SORT)).toBe("Newest first");
    expect(sessionSortLabel({ column: "date", order: "asc" })).toBe("Oldest first");
  });

  it("sorts by date, newest first by default", () => {
    const rows = [bench("2026-09-01", 100), bench("2026-09-08", 90), bench("2026-09-04", 95)];
    expect(sortSessions(rows, DEFAULT_SESSION_SORT).map((r) => r.date)).toEqual(["2026-09-08", "2026-09-04", "2026-09-01"]);
    expect(sortSessions(rows, { column: "date", order: "asc" }).map((r) => r.date)).toEqual(["2026-09-01", "2026-09-04", "2026-09-08"]);
  });

  it("sorts a column both ways, fastest meaning the lowest time", () => {
    const rows = [bench("2026-09-01", 100), bench("2026-09-08", 90), bench("2026-09-04", 95)];
    expect(sortSessions(rows, { column: "load", order: "desc" }).map((r) => r.topSetWeight)).toEqual([100, 95, 90]);
    expect(sortSessions(rows, { column: "load", order: "asc" }).map((r) => r.topSetWeight)).toEqual([90, 95, 100]);

    const runs = [
      session("2026-09-01", [{ paceSecondsPerKm: 314 }]),
      session("2026-09-02", [{ paceSecondsPerKm: 301 }]),
      session("2026-09-03", [{ paceSecondsPerKm: 308 }]),
    ];
    const fastest = nextSessionSort(DEFAULT_SESSION_SORT, "pace");
    expect(sortSessions(runs, fastest).map((r) => r.bestPaceSecondsPerKm)).toEqual([301, 308, 314]);
  });

  it("puts a session with no value in the sorted column last either way, newest first among them", () => {
    const rows = [
      bench("2026-09-01", 100),
      session("2026-09-02", [{ reps: 12 }]),
      bench("2026-09-03", 90),
      session("2026-09-05", [{ reps: 10 }]),
    ];
    for (const order of ["desc", "asc"] as const) {
      const sorted = sortSessions(rows, { column: "load", order });
      expect(sorted.slice(2).map((r) => r.date)).toEqual(["2026-09-05", "2026-09-02"]);
    }
  });

  it("breaks a tie newest first", () => {
    const rows = [bench("2026-09-01", 100), bench("2026-09-08", 100), bench("2026-09-04", 100)];
    expect(sortSessions(rows, { column: "load", order: "desc" }).map((r) => r.date)).toEqual(["2026-09-08", "2026-09-04", "2026-09-01"]);
  });

  it("shows the picked sort while its column shows, Newest first otherwise", () => {
    const heaviest = { column: "load", order: "desc" } as const;
    expect(effectiveSessionSort(heaviest, ["load", "reps"])).toBe(heaviest);
    expect(effectiveSessionSort(heaviest, ["reps"])).toBe(DEFAULT_SESSION_SORT);
    const oldest = { column: "date", order: "asc" } as const;
    expect(effectiveSessionSort(oldest, [])).toBe(oldest);
  });
});
