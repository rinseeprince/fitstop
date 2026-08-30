import { describe, it, expect } from "vitest";
import {
  CHECK_IN_FORM_FIELDS,
  CHECK_IN_FORM_FIELD_KEYS,
  DEFAULT_CHECK_IN_FORM_FIELDS,
  applyCheckInForm,
  CHECK_IN_FORM_STEPS,
  CHECK_IN_STEP_LABELS,
  isCheckInFormFieldKey,
  stepsForFields,
} from "./form-fields";

const ALL = [...DEFAULT_CHECK_IN_FORM_FIELDS];

describe("the field enum", () => {
  it("is exactly the 14 keys migration 157's CHECK constrains", () => {
    // Pinned as a literal, not derived: if someone adds a key here without the
    // matching CHECK value, the INSERT fails at runtime with a constraint
    // violation and no test would otherwise say so.
    expect([...CHECK_IN_FORM_FIELD_KEYS]).toEqual([
      "notes",
      "weight",
      "body_fat",
      "waist",
      "hips",
      "chest",
      "arms",
      "thighs",
      "photo_front",
      "photo_side",
      "photo_back",
      "exercise_highlights",
      "prs",
      "challenges",
    ]);
  });

  it("carries no wellness key — those five are derived, not collected", () => {
    // Session 6.4 removed the pickers and sliders; submitCheckIn derives
    // mood/energy/sleep/stress/soreness from wellness_logs. A key here would
    // promise a toggle over a field the client never fills in.
    for (const key of ["mood", "energy", "sleep", "stress", "soreness"]) {
      expect(isCheckInFormFieldKey(key)).toBe(false);
    }
  });

  it("gives every key exactly one step and one label", () => {
    expect(CHECK_IN_FORM_FIELDS).toHaveLength(14);
    expect(new Set(CHECK_IN_FORM_FIELDS.map((f) => f.label)).size).toBe(14);
  });
});

describe("stepsForFields", () => {
  it("returns all four steps for the default form", () => {
    expect(stepsForFields(ALL)).toEqual(["feeling", "metrics", "photos", "training"]);
  });

  it("drops Photos when no photo is asked", () => {
    const fields = ALL.filter((k) => !k.startsWith("photo_"));
    expect(stepsForFields(fields)).toEqual(["feeling", "metrics", "training"]);
  });

  it("drops Metrics when neither weight, body fat nor any girth is asked", () => {
    const metricKeys = ["weight", "body_fat", "waist", "hips", "chest", "arms", "thighs"];
    const fields = ALL.filter((k) => !metricKeys.includes(k));
    expect(stepsForFields(fields)).toEqual(["feeling", "photos", "training"]);
  });

  it("keeps Metrics when only ONE girth survives", () => {
    expect(stepsForFields(["waist"])).toContain("metrics");
  });

  it("keeps Feeling and Training with every key off — the floor is two steps", () => {
    // Their content is the client's own week read back to them (the wellness
    // summary; the session checklist, which is a fill-gap LOGGER, and the
    // nutrition summary). No field key switches those.
    expect(stepsForFields([])).toEqual(["feeling", "training"]);
  });
});

describe("CHECK_IN_STEP_LABELS", () => {
  it("labels every step, because the wizard has no second source", () => {
    // One map serves the client's progress indicator AND the coach's field
    // groups; a missing entry would render `undefined` on both.
    for (const step of CHECK_IN_FORM_STEPS) {
      expect(CHECK_IN_STEP_LABELS[step]).toBeTruthy();
    }
    expect(Object.keys(CHECK_IN_STEP_LABELS).sort()).toEqual(
      [...CHECK_IN_FORM_STEPS].sort()
    );
  });
});

