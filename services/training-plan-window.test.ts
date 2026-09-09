import { describe, it, expect, vi } from "vitest";
import { coversDate } from "./training-plan-window";

describe("coversDate", () => {
  it("asks for a start on or before the date and an end on or after it — both ends are on the row (migration 167)", () => {
    const q = { lte: vi.fn(), gte: vi.fn() };
    q.lte.mockReturnValue(q);
    q.gte.mockReturnValue(q);

    expect(coversDate(q, "2026-09-10")).toBe(q);
    expect(q.lte).toHaveBeenCalledWith("effective_from", "2026-09-10");
    expect(q.gte).toHaveBeenCalledWith("effective_until", "2026-09-10");
    // No open-window arm: the day after a program's end, nothing resolves it.
    expect(q.lte).toHaveBeenCalledTimes(1);
    expect(q.gte).toHaveBeenCalledTimes(1);
  });
});
