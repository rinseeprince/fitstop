# Client portal — perf baseline

**Captured:** 2026-05-28 · **Git SHA:** 9fc27f5 · **Target:** aeaphsslctwcmebldrzx.supabase.co
**Node:** v24.2.0 · Moving snapshot — re-run after each scale session (3.6+) to refresh.

## Fixture

Client: `5ca1ec1e-0000-4000-8000-000000000001`

| Table | Rows |
|---|---|
| session_logs | 203 |
| exercise_logs | 1218 |
| set_logs | 4881 |
| daily_logs | 360 |
| check_ins | 51 |
| daily_habit_logs | 1800 |
| body_metrics | 12 |

Reproduce: `npx tsx scripts/seed-scale-client.ts` then `npx tsx scripts/perf-baseline.ts`.

Cold = first call after a Supabase connection-warmup query (so cold reflects query/page-cache cold, not TCP/TLS handshake). p50 / p95 use the 5 warm runs only (p95 = max-of-5).

## getClientExerciseList

**File:** `services/exercise-analytics-service.ts:160` · **Call:** `getClientExerciseList(PERF_CLIENT_ID)`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 41.8 | 6 | 869 |
| warm-1 | 38.4 | 6 | 869 |
| warm-2 | 40.7 | 6 | 869 |
| warm-3 | 38.8 | 6 | 869 |
| warm-4 | 50.9 | 6 | 869 |
| warm-5 | 37.0 | 6 | 869 |

**Warm p50:** 38.8 ms · **Warm p95 (max of 5):** 50.9 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | rpc:get_client_exercise_list | 6 | 893 | 36.9 |

## getExerciseProgressionSeries (sessionCount=12)

**File:** `services/exercise-analytics-service.ts:213` · **Call:** `getExerciseProgressionSeries(PERF_CLIENT_ID, { exerciseId, sessionCount: 12 })`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 43.7 | 48 | 3193 |
| warm-1 | 41.1 | 48 | 3193 |
| warm-2 | 39.7 | 48 | 3193 |
| warm-3 | 40.0 | 48 | 3193 |
| warm-4 | 40.7 | 48 | 3193 |
| warm-5 | 65.0 | 48 | 3193 |

**Warm p50:** 40.7 ms · **Warm p95 (max of 5):** 65.0 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | rpc:get_exercise_progression_window | 48 | 18227 | 64.7 |

## getExerciseProgressionSeries (sessionCount=500)

**File:** `services/exercise-analytics-service.ts:213` · **Call:** `getExerciseProgressionSeries(PERF_CLIENT_ID, { exerciseId, sessionCount: 500 })`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 90.5 | 818 | 53721 |
| warm-1 | 62.2 | 818 | 53721 |
| warm-2 | 61.4 | 818 | 53721 |
| warm-3 | 53.8 | 818 | 53721 |
| warm-4 | 50.1 | 818 | 53721 |
| warm-5 | 50.7 | 818 | 53721 |

**Warm p50:** 53.8 ms · **Warm p95 (max of 5):** 62.2 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | rpc:get_exercise_progression_window | 818 | 310223 | 49.8 |

## getExercisePRs

**File:** `services/exercise-analytics-service.ts:329` · **Call:** `getExercisePRs(PERF_CLIENT_ID, { exerciseId })`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 38.2 | 5 | 388 |
| warm-1 | 37.4 | 5 | 388 |
| warm-2 | 35.3 | 5 | 388 |
| warm-3 | 37.0 | 5 | 388 |
| warm-4 | 35.3 | 5 | 388 |
| warm-5 | 39.4 | 5 | 388 |

**Warm p50:** 37.0 ms · **Warm p95 (max of 5):** 39.4 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | rpc:get_exercise_prs | 5 | 305 | 39.4 |

## getClientProgressData (admin-equivalent SQL)

**File:** `services/client-portal-progress.ts:51` · **Call:** `getClientProgressData(PERF_CLIENT_ID, 90)`

*Measured via direct supabaseAdmin queries that match the production read path (check_ins + clients). The function itself uses createPortalClient() (cookie-bound, Next.js-request-only) and can't run from a script — see Followups.*

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 74.1 | 13 | 38 |
| warm-1 | 67.6 | 13 | 38 |
| warm-2 | 69.9 | 13 | 38 |
| warm-3 | 68.9 | 13 | 38 |
| warm-4 | 69.8 | 13 | 38 |
| warm-5 | 69.7 | 13 | 38 |

**Warm p50:** 69.7 ms · **Warm p95 (max of 5):** 69.9 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | check_ins | 12 | 2171 | 35.2 |
| 2 | clients | 1 | 257 | 34.3 |

## calculateStreaks

**File:** `services/daily-logs-service.ts:285` · **Call:** `calculateStreaks(PERF_CLIENT_ID)`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 52.0 | 360 | 41 |
| warm-1 | 49.5 | 360 | 41 |
| warm-2 | 47.5 | 360 | 41 |
| warm-3 | 48.6 | 360 | 41 |
| warm-4 | 53.4 | 360 | 41 |
| warm-5 | 48.7 | 360 | 41 |

**Warm p50:** 48.7 ms · **Warm p95 (max of 5):** 53.4 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | daily_logs_full | 360 | 200069 | 45.5 |

## getHabitLogs

**File:** `services/daily-habits-service.ts:273` · **Call:** `getHabitLogs(PERF_CLIENT_ID, today-90d, today)`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 52.7 | 455 | 195520 |
| warm-1 | 44.7 | 455 | 195520 |
| warm-2 | 47.4 | 455 | 195520 |
| warm-3 | 47.9 | 455 | 195520 |
| warm-4 | 52.7 | 455 | 195520 |
| warm-5 | 52.9 | 455 | 195520 |

**Warm p50:** 47.9 ms · **Warm p95 (max of 5):** 52.9 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | daily_habit_logs | 455 | 227825 | 52.2 |


## Followups (out of 3.5 scope)

- **`createPortalClient()` consolidation candidate (CONVENTIONS §8).** `services/client-portal-progress.ts` uses a session-scoped Supabase client when most service functions default to `supabaseAdmin` with explicit scoping. Phase 9 tech-debt sweep should reconcile — services should default to `supabaseAdmin`; session-scoped is the rare case.
- **`getClientProgressData` reads legacy denormalized columns on `clients` (`goal_weight`, `starting_weight`, `current_weight`) rather than the `client_goals` / `body_metrics` tables ARCHITECTURE.md describes as the preferred post-migration source.** Consolidation candidate alongside the `createPortalClient()` one.
- **`check_ins.client_id` is TEXT, not UUID.** Migration 023 artifact; everywhere else UUID. Worth a typed-FK migration eventually.
- **`daily_logs_full` is a view.** `calculateStreaks` reads it directly. Captured wall-time includes view overhead; Session 3.7 should consider materialization or denormalization.
- **3.6 resolved:** `getClientExerciseList` / `getExerciseProgressionSeries` / `getExercisePRs` now go through SQL aggregation RPCs (migration 094) — reads are result-bounded, not history-bounded. The prior `PostgREST 1000-row cap` followup is gone with the multi-call fetch pattern.