describe("applyCheckInForm", () => {
  const full = {
    notes: "felt good",
    weight: 82.5,
    weightUnit: "kg" as const,
    bodyFatPercentage: 17,
    waist: 84,
    hips: 96,
    chest: 101,
    arms: 36,
    thighs: 58,
    measurementUnit: "cm" as const,
    photoFront: "data:image/png;base64,AAA",
    photoSide: "data:image/png;base64,BBB",
    photoBack: "data:image/png;base64,CCC",
    exerciseHighlights: [{ exerciseName: "Squat" }],
    prs: "5kg PB",
    challenges: "travel week",
    customAnswers: [{ questionId: "q-1", answer: "yes" }],
  };
  const everything = { fields: ALL, questionIds: ["q-1"] };

  it("passes the full form through untouched", () => {
    const out = applyCheckInForm(full, everything);
    expect(out.weight).toBe(82.5);
    expect(out.notes).toBe("felt good");
    expect(out.photoFront).toBe("data:image/png;base64,AAA");
    expect(out.customAnswers).toEqual([{ questionId: "q-1", answer: "yes" }]);
  });

  it("strips a disabled weight AND its unit tag", () => {
    // A tag left behind states a unit for nothing (CONVENTIONS §20).
    const out = applyCheckInForm(full, {
      ...everything,
      fields: ALL.filter((k) => k !== "weight"),
    });
    expect(out.weight).toBeUndefined();
    expect(out.weightUnit).toBeUndefined();
    // The girths and their own tag are untouched.
    expect(out.waist).toBe(84);
    expect(out.measurementUnit).toBe("cm");
  });

  it("keeps measurementUnit while ANY girth survives, drops it when none do", () => {
    const oneLeft = applyCheckInForm(full, {
      ...everything,
      fields: ALL.filter((k) => ["hips", "chest", "arms", "thighs"].includes(k) === false),
    });
    expect(oneLeft.waist).toBe(84);
    expect(oneLeft.measurementUnit).toBe("cm");

    const noneLeft = applyCheckInForm(full, {
      ...everything,
      fields: ALL.filter(
        (k) => !["waist", "hips", "chest", "arms", "thighs"].includes(k)
      ),
    });
    expect(noneLeft.measurementUnit).toBeUndefined();
  });

  it("strips every disabled photo before it can be uploaded", () => {
    const out = applyCheckInForm(full, {
      ...everything,
      fields: ALL.filter((k) => !k.startsWith("photo_")),
    });
    expect(out.photoFront).toBeUndefined();
    expect(out.photoSide).toBeUndefined();
    expect(out.photoBack).toBeUndefined();
  });

  it("strips notes, wins, challenges and highlights independently", () => {
    const out = applyCheckInForm(full, {
      ...everything,
      fields: ALL.filter(
        (k) => !["notes", "prs", "challenges", "exercise_highlights"].includes(k)
      ),
    });
    expect(out.notes).toBeUndefined();
    expect(out.prs).toBeUndefined();
    expect(out.challenges).toBeUndefined();
    expect(out.exerciseHighlights).toBeUndefined();
    // Everything else survives — a strip is per-key, not per-step.
    expect(out.weight).toBe(82.5);
  });

  it("drops an answer to a question this form does not ask", () => {
    const out = applyCheckInForm(
      { ...full, customAnswers: [{ questionId: "q-gone", answer: "stale draft" }] },
      everything
    );
    expect(out.customAnswers).toEqual([]);
  });

  it("drops blank and whitespace-only answers", () => {
    // The column CHECKs char_length >= 1; a blank is an unanswered question.
    const out = applyCheckInForm(
      {
        ...full,
        customAnswers: [
          { questionId: "q-1", answer: "   " },
          { questionId: "q-2", answer: "real" },
        ],
      },
      { ...everything, questionIds: ["q-1", "q-2"] }
    );
    expect(out.customAnswers).toEqual([{ questionId: "q-2", answer: "real" }]);
  });

  it("collapses a duplicated question id to the first answer", () => {
    // check_in_answers is UNIQUE per (check-in, question) — a repeat would
    // 23505 the insert rather than reaching the client as a message.
    const out = applyCheckInForm(
      {
        ...full,
        customAnswers: [
          { questionId: "q-1", answer: "first" },
          { questionId: "q-1", answer: "second" },
        ],
      },
      everything
    );
    expect(out.customAnswers).toEqual([{ questionId: "q-1", answer: "first" }]);
  });

  it("tolerates a non-array customAnswers from a stale localStorage draft", () => {
    const out = applyCheckInForm(
      { ...full, customAnswers: "junk" as unknown as typeof full.customAnswers },
      everything
    );
    expect(out.customAnswers).toEqual([]);
  });

  it("never throws on an all-off form", () => {
    const out = applyCheckInForm(full, { fields: [], questionIds: [] });
    expect(out.weight).toBeUndefined();
    expect(out.notes).toBeUndefined();
    expect(out.customAnswers).toEqual([]);
  });
});
