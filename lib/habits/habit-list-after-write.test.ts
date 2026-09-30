import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/client-habit-figures-service", () => ({ getCoachHabitList: vi.fn() }));

import { getCoachHabitList } from "@/services/client-habit-figures-service";
import { habitListAfterWrite } from "./habit-list-after-write";

const LIST = { clientToday: "2026-09-30", habits: [] };

beforeEach(() => vi.clearAllMocks());

describe("habitListAfterWrite", () => {
  it("answers a committed write with the client's habits as they now stand, shaped by the route", async () => {
    vi.mocked(getCoachHabitList).mockResolvedValue(LIST);
    const response = await habitListAfterWrite("client-2", "2026-09-30", (habits) => ({ changed: true, habits }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { changed: true, habits: LIST } });
    expect(getCoachHabitList).toHaveBeenCalledWith("client-2", "2026-09-30");
  });

  it("answers a committed write as saved, with no habits, when reading them back fails — never as a failed save", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(getCoachHabitList).mockRejectedValue(new Error("read failed"));
    const response = await habitListAfterWrite("client-2", undefined, (habits) => ({ changed: true, habits }));
    // A failure here would have the screen send the write again: a second habit.
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { changed: true, habits: null } });
    expect(spy).toHaveBeenCalledWith("Habit write committed, reading the habits back failed:", expect.any(Error));
    spy.mockRestore();
  });
});
