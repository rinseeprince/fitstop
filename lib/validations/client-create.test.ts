import { describe, expect, it } from "vitest";
import { createClientSchema } from "./client";

// A manual setup is the only path that can mint a client with no starting
// measurement: the intake questionnaire requires a weight of its own, and
// createClient copies whatever it is handed into BOTH the current and the
// starting columns. Left open, a client could be fully set up and activated
// having never had a start weight — no BMR, no TDEE, no baseline for any
// progress figure.

const BASE = { name: "Alex Doe", email: "alex@example.com" };

describe("createClientSchema — a starting measurement is required", () => {
  it("rejects a manual add with no weight", () => {
    const result = createClientSchema.safeParse({ ...BASE, setupMode: "manual" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["currentWeight"]);
    }
  });

  it("rejects an ABSENT setupMode the same way", () => {
    // createClient treats anything but "intake" as manual (isIntakeMode), so
    // the predicate has to match that rather than testing for "manual".
    const result = createClientSchema.safeParse(BASE);
    expect(result.success).toBe(false);
  });

  it("accepts a manual add carrying a weight", () => {
    const result = createClientSchema.safeParse({
      ...BASE,
      setupMode: "manual",
      currentWeight: 82,
    });
    expect(result.success).toBe(true);
  });

  it("leaves the INTAKE path alone — the questionnaire enforces it downstream", () => {
    const result = createClientSchema.safeParse({ ...BASE, setupMode: "intake" });
    expect(result.success).toBe(true);
  });

  it("still does not require a body fat on either path", () => {
    expect(
      createClientSchema.safeParse({ ...BASE, setupMode: "manual", currentWeight: 82 })
        .success
    ).toBe(true);
    expect(createClientSchema.safeParse({ ...BASE, setupMode: "intake" }).success).toBe(
      true
    );
  });
});
