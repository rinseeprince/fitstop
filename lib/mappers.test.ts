import { describe, it, expect, vi, afterEach } from "vitest";

import {
  mapCheckInRow,
  mapClientRow,
  mapCoachRow,
  toClientFacingCheckIn,
  toClientSelfView,
  withoutSentSnapshot,
} from "./mappers";
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

  const surplus = { includeActivityBurn: false, surplusAsCarbs: true };

  it("carries the targets of the goal in force, in their places, and nothing coach-only", () => {
    const view = toClientSelfView(
      client,
      goal({ targetWeight: 73.4, targetBodyFatPercentage: 17.5 }),
      surplus
    );

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
      goal({ type: "recomposition", targetBodyFatPercentage: 16.5 }),
      surplus
    );
    expect(bodyFatOnly).not.toHaveProperty("goalWeight");
    expect(bodyFatOnly.goalBodyFatPercentage).toBe(16.5);

    const none = toClientSelfView(client, null, surplus);
    expect(none).not.toHaveProperty("goalWeight");
    expect(none).not.toHaveProperty("goalBodyFatPercentage");
    expect(Object.keys(none).slice(10, 12)).toEqual(["dateOfBirth", "currentWeight"]);
  });

  it("carries the two surplus settings it is given — the plan's, for the client's today — right after unitPreference", () => {
    const off = toClientSelfView(client, null, { includeActivityBurn: false, surplusAsCarbs: true });
    const on = toClientSelfView(client, null, { includeActivityBurn: true, surplusAsCarbs: false });

    expect([off.includeActivityBurn, off.surplusAsCarbs]).toEqual([false, true]);
    expect([on.includeActivityBurn, on.surplusAsCarbs]).toEqual([true, false]);
    const keys = Object.keys(off);
    const at = keys.indexOf("unitPreference");
    expect(keys.slice(at, at + 3)).toEqual(["unitPreference", "includeActivityBurn", "surplusAsCarbs"]);
  });
});

describe("mapCheckInRow — a sent check-in reports its saved copy, and the keys keep their place", () => {
  const row = {
    id: "ci1",
    client_id: "c1",
    status: "pending",
    created_at: "2026-05-04T08:00:00+00:00",
    updated_at: "2026-05-04T08:00:00+00:00",
  } as unknown as Parameters<typeof mapCheckInRow>[0];

  /** A copy that passes the declared shape: what the check-in reported when sent. */
  function sentCopy(readings: Partial<Record<"weight" | "bodyFat" | "waist" | "hips" | "chest" | "arms" | "thighs", number>>) {
    return {
      version: 1,
      day: "2026-05-04",
      readings: {
        weight: null,
        bodyFat: null,
        waist: null,
        hips: null,
        chest: null,
        arms: null,
        thighs: null,
        ...readings,
      },
      standing: { weight: readings.weight ?? null, bodyFat: readings.bodyFat ?? null },
      goal: null,
      goalProgress: {},
      nutritionPlan: null,
      period: null,
      questions: [],
    };
  }

  const withCopy = (copy: unknown) => ({ ...row, sent_snapshot: copy }) as typeof row;

  it("takes the seven readings from the check-in's saved copy, never from a column on the row", () => {
    const withColumns = {
      ...withCopy(sentCopy({ weight: 79.5, bodyFat: 19.6, waist: 80.2 })),
      weight: 99.9,
      waist: 99.8,
    } as typeof row;
    const checkIn = mapCheckInRow(withColumns);
    expect(checkIn.weight).toBe(79.5);
    expect(checkIn.bodyFatPercentage).toBe(19.6);
    expect(checkIn.waist).toBe(80.2);
    expect(checkIn.hips).toBeUndefined();
  });

  it("reads only the copy — a reading corrected in the client's log since has no way in", () => {
    // The mapper takes the row alone: whatever the log's stamped row now says
    // (a coach's correction edits it in place), the check-in reports what it
    // saved when it was sent.
    expect(mapCheckInRow.length).toBe(1);
    const checkIn = mapCheckInRow(withCopy(sentCopy({ weight: 82.7 })));
    expect(checkIn.weight).toBe(82.7);
  });

  it("carries the validated copy last, for the server's readers", () => {
    const checkIn = mapCheckInRow(withCopy(sentCopy({ weight: 78.1 })));
    const keys = Object.keys(checkIn);
    expect(keys[keys.length - 1]).toBe("sentSnapshot");
    expect(checkIn.sentSnapshot?.readings.weight).toBe(78.1);
    expect(checkIn.sentSnapshot?.version).toBe(1);
  });

  it("maps a row the fill has not reached with no readings and a null copy", () => {
    const checkIn = mapCheckInRow(row);
    expect(checkIn.weight).toBeUndefined();
    expect(checkIn.bodyFatPercentage).toBeUndefined();
    expect(checkIn.thighs).toBeUndefined();
    expect(checkIn.sentSnapshot).toBeNull();
  });

  it("throws on a copy that does not match its declared shape — corruption, never a state to render", () => {
    expect(() => mapCheckInRow(withCopy({ version: 2, readings: {} }))).toThrow(
      /saved copy does not match its shape/
    );
    expect(() =>
      mapCheckInRow(withCopy({ ...sentCopy({ weight: 77.3 }), readings: { weight: "77.3" } }))
    ).toThrow(/saved copy does not match its shape/);
  });

  it("emits the reading keys at the same position whether or not a reading exists — the wire's byte order", () => {
    const bare = Object.keys(mapCheckInRow(row));
    const reported = Object.keys(mapCheckInRow(withCopy(sentCopy({ weight: 79.4, thighs: 61.2 }))));
    expect(reported).toEqual(bare);
    expect(bare.indexOf("weight")).toBe(bare.indexOf("notes") + 1);
    expect(bare.indexOf("thighs")).toBe(bare.indexOf("photoFront") - 1);
    expect(bare[bare.length - 1]).toBe("sentSnapshot");
  });

  it("leaves the copy off both browser wires — the coach's check-in and the client's history list", () => {
    const checkIn = mapCheckInRow(withCopy(sentCopy({ weight: 80.9 })));

    const coachWire = withoutSentSnapshot(checkIn);
    expect(coachWire).not.toHaveProperty("sentSnapshot");
    expect(coachWire.weight).toBe(80.9);

    const clientWire = toClientFacingCheckIn(checkIn);
    expect(clientWire).not.toHaveProperty("sentSnapshot");
    expect(clientWire.weight).toBe(80.9);
  });
});
