import { describe, it, expect } from "vitest";
import { resolveSessionPick } from "./session-pick";
import type { ClientTrainingWeekSession } from "@/types/client-training-week";

const WED = "2026-08-26";
const THU = "2026-08-27";
const FRI = "2026-08-28";

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
    const res = resolveSessionPick(pick({ date: "2026-08-24", state: "missed" }), ctx);
    expect(res.action).toBe("move");
  });

  it("logs an already-done session as an extra rather than moving it", () => {
    expect(resolveSessionPick(pick({ state: "done", isScheduled: false }), ctx)).toEqual({
      action: "extra",
      sessionId: "s-thu",
    });
  });

  it("a skipped day reads 'missed' but cannot move — it is an extra", () => {
    expect(resolveSessionPick(pick({ state: "missed", isScheduled: false }), ctx).action).toBe(
      "extra",
    );
  });

  it("opens a session already on this day instead of moving it onto itself", () => {
    expect(resolveSessionPick(pick({ date: WED, state: "today" }), ctx)).toEqual({
      action: "open",
      eventId: "ev-thu",
    });
  });

  it("is unavailable when the session row behind an extra is gone", () => {
    const res = resolveSessionPick(pick({ state: "done", isScheduled: false, sessionId: null }), ctx);
    expect(res.action).toBe("unavailable");
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

  it("an already-done session picked today is an alt, not a swap", () => {
    expect(resolveSessionPick(pick({ date: FRI, state: "done", isScheduled: false }), ctx).action).toBe(
      "alt",
    );
  });

  it("picking the session you are already on just opens it", () => {
    expect(resolveSessionPick(pick({ eventId: "ev-wed", date: WED, state: "today" }), ctx)).toEqual(
      { action: "open", eventId: "ev-wed" },
    );
  });

  it("is unavailable when an alt's session row is gone", () => {
    expect(
      resolveSessionPick(pick({ state: "done", isScheduled: false, sessionId: null }), ctx).action,
    ).toBe("unavailable");
  });
});
