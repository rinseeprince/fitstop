/**
 * Shared fixture identities for the year-scale perf seed + baseline harness.
 *
 * Hardcoded UUIDs with a "5ca1e" prefix so they stand out in any DB inspection.
 * The seed script (delete-then-insert) and the harness both import from here.
 */

export const PERF_COACH_ID = "5ca1ec0a-0000-4000-8000-000000000001";
export const PERF_CLIENT_ID = "5ca1ec1e-0000-4000-8000-000000000001";
export const PERF_PLAN_ID = "5ca1ec1e-0000-4000-8001-000000000001";
export const PERF_NUTRITION_PLAN_ID = "5ca1ec1e-0000-4000-8003-000000000001";
export const PERF_CLIENT_GOAL_ID = "5ca1ec1e-0000-4000-8004-000000000001";

export const PERF_HABIT_IDS = [
  "5ca1ec1e-0000-4000-8002-000000000001",
  "5ca1ec1e-0000-4000-8002-000000000002",
  "5ca1ec1e-0000-4000-8002-000000000003",
  "5ca1ec1e-0000-4000-8002-000000000004",
  "5ca1ec1e-0000-4000-8002-000000000005",
] as const;

export const PERF_COACH_EMAIL = "perf-coach@fixture.local";
export const PERF_COACH_NAME = "Perf Fixture Coach";
export const PERF_CLIENT_EMAIL = "perf-client@fixture.local";
export const PERF_CLIENT_NAME = "Perf Fixture Client";
export const PERF_CLIENT_PASSWORD = "12345678";
