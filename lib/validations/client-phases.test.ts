import { describe, it, expect } from "vitest";
import {
  MAX_CHAIN_WEEKS,
  MAX_PHASES,
  MAX_PHASE_WEEKS,
  MAX_ABS_RATE_KG_PER_WEEK,
  replacePhasesSchema,
  deletePhaseSchema,
} from "./client-phases";

/**
 * These bounds shipped with Session 2 and had no executing test: the phases
 * route's own suite exercises the auth chain, the audit calls and the elapsed
 * refusal, but only three of its fourteen tests touch validation at all (a
 * generic malformed body, an extra key, a non-uuid id). All four bounds below
 * could be deleted with the full suite green — which stayed harmless only
 * because nothing called the route. Session 3.1's panel is the first caller.
 */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const block = (weeks: number, over: Record<string, unknown> = {}) => ({
  name: "Cut",
  weeks,
  ratePerWeekKg: -0.5,
  ...over,
});

/** The messages are coach-visible — the route returns `details` verbatim. */
function messages(result: ReturnType<typeof replacePhasesSchema.safeParse>): string[] {
  return result.success ? [] : result.error.errors.map((e) => e.message);
}

describe("replacePhasesSchema — a well-formed chain", () => {
  it("accepts lengths only, with and without ids", () => {
    const result = replacePhasesSchema.safeParse({
      startDate: "2026-08-03",
      phases: [block(8, { id: uuid(1), name: "Cut 1" }), block(2, { ratePerWeekKg: 0 })],
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty chain — clearing every block is legal", () => {
    expect(
      replacePhasesSchema.safeParse({ startDate: "2026-08-03", phases: [] }).success
    ).toBe(true);
  });

  // Invariant 5: rate 0 IS maintenance, not a missing value. A truthiness check
  // anywhere in this path silently reclassifies every maintenance block.
  it("accepts a rate of exactly 0", () => {
    const result = replacePhasesSchema.safeParse({
      startDate: "2026-08-03",
      phases: [block(4, { ratePerWeekKg: 0 })],
    });
    expect(result.success).toBe(true);
  });
});

describe("MAX_PHASE_WEEKS — a single block cannot exceed a year", () => {
  it(`accepts ${MAX_PHASE_WEEKS} and rejects ${MAX_PHASE_WEEKS + 1}`, () => {
    expect(
      replacePhasesSchema.safeParse({
        startDate: "2026-08-03",
        phases: [block(MAX_PHASE_WEEKS)],
      }).success
    ).toBe(true);

    const over = replacePhasesSchema.safeParse({
      startDate: "2026-08-03",
      phases: [block(MAX_PHASE_WEEKS + 1)],
    });
    expect(over.success).toBe(false);
    expect(messages(over)).toContain(
      `A block cannot be longer than ${MAX_PHASE_WEEKS} weeks`
    );
  });

  it("rejects zero, negative and fractional lengths", () => {
    for (const weeks of [0, -1, 2.5]) {
      expect(
        replacePhasesSchema.safeParse({ startDate: "2026-08-03", phases: [block(weeks)] })
          .success
      ).toBe(false);
    }
  });
});

describe("MAX_CHAIN_WEEKS — the whole chain is what bounds the nutrition horizon", () => {
  // A from-scope cascade upserts one nutrition row per date in
  // max(from + 56d, last block end), so an unbounded chain would make every
  // placement, amendment and plan deletion write an unbounded number of rows.
  it(`accepts a chain totalling ${MAX_CHAIN_WEEKS} and rejects ${MAX_CHAIN_WEEKS + 1}`, () => {
    const atLimit = [block(52), block(52)];
    expect(
      replacePhasesSchema.safeParse({ startDate: "2026-08-03", phases: atLimit }).success
    ).toBe(true);

    const over = replacePhasesSchema.safeParse({
      startDate: "2026-08-03",
      phases: [block(35), block(35), block(35)],
    });
    expect(over.success).toBe(false);
    expect(messages(over)).toContain(
      `Blocks total 105 weeks; the maximum is ${MAX_CHAIN_WEEKS}`
    );
  });

  // Each block is individually legal here, so only the chain-level rule can
  // catch it — deleting the superRefine leaves every per-block bound passing.
  it("catches a chain that is too long even though every block is legal", () => {
    const phases = Array.from({ length: 3 }, () => block(40));
    expect(phases.every((p) => p.weeks <= MAX_PHASE_WEEKS)).toBe(true);
    expect(
      replacePhasesSchema.safeParse({ startDate: "2026-08-03", phases }).success
    ).toBe(false);
  });
});

describe("MAX_PHASES — a fat-fingered chain guard", () => {
  it(`accepts ${MAX_PHASES} blocks and rejects ${MAX_PHASES + 1}`, () => {
    const at = Array.from({ length: MAX_PHASES }, () => block(1));
    expect(
      replacePhasesSchema.safeParse({ startDate: "2026-08-03", phases: at }).success
    ).toBe(true);

    // 13 one-week blocks: well under MAX_CHAIN_WEEKS, so only the count rule
    // can reject this.
    const over = replacePhasesSchema.safeParse({
      startDate: "2026-08-03",
      phases: Array.from({ length: MAX_PHASES + 1 }, () => block(1)),
    });
    expect(over.success).toBe(false);
    expect(messages(over)).toContain(
      `A plan cannot have more than ${MAX_PHASES} blocks`
    );
  });
});

describe("the duplicate-id refinement", () => {
  // A repeated id would make the service's upsert write one row twice under the
  // same primary key, so the chain silently loses a block while the coach is
  // told it saved.
  it("rejects the same block appearing twice", () => {
    const result = replacePhasesSchema.safeParse({
      startDate: "2026-08-03",
      phases: [block(4, { id: uuid(1) }), block(6, { id: uuid(1) })],
    });
    expect(result.success).toBe(false);
    expect(messages(result)).toContain("The same block appears more than once");
  });

  it("allows any number of NEW blocks, which carry no id", () => {
    const result = replacePhasesSchema.safeParse({
      startDate: "2026-08-03",
      phases: [block(4), block(6), block(2)],
    });
    expect(result.success).toBe(true);
  });

  it("allows distinct ids", () => {
    const result = replacePhasesSchema.safeParse({
      startDate: "2026-08-03",
      phases: [block(4, { id: uuid(1) }), block(6, { id: uuid(2) })],
    });
    expect(result.success).toBe(true);
  });
});

describe("the rate sanity bound", () => {
  // NOT the gender safety cap — invariant 12 requires storing the rate the coach
  // entered and surfacing the cap in the preview, so this only catches nonsense.
  it("rejects a rate outside ±5 kg/week and non-finite values", () => {
    for (const rate of [MAX_ABS_RATE_KG_PER_WEEK + 0.1, -MAX_ABS_RATE_KG_PER_WEEK - 0.1, NaN, Infinity]) {
      expect(
        replacePhasesSchema.safeParse({
          startDate: "2026-08-03",
          phases: [block(4, { ratePerWeekKg: rate })],
        }).success
      ).toBe(false);
    }
  });
});

describe("shape guards", () => {
  it("rejects a malformed start date", () => {
    expect(
      replacePhasesSchema.safeParse({ startDate: "03/08/2026", phases: [] }).success
    ).toBe(false);
  });

  it("rejects an empty or over-long block name", () => {
    expect(
      replacePhasesSchema.safeParse({
        startDate: "2026-08-03",
        phases: [block(4, { name: "   " })],
      }).success
    ).toBe(false);
    expect(
      replacePhasesSchema.safeParse({
        startDate: "2026-08-03",
        phases: [block(4, { name: "x".repeat(61) })],
      }).success
    ).toBe(false);
  });

  it("deletePhaseSchema takes a uuid and nothing else", () => {
    expect(deletePhaseSchema.safeParse({ phaseId: uuid(1) }).success).toBe(true);
    expect(deletePhaseSchema.safeParse({ phaseId: "not-a-uuid" }).success).toBe(false);
    expect(
      deletePhaseSchema.safeParse({ phaseId: uuid(1), startDate: "2026-08-03" }).success
    ).toBe(false);
  });
});
