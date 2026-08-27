import { describe, it, expect } from "vitest";
import { buildWeekLayout } from "./week-layout";
import type { ClientTrainingWeek, ClientTrainingWeekSession } from "@/types/client-training-week";

// Mon 24 → Sun 30 Aug 2026, today Wed 26.
const WEEK_START = "2026-08-24";
const MON = "2026-08-24";
const TUE = "2026-08-25";
const WED = "2026-08-26";
const THU = "2026-08-27";
const SAT = "2026-08-29";
const SUN = "2026-08-30";

const session = (over: Partial<ClientTrainingWeekSession>): ClientTrainingWeekSession => ({
  eventId: "ev",
  sessionId: "s",
  name: "Session",
  focus: null,
  date: THU,
  state: "upcoming",
  isScheduled: true,
  ...over,
});

const pushDone = session({ eventId: "ev-mon", name: "Push", date: MON, state: "done", isScheduled: false });
const legs = session({ eventId: "ev-thu", name: "Legs", date: THU });
const upper = session({ eventId: "ev-sat", name: "Upper", date: SAT });

function week(sessions: ClientTrainingWeekSession[]): ClientTrainingWeek {
  return { weekStart: WEEK_START, weekEnd: SUN, today: WED, sessions };
}

describe("buildWeekLayout — the week as read", () => {
  it("lays out seven days from weekStart with each session on its own day", () => {
    const layout = buildWeekLayout(week([pushDone, legs, upper]), {});

    expect(layout.days.map((d) => d.date)).toEqual([MON, TUE, WED, THU, "2026-08-28", SAT, SUN]);
    expect(layout.days[0].entries.map((e) => e.session.name)).toEqual(["Push"]);
    expect(layout.days[3].entries.map((e) => e.session.name)).toEqual(["Legs"]);
    expect(layout.days[5].entries.map((e) => e.session.name)).toEqual(["Upper"]);
    expect(layout.days[1].entries).toEqual([]);
    expect(layout.moves).toEqual([]);
    expect(layout.conflictDates).toEqual([]);
    expect(layout.isDirty).toBe(false);
    expect(layout.canSave).toBe(false);
  });

  it("flags today and the days already behind the client", () => {
    const layout = buildWeekLayout(week([]), {});

    expect(layout.days.map((d) => d.isToday)).toEqual([false, false, true, false, false, false, false]);
    expect(layout.days.map((d) => d.isPast)).toEqual([true, true, false, false, false, false, false]);
  });
});

describe("buildWeekLayout — unsaved moves", () => {
  it("moves a scheduled session onto an empty day: one move, from the day it was read on", () => {
    const layout = buildWeekLayout(week([legs, upper]), { "ev-thu": TUE });

    expect(layout.days[1].entries).toEqual([{ session: legs, pendingFrom: THU }]);
    expect(layout.days[3].entries).toEqual([]);
    expect(layout.moves).toEqual([{ eventId: "ev-thu", fromDate: THU, toDate: TUE }]);
    expect(layout.conflictDates).toEqual([]);
    expect(layout.canSave).toBe(true);
  });

  it("dropping onto an occupied day stacks the two and blocks saving", () => {
    const layout = buildWeekLayout(week([legs, upper]), { "ev-thu": SAT });

    expect(layout.days[5].entries.map((e) => e.session.name)).toEqual(["Upper", "Legs"]);
    expect(layout.conflictDates).toEqual([SAT]);
    expect(layout.isDirty).toBe(true);
    expect(layout.canSave).toBe(false);
  });

  it("completing the swap clears the stack and yields both moves", () => {
    const layout = buildWeekLayout(week([legs, upper]), { "ev-thu": SAT, "ev-sat": THU });

    expect(layout.conflictDates).toEqual([]);
    expect(layout.moves).toEqual([
      { eventId: "ev-thu", fromDate: THU, toDate: SAT },
      { eventId: "ev-sat", fromDate: SAT, toDate: THU },
    ]);
    expect(layout.canSave).toBe(true);
  });

  it("a session put back on its own day is not a move", () => {
    const layout = buildWeekLayout(week([legs]), { "ev-thu": THU });

    expect(layout.days[3].entries).toEqual([{ session: legs, pendingFrom: null }]);
    expect(layout.moves).toEqual([]);
    expect(layout.isDirty).toBe(false);
  });

  it("a stack on a done day can only be undone — the done session never moves", () => {
    const layout = buildWeekLayout(week([pushDone, legs]), { "ev-thu": MON });

    expect(layout.days[0].entries.map((e) => e.session.name)).toEqual(["Push", "Legs"]);
    expect(layout.conflictDates).toEqual([MON]);
    expect(layout.canSave).toBe(false);
  });

  it("ignores a placement for a session that is no longer scheduled", () => {
    const layout = buildWeekLayout(week([pushDone]), { "ev-mon": THU });

    expect(layout.days[0].entries).toEqual([{ session: pushDone, pendingFrom: null }]);
    expect(layout.moves).toEqual([]);
  });

  it("ignores a placement outside the week", () => {
    const layout = buildWeekLayout(week([legs]), { "ev-thu": "2026-09-02" });

    expect(layout.days[3].entries).toEqual([{ session: legs, pendingFrom: null }]);
    expect(layout.moves).toEqual([]);
  });
});
