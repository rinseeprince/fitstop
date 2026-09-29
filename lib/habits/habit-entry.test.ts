import { describe, it, expect } from "vitest";
import { answerMismatch, entryMet, isHabitDirection, isHabitMeasure } from "./habit-entry";

const tick = { measure: "tick" as const, direction: null };
const atLeast = { measure: "number" as const, direction: "at_least" as const };
const atMost = { measure: "number" as const, direction: "at_most" as const };

describe("entryMet", () => {
  it("meets a tick habit when done, and only then", () => {
    expect(entryMet(tick, { done: true, value: null }, null)).toBe(true);
    expect(entryMet(tick, { done: false, value: null }, null)).toBe(false);
  });

  it("meets an at-least habit at or above the day's target", () => {
    expect(entryMet(atLeast, { done: null, value: 3 }, 3)).toBe(true);
    expect(entryMet(atLeast, { done: null, value: 3.25 }, 3)).toBe(true);
    expect(entryMet(atLeast, { done: null, value: 2.99 }, 3)).toBe(false);
  });

  it("meets an at-most habit at or below the day's target, zero included", () => {
    expect(entryMet(atMost, { done: null, value: 2 }, 2)).toBe(true);
    expect(entryMet(atMost, { done: null, value: 0 }, 2)).toBe(true);
    expect(entryMet(atMost, { done: null, value: 3 }, 2)).toBe(false);
  });

  it("judges a number against the target it is given — a one-date edit's — not a fixed one", () => {
    expect(entryMet(atLeast, { done: null, value: 2.5 }, 2)).toBe(true);
    expect(entryMet(atLeast, { done: null, value: 2.5 }, 3)).toBe(false);
  });

  it("meets nothing without a number or without a target", () => {
    expect(entryMet(atLeast, { done: null, value: null }, 3)).toBe(false);
    expect(entryMet(atLeast, { done: null, value: 3 }, null)).toBe(false);
  });
});

describe("answerMismatch", () => {
  it("takes a tick habit's done and a number habit's value, and names what the other wanted", () => {
    expect(answerMismatch("tick", { done: false })).toBeNull();
    expect(answerMismatch("number", { value: 0 })).toBeNull();
    expect(answerMismatch("tick", { value: 3 })).toBe("expects_tick");
    expect(answerMismatch("number", { done: true })).toBe("expects_number");
  });
});

describe("the stored words", () => {
  it("knows the two measures and the two directions, and nothing else", () => {
    expect(["tick", "number", "count"].map(isHabitMeasure)).toEqual([true, true, false]);
    expect(["at_least", "at_most", "exactly"].map(isHabitDirection)).toEqual([true, true, false]);
  });
});
