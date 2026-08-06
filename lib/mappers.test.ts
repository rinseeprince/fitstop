import { describe, it, expect, vi, afterEach } from "vitest";

import { mapClientRow, mapCoachRow } from "./mappers";
import type { ClientRow, CoachRow } from "./database-helpers";

/**
 * Scoped to the unit-preference normalization, not the whole mapper.
 *
 * mapClientRow had no test file at all, and its `unit_preference` fallback was
 * changed from 'imperial' to metric in units-canonicalization Phase 4 — a
 * change the full suite passed identically before and after, which is the
 * "green suite proved nothing" failure Phase 3 recorded. This pins it.
 */

function clientRow(overrides: Partial<ClientRow> = {}): ClientRow {
  return {
    id: "client-1",
    coach_id: "coach-1",
    name: "Alex Doe",
    email: "alex@example.com",
    timezone: "UTC",
    unit_preference: null,
    ...overrides,
  } as ClientRow;
}

function coachRow(overrides: Partial<CoachRow> = {}): CoachRow {
  return {
    id: "coach-1",
    name: "Test Coach",
    email: "coach@example.com",
    timezone: "UTC",
    unit_preference: null,
    ...overrides,
  } as CoachRow;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mapClientRow — unitPreference", () => {
  // Migration 141 flipped clients.unit_preference to DEFAULT 'metric', and
  // readClientPreference (which serves the SAME client's preference to
  // /api/me/unit-preference) normalizes through toUnitSystem. A NULL that read
  // imperial here meant the settings form and the portal disagreed.
  it("normalizes a NULL column to metric, not imperial", () => {
    expect(mapClientRow(clientRow({ unit_preference: null })).unitPreference)
      .toBe("metric");
  });

  it("passes a stored preference through unchanged", () => {
    expect(
      mapClientRow(clientRow({ unit_preference: "imperial" })).unitPreference,
    ).toBe("imperial");
    expect(
      mapClientRow(clientRow({ unit_preference: "metric" })).unitPreference,
    ).toBe("metric");
  });

  it("warns and falls back to metric on a value the CHECK constraint should have blocked", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      mapClientRow(clientRow({ unit_preference: "stone" })).unitPreference,
    ).toBe("metric");
    expect(warn).toHaveBeenCalled();
  });

  // The two columns are NOT interchangeable at the type level: coaches.
  // unit_preference is NOT NULL (migration 140) while clients.unit_preference
  // is nullable (migration 011), so only the stored values can be compared —
  // the NULL case above is client-only by construction.
  it("agrees with mapCoachRow on every value both columns can hold", () => {
    for (const stored of ["metric", "imperial"] as const) {
      expect(mapClientRow(clientRow({ unit_preference: stored })).unitPreference)
        .toBe(mapCoachRow(coachRow({ unit_preference: stored })).unitPreference);
    }
  });
});
