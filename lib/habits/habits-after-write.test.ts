import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/services/client-habit-figures-service", () => ({
  getCoachHabitList: vi.fn(),
  getCoachHabitWeek: vi.fn(),
  getCoachHabitWeekAndCurrent: vi.fn(),
}));

import { getCoachHabitList, getCoachHabitWeek, getCoachHabitWeekAndCurrent } from "@/services/client-habit-figures-service";
import { habitsAfterWrite, readShownWeek } from "./habits-after-write";
import type { CoachHabitWeek } from "@/types/habits";

const LIST = { clientToday: "2026-09-30", habits: [] };
const week = (start: string, end: string): CoachHabitWeek => ({
  clientToday: "2026-09-30",
  start,
  end,
  dates: [],
  habits: [],
  totals: { planned: 0, done: 0, met: 0 },
  today: null,
});
const CURRENT = week("2026-09-24", "2026-09-30");
const LAST = week("2026-09-17", "2026-09-23");

beforeEach(() => vi.clearAllMocks());

describe("readShownWeek — the week the Habits tab shows, named with a write", () => {
  const read = (query: string) => readShownWeek(new NextRequest(`http://localhost:3000/api/clients/c/habits${query}`));

  it("is the day named, or none for the client's current week", () => {
    expect(read("?week=2026-09-17")).toEqual({ ok: true, week: "2026-09-17" });
    expect(read("")).toEqual({ ok: true, week: null });
  });

  it("refuses a day that is not a real one with a 400", async () => {
    for (const query of ["?week=2026-02-30", "?week=soon", "?week="]) {
      const shown = read(query);
      expect(shown.ok).toBe(false);
      if (!shown.ok) {
        expect(shown.response.status).toBe(400);
        expect(await shown.response.json()).toEqual({ success: false, error: "Invalid date" });
      }
    }
  });
});

describe("habitsAfterWrite", () => {
  it("answers a write on the current week with the habits and that week, read side by side on the route's today", async () => {
    vi.mocked(getCoachHabitList).mockResolvedValue(LIST);
    vi.mocked(getCoachHabitWeek).mockResolvedValue(CURRENT);
    const response = await habitsAfterWrite("client-2", { today: "2026-09-30", week: null }, (after) => ({ changed: true, ...after }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: { changed: true, habits: LIST, week: CURRENT, currentWeek: null },
    });
    expect(getCoachHabitList).toHaveBeenCalledWith("client-2", "2026-09-30");
    expect(getCoachHabitWeek).toHaveBeenCalledWith("client-2", undefined, "2026-09-30");
    expect(getCoachHabitWeekAndCurrent).not.toHaveBeenCalled();
  });

  // The Habits tab's summary shows now whichever week its table shows, so a
  // write made on another week answers with the current week too.
  it("answers a write on another week with that week and the client's current week", async () => {
    vi.mocked(getCoachHabitList).mockResolvedValue(LIST);
    vi.mocked(getCoachHabitWeekAndCurrent).mockResolvedValue({ week: LAST, currentWeek: CURRENT });
    const response = await habitsAfterWrite("client-2", { today: "2026-09-30", week: "2026-09-17" }, (after) => after);
    expect(await response.json()).toEqual({ success: true, data: { habits: LIST, week: LAST, currentWeek: CURRENT } });
    expect(getCoachHabitWeekAndCurrent).toHaveBeenCalledWith("client-2", "2026-09-17", "2026-09-30");
    expect(getCoachHabitWeek).not.toHaveBeenCalled();
  });

  it("lets each read find the client's today when the route has none", async () => {
    vi.mocked(getCoachHabitList).mockResolvedValue(LIST);
    vi.mocked(getCoachHabitWeek).mockResolvedValue(CURRENT);
    await habitsAfterWrite("client-2", { week: null }, (after) => after);
    expect(getCoachHabitList).toHaveBeenCalledWith("client-2", undefined);
    expect(getCoachHabitWeek).toHaveBeenCalledWith("client-2", undefined, undefined);
  });

  it.each([
    ["the habits", () => vi.mocked(getCoachHabitList).mockRejectedValue(new Error("read failed")), null],
    ["the week", () => vi.mocked(getCoachHabitWeek).mockRejectedValue(new Error("read failed")), null],
    ["another week", () => vi.mocked(getCoachHabitWeekAndCurrent).mockRejectedValue(new Error("read failed")), "2026-09-17"],
  ])("answers as saved with none of them, never a failed save, when reading %s back fails", async (_read, fail, named) => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(getCoachHabitList).mockResolvedValue(LIST);
    vi.mocked(getCoachHabitWeek).mockResolvedValue(CURRENT);
    vi.mocked(getCoachHabitWeekAndCurrent).mockResolvedValue({ week: LAST, currentWeek: CURRENT });
    fail();
    const response = await habitsAfterWrite("client-2", { week: named }, (after) => ({ changed: true, ...after }));
    // A failure here would have the screen send the write again: a second habit.
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { changed: true, habits: null, week: null, currentWeek: null } });
    expect(spy).toHaveBeenCalledWith("Habit write committed, reading the habits back failed:", expect.any(Error));
    spy.mockRestore();
  });
});
