import { describe, it, expect } from "vitest";
import { MAX_CHECK_IN_QUESTIONS } from "@/lib/constants";
import {
  createCheckInQuestionSchema,
  saveCheckInFormSchema,
  saveCheckInTemplateSchema,
  updateCheckInQuestionSchema,
} from "./check-in-form";

const uuid = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;

describe("saveCheckInFormSchema", () => {
  it("accepts an empty form — every field off is a legal choice", () => {
    expect(saveCheckInFormSchema.safeParse({ fields: [], questions: [] }).success).toBe(true);
  });

  it("rejects a field key that is not one of the 14", () => {
    // "mood" is the tempting one: it is a check_ins column and a schema field,
    // but it is derived from wellness_logs and never collected.
    const result = saveCheckInFormSchema.safeParse({ fields: ["mood"], questions: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a field listed twice", () => {
    const result = saveCheckInFormSchema.safeParse({
      fields: ["weight", "weight"],
      questions: [],
    });
    expect(result.success).toBe(false);
    expect(String(result.error)).toContain("A field is listed twice");
  });

  it("rejects a question listed twice, naming the problem rather than 23505ing", () => {
    const result = saveCheckInFormSchema.safeParse({
      fields: [],
      questions: [
        { questionId: uuid(1), enabled: true },
        { questionId: uuid(1), enabled: false },
      ],
    });
    expect(result.success).toBe(false);
    expect(String(result.error)).toContain("A question is listed twice");
  });

  it("caps questions at MAX_CHECK_IN_QUESTIONS, the same bound the submit schema uses", () => {
    const questions = Array.from({ length: MAX_CHECK_IN_QUESTIONS + 1 }, (_, i) => ({
      questionId: uuid(i),
      enabled: true,
    }));
    expect(saveCheckInFormSchema.safeParse({ fields: [], questions }).success).toBe(false);
    expect(
      saveCheckInFormSchema.safeParse({ fields: [], questions: questions.slice(0, -1) })
        .success
    ).toBe(true);
  });

  it("requires a real uuid for a question id", () => {
    const result = saveCheckInFormSchema.safeParse({
      fields: [],
      questions: [{ questionId: "not-a-uuid", enabled: true }],
    });
    expect(result.success).toBe(false);
  });
});

describe("saveCheckInTemplateSchema", () => {
  it("requires a name and trims it", () => {
    expect(
      saveCheckInTemplateSchema.safeParse({ name: "  ", fields: [], questions: [] }).success
    ).toBe(false);

    const ok = saveCheckInTemplateSchema.safeParse({
      name: "  Fortnightly  ",
      fields: ["weight"],
      questions: [],
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.name).toBe("Fortnightly");
  });

  it("still enforces the form rules underneath", () => {
    const result = saveCheckInTemplateSchema.safeParse({
      name: "Bad",
      fields: ["weight", "weight"],
      questions: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("question schemas", () => {
  it("requires a non-empty prompt on create", () => {
    expect(createCheckInQuestionSchema.safeParse({ prompt: "   " }).success).toBe(false);
    expect(createCheckInQuestionSchema.safeParse({ prompt: "How was sleep?" }).success).toBe(
      true
    );
  });

  it("caps a prompt at 300 characters, matching the column CHECK", () => {
    expect(
      createCheckInQuestionSchema.safeParse({ prompt: "x".repeat(301) }).success
    ).toBe(false);
  });

  it("accepts a reword, an archive, a restore — but not an empty patch", () => {
    expect(updateCheckInQuestionSchema.safeParse({ prompt: "New wording" }).success).toBe(true);
    expect(updateCheckInQuestionSchema.safeParse({ archived: true }).success).toBe(true);
    expect(updateCheckInQuestionSchema.safeParse({ archived: false }).success).toBe(true);
    expect(updateCheckInQuestionSchema.safeParse({}).success).toBe(false);
  });
});
