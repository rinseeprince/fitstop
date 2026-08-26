import { describe, it, expect } from "vitest";
import { resolveSessionPick } from "./session-pick";
import type { ClientTrainingWeekSession } from "@/types/client-training-week";

const WED = "2026-08-26";
const THU = "2026-08-27";

function pick(over: Partial<ClientTrainingWeekSession> = {}): ClientTrainingWeekSession {
  return {
    eventId: "ev-thu",
    sessionId: "s-thu",
    name: "Legs",
    focus: null,
    date: THU,
    state: "upcoming",
    isScheduled: true,
    ...over,
  };
}

describe("resolveSessionPick — rest day", () => {
  const ctx = { kind: "rest-day" as const, date: WED };

  it("moves a still-scheduled session onto the rest day and opens it there", () => {
    expect(resolveSessionPick(pick(), ctx)).toEqual({
      action: "move",
      moves: [{ eventId: "ev-thu", fromDate: THU, toDate: WED }],
      openEventId: "ev-thu",
    });
  });

  it("moves a missed-but-still-scheduled session forward (the make-up case)", () => {
    expect(resolveSessionPick(pick({ date: "2026-08-24", state: "missed" }), ctx).action).toBe(
      "move",
    );
  });

  it("opens a session already on this day instead of moving it onto itself", () => {
    expect(resolveSessionPick(pick({ date: WED, state: "today" }), ctx)).toEqual({
      action: "open",
      eventId: "ev-thu",
    });
  });

  it("a session that has been done or skipped is not something to do again", () => {
    expect(resolveSessionPick(pick({ state: "done", isScheduled: false }), ctx).action).toBe(
      "unavailable",
    );
    expect(resolveSessionPick(pick({ state: "missed", isScheduled: false }), ctx).action).toBe(
      "unavailable",
    );
  });
});

describe("resolveSessionPick — prescribed day", () => {
  const ctx = {
    kind: "prescribed-day" as const,
    date: WED,
    eventId: "ev-wed",
    eventDate: WED,
    logged: false,
  };

  it("swaps days with a still-scheduled other-day session and opens the swapped-in one", () => {
    expect(resolveSessionPick(pick(), ctx)).toEqual({
      action: "swap",
      moves: [
        { eventId: "ev-thu", fromDate: THU, toDate: WED },
        { eventId: "ev-wed", fromDate: WED, toDate: THU },
      ],
      openEventId: "ev-thu",
    });
  });

  it("never swaps once today's session is logged — the pick becomes an alt", () => {
    expect(resolveSessionPick(pick(), { ...ctx, logged: true })).toEqual({
      action: "alt",
      sessionId: "s-thu",
    });
  });

  it("picking the session you are already on just opens it", () => {
    expect(resolveSessionPick(pick({ eventId: "ev-wed", date: WED, state: "today" }), ctx)).toEqual(
      { action: "open", eventId: "ev-wed" },
    );
  });

  it("a done session is unavailable here too", () => {
    expect(resolveSessionPick(pick({ state: "done", isScheduled: false }), ctx).action).toBe(
      "unavailable",
    );
  });

  it("is unavailable when an alt's session row is gone", () => {
    expect(
      resolveSessionPick(pick({ sessionId: null }), { ...ctx, logged: true }).action,
    ).toBe("unavailable");
  });
});
