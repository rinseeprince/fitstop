import { describe, it, expect } from "vitest";
import {
  eventWorkoutRead,
  loggedDisplayQuality,
  trainingDisplayState,
} from "@/lib/training-display-state";

const TODAY = "2026-09-17";

describe("loggedDisplayQuality", () => {
  it("takes the quality off the LOG whatever the status word says", () => {
    // The shape stored today, and the shape commit 10 stores: one answer.
    expect(
      loggedDisplayQuality({ status: "partial", completionQuality: "partial" })
    ).toBe("partial");
    expect(
      loggedDisplayQuality({ status: "completed", completionQuality: "partial" })
    ).toBe("partial");
    expect(
      loggedDisplayQuality({ status: "completed", completionQuality: "full" })
    ).toBe("full");
  });

  it("reads a workout logged before the link existed as full", () => {
    // 209 such rows on dev: nothing recorded a quality for them.
    expect(loggedDisplayQuality({ status: "completed", completionQuality: null })).toBe("full");
  });

  it("is null for a workout the client has not logged", () => {
    expect(loggedDisplayQuality({ status: "scheduled", completionQuality: null })).toBeNull();
    expect(loggedDisplayQuality({ status: "missed", completionQuality: null })).toBeNull();
  });

  it("keeps a skipped workout skipped", () => {
    expect(loggedDisplayQuality({ status: "skipped", completionQuality: null })).toBe("skipped");
    expect(loggedDisplayQuality({ status: "skipped", completionQuality: "skipped" })).toBe(
      "skipped"
    );
  });
});

describe("trainingDisplayState", () => {
  it("names how a logged workout went", () => {
    expect(
      trainingDisplayState(
        { status: "completed", completionQuality: "full", date: "2026-09-15" },
        TODAY
      )
    ).toBe("completed_full");
    expect(
      trainingDisplayState(
        { status: "completed", completionQuality: "partial", date: "2026-09-15" },
        TODAY
      )
    ).toBe("completed_partial");
    expect(
      trainingDisplayState(
        { status: "skipped", completionQuality: "skipped", date: "2026-09-15" },
        TODAY
      )
    ).toBe("skipped");
  });

  it("derives missed from the caller's own today, and never for today itself", () => {
    const scheduled = { status: "scheduled", completionQuality: null } as const;
    expect(trainingDisplayState({ ...scheduled, date: "2026-09-16" }, TODAY)).toBe("missed");
    expect(trainingDisplayState({ ...scheduled, date: "2026-09-17" }, TODAY)).toBe("scheduled");
    expect(trainingDisplayState({ ...scheduled, date: "2026-09-18" }, TODAY)).toBe("scheduled");
  });

  it("keeps a logged workout logged however old its day is", () => {
    expect(
      trainingDisplayState(
        { status: "completed", completionQuality: "partial", date: "2020-01-01" },
        TODAY
      )
    ).toBe("completed_partial");
  });
});

describe("eventWorkoutRead", () => {
  it("reads the two facts off a calendar event", () => {
    expect(
      eventWorkoutRead({
        status: "completed",
        log: { completionQuality: "partial" },
      })
    ).toEqual({ status: "completed", completionQuality: "partial" });

    expect(eventWorkoutRead({ status: "scheduled", log: null })).toEqual({
      status: "scheduled",
      completionQuality: null,
    });
  });
});
