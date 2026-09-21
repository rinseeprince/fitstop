import { describe, expect, it } from "vitest";
import type { ExerciseBest, ExercisePR } from "@/types/training";
import { describeRecord, recordLine, recordsHeldBy } from "./exercise-records";

const DAY = "2026-08-12T00:00:00+00:00";

const record = (best: ExerciseBest, sessionLogId = "sl-1"): ExercisePR => ({
  ...best,
  date: DAY,
  sessionLogId,
  isRecent: false,
});

describe("a record's words", () => {
  it("reads as its PR card reads, in the viewer's units", () => {
    expect(recordLine(record({ kind: "rep_max", reps: 8, weight: 102.5 }), "metric")).toBe("8 Rep Max · 102.5 kg");
    expect(recordLine(record({ kind: "rep_max", reps: 1, weight: 110 }), "imperial")).toBe("1 Rep Max · 242.5 lbs");
    expect(recordLine(record({ kind: "best_reps", reps: 12 }), "metric")).toBe("Best set · 12 reps");
    expect(recordLine(record({ kind: "heaviest_carry", distanceMeters: 40, weight: 64 }), "metric")).toBe(
      "40 m carry · 64 kg",
    );
    expect(recordLine(record({ kind: "longest_hold", durationSeconds: 90 }), "metric")).toBe("Longest hold · 1:30");
  });

  it("names a best time at a race distance by the race, the same for every viewer (owner, 2026-09-21)", () => {
    const fiveK = record({ kind: "best_time", distanceMeters: 5000, durationSeconds: 1450, race: "5k" });
    expect(recordLine(fiveK, "metric")).toBe("5 km · 24:10");
    // A race is an event's name, not a measurement to convert
    expect(recordLine(fiveK, "imperial")).toBe("5 km · 24:10");
    expect(recordLine(record({ kind: "best_time", distanceMeters: 1609.344, durationSeconds: 340, race: "mile" }), "metric")).toBe(
      "1 mile · 5:40",
    );
    const half = record({ kind: "best_time", distanceMeters: 21097.5, durationSeconds: 5530, race: "half_marathon" });
    expect(recordLine(half, "metric")).toBe("Half marathon · 1:32:10");
  });

  it("reads a race's name in the mono face only when it is a number", () => {
    const words = (race: "5k" | "half_marathon" | "marathon" | "mile") =>
      describeRecord({ kind: "best_time", distanceMeters: 1, durationSeconds: 60, race }, "metric").numericLabel;
    expect(words("5k")).toBe(true);
    expect(words("mile")).toBe(true);
    expect(words("half_marathon")).toBe(false);
    expect(words("marathon")).toBe(false);
  });

  it("reads a best time at the distance logged in the viewer's units, where the type has no races", () => {
    const sled = record({ kind: "best_time", distanceMeters: 50, durationSeconds: 45, race: null });
    expect(recordLine(sled, "metric")).toBe("50 m · 0:45");
    expect(describeRecord(sled, "metric").numericLabel).toBe(true);
  });
});

describe("the records a session holds", () => {
  const records = [
    record({ kind: "rep_max", reps: 1, weight: 110 }, "sl-1"),
    record({ kind: "rep_max", reps: 8, weight: 102.5 }, "sl-2"),
    record({ kind: "best_time", distanceMeters: 5000, durationSeconds: 1210, race: "5k" }, "sl-2"),
    record({ kind: "longest_hold", durationSeconds: 90 }, "sl-3"),
  ];

  it("are the records that session set, by the session each record names", () => {
    expect(recordsHeldBy({ sessionLogId: "sl-1" }, records).map((r) => r.kind)).toEqual(["rep_max"]);
    expect(recordsHeldBy({ sessionLogId: "sl-2" }, records).map((r) => r.kind)).toEqual(["rep_max", "best_time"]);
    expect(recordsHeldBy({ sessionLogId: "sl-3" }, records).map((r) => r.kind)).toEqual(["longest_hold"]);
  });

  it("hold none for a session that set none — even one that matched a record's numbers after it was set", () => {
    expect(recordsHeldBy({ sessionLogId: "sl-4" }, records)).toEqual([]);
    expect(recordsHeldBy({ sessionLogId: "sl-1" }, [])).toEqual([]);
  });
});
