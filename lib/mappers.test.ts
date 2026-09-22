import { describe, it, expect, vi, afterEach } from "vitest";

import { mapCheckInRow, mapClientRow, mapCoachRow, toClientSelfView } from "./mappers";
import type { ClientRow, CoachRow } from "./database-helpers";
import type { GoalOnDay } from "@/types/client-goals";

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

describe("mapClientRow — the four reading fields come from the embedded views", () => {
  const base = {
    id: "c1",
    coach_id: "co1",
    name: "A",
    email: "a@x.test",
    timezone: "UTC",
  } as unknown as Parameters<typeof mapClientRow>[0];

  it("reads now from client_current_measurements and the start from client_baseline_measurements", () => {
    const client = mapClientRow({
      ...base,
      client_current_measurements: [
        { metric_key: "weight", value: 76.1, recorded_on: "2026-08-29", source: "coach_entry", measurement_id: "m1" },
        { metric_key: "bodyFat", value: 15.2, recorded_on: "2026-08-29", source: "coach_entry", measurement_id: "m2" },
        { metric_key: "waist", value: 80.3, recorded_on: "2026-08-29", source: "coach_entry", measurement_id: "m3" },
      ],
      client_baseline_measurements: [
        { metric_key: "weight", value: 88.4, recorded_on: "2026-04-01", source: "intake", measurement_id: "b1" },
      ],
    });
    expect(client.currentWeight).toBe(76.1);
    expect(client.currentBodyFatPercentage).toBe(15.2);
    expect(client.startingWeight).toBe(88.4);
    expect(client.startingBodyFatPercentage).toBeUndefined();
  });

  it("maps the fields undefined when the row was read without the embeds", () => {
    const client = mapClientRow(base);
    expect(client.currentWeight).toBeUndefined();
    expect(client.startingWeight).toBeUndefined();
  });
});

