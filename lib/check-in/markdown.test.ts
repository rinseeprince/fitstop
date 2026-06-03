import { describe, it, expect } from "vitest";
import { stripInlineMarkdown } from "./markdown";

describe("stripInlineMarkdown", () => {
  it("removes bold markers but keeps the text", () => {
    expect(stripInlineMarkdown("Great week of **consistent** training")).toBe(
      "Great week of consistent training"
    );
  });

  it("removes italic and bold-italic markers", () => {
    expect(stripInlineMarkdown("*nice* and ***big*** wins")).toBe("nice and big wins");
  });

  it("removes inline code and leading list / heading markers", () => {
    expect(stripInlineMarkdown("# Heading")).toBe("Heading");
    expect(stripInlineMarkdown("- a bullet")).toBe("a bullet");
    expect(stripInlineMarkdown("use `npm run test`")).toBe("use npm run test");
  });

  it("leaves ordinary underscores (snake_case) untouched", () => {
    expect(stripInlineMarkdown("the check_in_id value")).toBe("the check_in_id value");
  });

  it("handles empty and nullish input", () => {
    expect(stripInlineMarkdown("")).toBe("");
    expect(stripInlineMarkdown(null)).toBe("");
    expect(stripInlineMarkdown(undefined)).toBe("");
  });
});
