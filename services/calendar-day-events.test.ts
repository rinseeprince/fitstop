import { describe, it, expect } from "vitest";
import { sessionsByDay } from "./calendar-day-events";

describe("sessionsByDay", () => {
  const event = (id: string, date: string, dayOrder: number) => ({ id, date, day_order: dayOrder });

  it("lists every session on a day in the day's order, whatever order they arrive in", () => {
    const byDay = sessionsByDay([
      event("e-3", "2026-09-17", 1),
      event("e-9", "2026-09-18", 0),
      event("e-1", "2026-09-17", 2),
      event("e-7", "2026-09-17", 0),
    ]);

    expect(byDay.get("2026-09-17")?.map((e) => e.id)).toEqual(["e-7", "e-3", "e-1"]);
    expect(byDay.get("2026-09-18")?.map((e) => e.id)).toEqual(["e-9"]);
    expect(byDay.has("2026-09-19")).toBe(false);
  });

  it("breaks a shared place by id, so two reads of one day always agree", () => {
    const byDay = sessionsByDay([event("e-b", "2026-09-17", 0), event("e-a", "2026-09-17", 0)]);

    expect(byDay.get("2026-09-17")?.map((e) => e.id)).toEqual(["e-a", "e-b"]);
  });
});
