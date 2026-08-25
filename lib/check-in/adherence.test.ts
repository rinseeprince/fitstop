import { describe, it, expect } from "vitest";
import { classifySession, summariseSessions } from "./adherence";
import type { CheckInSessionCompletion } from "@/types/check-in";

const session = (
  overrides: Partial<CheckInSessionCompletion>
): CheckInSessionCompletion => ({
  trainingSessionId: null,
  sessionName: "Session",
  completed: false,
  ...overrides,
});

describe("classifySession (logged quality wins)", () => {
  it("maps full quality to completed", () => {
    expect(classifySession(session({ completionQuality: "full" }))).toBe("completed");
  });

  it("maps partial quality to partial", () => {
    expect(classifySession(session({ completionQuality: "partial" }))).toBe("partial");
  });

  it("maps skipped quality to missed", () => {
    expect(classifySession(session({ completionQuality: "skipped" }))).toBe("missed");
  });

  it("falls back to the completed flag when there is no logged quality", () => {
    expect(classifySession(session({ completed: true }))).toBe("completed");
    expect(classifySession(session({ completed: false }))).toBe("missed");
  });

  it("lets partial quality override a completed flag", () => {
    expect(
      classifySession(session({ completed: true, completionQuality: "partial" }))
    ).toBe("partial");
  });
});

describe("summariseSessions", () => {
  it("counts partial towards the numerator and excludes missed", () => {
    const sessions = [
      session({ completionQuality: "full" }),
      session({ completionQuality: "full" }),
      session({ completionQuality: "full" }),
      session({ completionQuality: "partial" }),
      session({ completed: false }), // missed (not logged)
      session({ completionQuality: "skipped" }), // missed
    ];

    expect(summariseSessions(sessions)).toEqual({
      full: 3,
      partial: 1,
      missed: 2,
      completed: 4,
      prescribed: 6,
      pct: 67,
    });
  });

  it("returns a null pct for an empty week", () => {
    expect(summariseSessions([])).toEqual({
      full: 0,
      partial: 0,
      missed: 0,
      completed: 0,
      prescribed: 0,
      pct: null,
    });
  });
});
