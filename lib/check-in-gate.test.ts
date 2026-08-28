import { describe, it, expect, vi, afterEach } from "vitest";
import { getCheckInGate } from "./check-in-schedule";
import type { ClientWithCheckInInfo } from "@/types/check-in";

/**
 * The client-side gate. Replaces __tests__/lib/date-utils-checkin.test.ts and
 * the `getCheckInStatus` block of date-helpers.test.ts, both of which tested a
 * gate that derived its own period from a weekday.
 */

function makeClient(
  overrides: Partial<ClientWithCheckInInfo> = {}
): ClientWithCheckInInfo {
  return {
    id: "test-id",
    coachId: "coach-id",
    name: "Test Client",
    email: "test@test.com",
    active: true,
    includeActivityBurn: false,
    surplusAsCarbs: false,
    timezone: "UTC",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    checkInFrequency: "weekly",
    nextCheckInDue: "2026-03-15",
    ...overrides,
  };
}

function at(iso: string, run: () => void) {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date(iso + "T12:00:00Z"));
    run();
  } finally {
    vi.useRealTimers();
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("getCheckInGate", () => {
  it("is not_due before the due date, and reports the date itself", () => {
    at("2026-03-12", () => {
      expect(getCheckInGate(makeClient())).toEqual({
        status: "not_due",
        nextDueDate: "2026-03-15",
      });
    });
  });

  it("is available ON the due date", () => {
    at("2026-03-15", () => {
      expect(getCheckInGate(makeClient()).status).toBe("available");
    });
  });

  it("is overdue the day after, and stays loggable", () => {
    at("2026-03-16", () => {
      expect(getCheckInGate(makeClient()).status).toBe("overdue");
    });
  });

  it("opens and rolls on the CLIENT's day, not the server's", () => {
    // 23:30 UTC on 13 June is already 00:30 on the 14th in London (BST, UTC+1),
    // so the due day has arrived for the client while the server still reads
    // the 13th. June deliberately: in March the UK is still on UTC and the test
    // would prove nothing.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-06-13T23:30:00Z"));
      const client = makeClient({
        timezone: "Europe/London",
        nextCheckInDue: "2026-06-14",
      });
      expect(getCheckInGate(client).status).toBe("available");
    } finally {
      vi.useRealTimers();
    }
  });

  it("never gates a client with no schedule", () => {
    at("2026-03-16", () => {
      expect(getCheckInGate(makeClient({ nextCheckInDue: undefined }))).toEqual({
        status: "available",
        nextDueDate: null,
      });
      expect(getCheckInGate(makeClient({ checkInFrequency: "none" })).status).toBe(
        "available"
      );
    });
  });

  it("measures against the LIVE due date once one has lapsed", () => {
    // Six weeks of silence. The stored date is long gone; the lapse roll means
    // the client is measured against the check-in they can still act on rather
    // than being permanently, uselessly overdue against a dead one.
    at("2026-04-26", () => {
      expect(getCheckInGate(makeClient()).nextDueDate).toBe("2026-04-19");
    });
  });
});

describe("the schedule moving does not reach backwards", () => {
  // The bug this commit exists to fix, from the live row it was found on.
  //
  // Sam checked in on Thu 27 Aug for the week ending Wed 26 Aug. His coach then
  // set his next check-in to Thu 3 Sep. On Fri 28 Aug his phone said "Overdue —
  // submit now": the old gate took THURSDAY from the new date, asked when the
  // most recent Thursday was (27 Aug), found no check-in stamped for it, and
  // called him overdue — for a deadline that had never existed. His coach's
  // screen, reading the same stored date on the same row at the same moment,
  // correctly said "in 6 days".
  it("reads Sam's row as not_due, the same as the coach's screen", () => {
    at("2026-08-28", () => {
      const sam = makeClient({
        nextCheckInDue: "2026-09-03",
        timezone: "Europe/London",
        startDate: "2026-04-01",
      });

      expect(getCheckInGate(sam)).toEqual({
        status: "not_due",
        nextDueDate: "2026-09-03",
      });
    });
  });

  it("ignores the client's check-in history entirely", () => {
    // The gate takes only the client. There is no history parameter to get
    // wrong, which is what makes the bug above unrepeatable rather than merely
    // fixed: a stale period end cannot reach a decision it is not passed to.
    expect(getCheckInGate.length).toBe(1);
  });
});

describe("a late check-in does not hide the next one", () => {
  // Caught while writing this commit, before it shipped. A first draft decided
  // "already checked in" by comparing the last submission against the current
  // cycle. A client who checked in three days late would then have been shown
  // "completed" on their NEXT due day — hiding a check-in they owed. There is
  // no such comparison any more: the due date alone decides.
  it("is available on the due day even when the client checked in recently", () => {
    at("2026-03-15", () => {
      const lateSubmitter = makeClient({
        nextCheckInDue: "2026-03-15",
        lastCheckInDate: "2026-03-11T10:00:00Z", // three days late for the last one
        lastCheckInPeriodEnd: "2026-03-08",
      });
      expect(getCheckInGate(lateSubmitter).status).toBe("available");
    });
  });
});
