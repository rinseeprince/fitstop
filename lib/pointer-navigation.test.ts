import { describe, it, expect } from "vitest";
import { isPlainLeftClick } from "./pointer-navigation";

const click = (overrides: Partial<Parameters<typeof isPlainLeftClick>[0]> = {}) => ({
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...overrides,
});

describe("isPlainLeftClick", () => {
  it("is the unmodified primary click", () => {
    expect(isPlainLeftClick(click())).toBe(true);
  });

  it("is not a modified or non-primary click — those open elsewhere", () => {
    expect(isPlainLeftClick(click({ metaKey: true }))).toBe(false);
    expect(isPlainLeftClick(click({ ctrlKey: true }))).toBe(false);
    expect(isPlainLeftClick(click({ shiftKey: true }))).toBe(false);
    expect(isPlainLeftClick(click({ altKey: true }))).toBe(false);
    expect(isPlainLeftClick(click({ button: 1 }))).toBe(false);
  });
});
