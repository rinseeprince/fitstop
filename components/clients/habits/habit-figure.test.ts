import { describe, it, expect } from "vitest";
import { habitFigure } from "./habit-figure";

describe("habitFigure — the Habits tab's done of planned", () => {
  it("writes done of planned", () => {
    expect(habitFigure(6, 14)).toBe("6/14");
    expect(habitFigure(0, 2)).toBe("0/2");
    expect(habitFigure(7, 7)).toBe("7/7");
  });

  it("has no figure when nothing was planned, whatever was done", () => {
    expect(habitFigure(0, 0)).toBeNull();
    expect(habitFigure(2, 0)).toBeNull();
  });
});
