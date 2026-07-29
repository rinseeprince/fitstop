import { describe, it, expect } from "vitest";
import { computePhasesFingerprint } from "./phase-fingerprint";

const chain = [
  { startsOn: "2026-08-03", endsOn: "2026-09-27", ratePerWeekKg: -0.6 },
  { startsOn: "2026-09-28", endsOn: "2026-10-11", ratePerWeekKg: 0 },
];

describe("computePhasesFingerprint", () => {
  it("returns null for no blocks — NOT the hash of an empty list", () => {
    // Load-bearing: NULL is the stored value meaning "no block set drove this
    // generation", and it must also cover every pre-migration-138 plan. A
    // sentinel hash here would make every existing client read as stale the day
    // the coach UI ships.
    expect(computePhasesFingerprint([])).toBeNull();
  });

  it("is stable across calls", () => {
    expect(computePhasesFingerprint(chain)).toBe(computePhasesFingerprint(chain));
  });

  it("changes when a rate changes", () => {
    const edited = [{ ...chain[0], ratePerWeekKg: -0.4 }, chain[1]];
    expect(computePhasesFingerprint(edited)).not.toBe(computePhasesFingerprint(chain));
  });

  it("changes when a date changes", () => {
    const edited = [{ ...chain[0], endsOn: "2026-09-20" }, chain[1]];
    expect(computePhasesFingerprint(edited)).not.toBe(computePhasesFingerprint(chain));
  });

  it("changes when a block is added or removed", () => {
    expect(computePhasesFingerprint([chain[0]])).not.toBe(
      computePhasesFingerprint(chain)
    );
  });

  it("does NOT change when a block is renamed", () => {
    // The whole reason `name` is not an input: a rename changes nothing numeric,
    // so it must not raise "Nutrition is out of date".
    const renamed = chain.map((p) => ({ ...p, name: "Something else" }));
    expect(computePhasesFingerprint(renamed)).toBe(computePhasesFingerprint(chain));
  });

  it("is independent of the order the blocks arrive in", () => {
    expect(computePhasesFingerprint([...chain].reverse())).toBe(
      computePhasesFingerprint(chain)
    );
  });

  it("normalizes a numeric rate that arrives as a string", () => {
    // PostgREST returns NUMERIC as a JS number today, but the Number() coercion
    // is what stops a driver change from silently invalidating every stored hash.
    const asStrings = chain.map((p) => ({
      ...p,
      ratePerWeekKg: String(p.ratePerWeekKg) as unknown as number,
    }));
    expect(computePhasesFingerprint(asStrings)).toBe(computePhasesFingerprint(chain));
  });

  it("emits a url-safe digest", () => {
    expect(computePhasesFingerprint(chain)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