// GET /api/client/me and PATCH /api/client/settings are the React Native app's
// contract, additive-only: every key keeps its name, its unit and its PLACE in
// the JSON. The goal is not on the profile row — its two targets come from the
// goal in force on the client's today — and they print where they always have,
// after `dateOfBirth`.
describe("toClientSelfView — the client's own profile", () => {
  /** A row carrying every column, the coach-only ones included. */
  const fullRow = clientRow({
    avatar_url: "https://cdn.example.com/a.png",
    notes: "Coach-only notes",
    active: true,
    created_at: "2026-03-02T09:00:00+00:00",
    updated_at: "2026-09-01T09:00:00+00:00",
    height: 181.5,
    gender: "female",
    date_of_birth: "1991-06-14",
    phone: "+44 7700 900123",
    bmr: 1733,
    tdee: 2481,
    work_activity_level: "lightly_active",
    check_in_frequency: "weekly",
    check_in_frequency_days: 7,
    next_check_in_due: "2026-09-25",
    last_reminder_sent_at: "2026-09-18T08:00:00+00:00",
    reminder_preferences: { email: true },
    total_check_ins_expected: 23,
    total_check_ins_completed: 21,
    check_in_adherence_rate: 91.3,
    current_streak: 6,
    longest_streak: 12,
    unit_preference: "metric",
    include_activity_burn: true,
    surplus_as_carbs: false,
    bmr_manual_override: false,
    tdee_manual_override: false,
    welcome_message: "Welcome aboard",
    onboarding_status: "active",
    walkthrough_completed_at: "2026-03-03T10:00:00+00:00",
    start_date: "2026-03-02",
    timezone: "Europe/London",
  } as Partial<ClientRow>);
  const client = {
    ...mapClientRow({
      ...fullRow,
      client_current_measurements: [
        { metric_key: "weight", value: 79.9, recorded_on: "2026-09-20", source: "check_in", measurement_id: "m-now" },
        { metric_key: "bodyFat", value: 21.4, recorded_on: "2026-09-20", source: "check_in", measurement_id: "m-bf" },
      ],
      client_baseline_measurements: [
        { metric_key: "weight", value: 85.7, recorded_on: "2026-03-02", source: "intake", measurement_id: "m-base" },
        { metric_key: "bodyFat", value: 24.6, recorded_on: "2026-03-02", source: "intake", measurement_id: "m-base-bf" },
      ],
    }),
    logsOpenFrom: "2026-09-12",
  };
  const goal = (overrides: Partial<GoalOnDay> = {}): GoalOnDay => ({
    id: "goal-now",
    clientId: "client-1",
    name: "Lose weight",
    type: "lose_weight",
    targetWeight: null,
    targetBodyFatPercentage: null,
    description: null,
    startsOn: "2026-08-03",
    source: "coach",
    setBy: "coach-1",
    createdAt: "2026-08-03T09:00:00+00:00",
    updatedAt: "2026-08-03T09:00:00+00:00",
    deadline: "2026-12-11",
    ...overrides,
  });

  it("carries the targets of the goal in force, in their places, and nothing coach-only", () => {
    const view = toClientSelfView(client, goal({ targetWeight: 73.4, targetBodyFatPercentage: 17.5 }));

    expect(Object.keys(view)).toEqual([
      "id", "coachId", "name", "email", "avatarUrl", "active", "createdAt", "updatedAt",
      "height", "gender", "dateOfBirth", "goalWeight", "goalBodyFatPercentage",
      "currentWeight", "currentBodyFatPercentage", "bmr", "tdee",
      "checkInFrequency", "checkInFrequencyDays", "nextCheckInDue", "lastReminderSentAt",
      "reminderPreferences", "totalCheckInsExpected", "totalCheckInsCompleted",
      "checkInAdherenceRate", "currentStreak", "longestStreak", "unitPreference",
      "includeActivityBurn", "surplusAsCarbs", "startingWeight", "startingBodyFatPercentage",
      "bmrManualOverride", "tdeeManualOverride", "welcomeMessage", "onboardingStatus",
      "walkthroughCompletedAt", "startDate", "timezone", "logsOpenFrom",
    ]);
    // Kilograms and percent, as numbers.
    expect(view.goalWeight).toBe(73.4);
    expect(view.goalBodyFatPercentage).toBe(17.5);
    // The deadline is not a profile field; the journey carries it.
    expect(view).not.toHaveProperty("deadline");
  });

  it("omits a target the goal does not set, and both with no goal in force", () => {
    const bodyFatOnly = toClientSelfView(
      client,
      goal({ type: "recomposition", targetBodyFatPercentage: 16.5 })
    );
    expect(bodyFatOnly).not.toHaveProperty("goalWeight");
    expect(bodyFatOnly.goalBodyFatPercentage).toBe(16.5);

    const none = toClientSelfView(client, null);
    expect(none).not.toHaveProperty("goalWeight");
    expect(none).not.toHaveProperty("goalBodyFatPercentage");
    expect(Object.keys(none).slice(10, 12)).toEqual(["dateOfBirth", "currentWeight"]);
  });
});

describe("mapCheckInRow — readings are folded in, and the keys keep their place", () => {
  const row = {
    id: "ci1",
    client_id: "c1",
    status: "pending",
    created_at: "2026-05-04T08:00:00+00:00",
    updated_at: "2026-05-04T08:00:00+00:00",
  } as unknown as Parameters<typeof mapCheckInRow>[0];

  it("takes the seven readings from the fold, never from the row", () => {
    const withColumns = { ...row, weight: 99.9, waist: 99.8 } as typeof row;
    const checkIn = mapCheckInRow(withColumns, { weight: 79.5, bodyFat: 19.6, waist: 80.2 });
    expect(checkIn.weight).toBe(79.5);
    expect(checkIn.bodyFatPercentage).toBe(19.6);
    expect(checkIn.waist).toBe(80.2);
    expect(checkIn.hips).toBeUndefined();
  });

  it("emits the reading keys at the same position whether or not a reading exists — the wire's byte order", () => {
    const bare = Object.keys(mapCheckInRow(row));
    const folded = Object.keys(mapCheckInRow(row, { weight: 79.5, thighs: 61 }));
    expect(folded).toEqual(bare);
    expect(bare.indexOf("weight")).toBe(bare.indexOf("notes") + 1);
    expect(bare.indexOf("thighs")).toBe(bare.indexOf("photoFront") - 1);
  });
});
