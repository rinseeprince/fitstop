# Client portal — perf baseline

**Captured:** 2026-05-28 · **Git SHA:** 9f310a6 · **Target:** aeaphsslctwcmebldrzx.supabase.co
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
| cold | 50.1 | 6 | 869 |
| warm-1 | 36.8 | 6 | 869 |
| warm-2 | 36.9 | 6 | 869 |
| warm-3 | 37.4 | 6 | 869 |
| warm-4 | 39.0 | 6 | 869 |
| warm-5 | 44.9 | 6 | 869 |

**Warm p50:** 37.4 ms · **Warm p95 (max of 5):** 44.9 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | rpc:get_client_exercise_list | 6 | 893 | 44.8 |

## getExerciseProgressionSeries (sessionCount=12)

**File:** `services/exercise-analytics-service.ts:213` · **Call:** `getExerciseProgressionSeries(PERF_CLIENT_ID, { exerciseId, sessionCount: 12 })`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 48.2 | 48 | 3193 |
| warm-1 | 39.6 | 48 | 3193 |
| warm-2 | 38.4 | 48 | 3193 |
| warm-3 | 39.3 | 48 | 3193 |
| warm-4 | 38.7 | 48 | 3193 |
| warm-5 | 37.7 | 48 | 3193 |

**Warm p50:** 38.7 ms · **Warm p95 (max of 5):** 39.6 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | rpc:get_exercise_progression_window | 48 | 18227 | 37.5 |

## getExerciseProgressionSeries (sessionCount=500)

**File:** `services/exercise-analytics-service.ts:213` · **Call:** `getExerciseProgressionSeries(PERF_CLIENT_ID, { exerciseId, sessionCount: 500 })`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 92.1 | 818 | 53721 |
| warm-1 | 59.0 | 818 | 53721 |
| warm-2 | 52.5 | 818 | 53721 |
| warm-3 | 51.0 | 818 | 53721 |
| warm-4 | 54.9 | 818 | 53721 |
| warm-5 | 52.8 | 818 | 53721 |

**Warm p50:** 52.8 ms · **Warm p95 (max of 5):** 59.0 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | rpc:get_exercise_progression_window | 818 | 310223 | 51.4 |

## getExercisePRs

**File:** `services/exercise-analytics-service.ts:329` · **Call:** `getExercisePRs(PERF_CLIENT_ID, { exerciseId })`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 37.0 | 5 | 388 |
| warm-1 | 41.2 | 5 | 388 |
| warm-2 | 37.5 | 5 | 388 |
| warm-3 | 38.4 | 5 | 388 |
| warm-4 | 37.1 | 5 | 388 |
| warm-5 | 43.0 | 5 | 388 |

**Warm p50:** 38.4 ms · **Warm p95 (max of 5):** 43.0 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | rpc:get_exercise_prs | 5 | 305 | 42.9 |

## getClientProgressData (admin-equivalent SQL)

**File:** `services/client-portal-progress.ts:51` · **Call:** `getClientProgressData(PERF_CLIENT_ID, 90)`

*Measured via direct supabaseAdmin queries that match the production read path (check_ins + clients). The function itself uses createPortalClient() (cookie-bound, Next.js-request-only) and can't run from a script — see Followups.*

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 78.5 | 13 | 38 |
| warm-1 | 72.2 | 13 | 38 |
| warm-2 | 66.9 | 13 | 38 |
| warm-3 | 66.3 | 13 | 38 |
| warm-4 | 68.2 | 13 | 38 |
| warm-5 | 66.4 | 13 | 38 |

**Warm p50:** 66.9 ms · **Warm p95 (max of 5):** 72.2 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | check_ins | 12 | 2171 | 33.7 |
| 2 | clients | 1 | 257 | 32.5 |

## calculateStreaks

**File:** `services/daily-logs-service.ts:285` · **Call:** `calculateStreaks(PERF_CLIENT_ID)`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 37.4 | 1 | 41 |
| warm-1 | 32.8 | 1 | 41 |
| warm-2 | 33.6 | 1 | 41 |
| warm-3 | 34.6 | 1 | 41 |
| warm-4 | 32.6 | 1 | 41 |
| warm-5 | 33.0 | 1 | 41 |

**Warm p50:** 33.0 ms · **Warm p95 (max of 5):** 34.6 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | rpc:get_client_streak | 1 | 45 | 32.9 |

## getHabitLogs

**File:** `services/daily-habits-service.ts:273` · **Call:** `getHabitLogs(PERF_CLIENT_ID, today-90d, today)`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 50.5 | 455 | 195520 |
| warm-1 | 48.2 | 455 | 195520 |
| warm-2 | 46.2 | 455 | 195520 |
| warm-3 | 46.0 | 455 | 195520 |
| warm-4 | 77.9 | 455 | 195520 |
| warm-5 | 47.8 | 455 | 195520 |

**Warm p50:** 47.8 ms · **Warm p95 (max of 5):** 77.9 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | daily_habit_logs | 455 | 227825 | 47.3 |


## Followups (out of 3.5 scope)

- **`createPortalClient()` consolidation candidate (CONVENTIONS §8).** `services/client-portal-progress.ts` uses a session-scoped Supabase client when most service functions default to `supabaseAdmin` with explicit scoping. Phase 9 tech-debt sweep should reconcile — services should default to `supabaseAdmin`; session-scoped is the rare case.
- **`getClientProgressData` reads legacy denormalized columns on `clients` (`goal_weight`, `starting_weight`, `current_weight`) rather than the `client_goals` / `body_metrics` tables ARCHITECTURE.md describes as the preferred post-migration source.** Consolidation candidate alongside the `createPortalClient()` one.
- **`check_ins.client_id` is TEXT, not UUID.** Migration 023 artifact; everywhere else UUID. Worth a typed-FK migration eventually.
- **3.6 resolved:** `getClientExerciseList` / `getExerciseProgressionSeries` / `getExercisePRs` now go through SQL aggregation RPCs (migration 094) — reads are result-bounded, not history-bounded. The prior `PostgREST 1000-row cap` followup is gone with the multi-call fetch pattern.
- **3.7 resolved:** `calculateStreaks` no longer reads the `daily_logs_full` view + runs an O(D²) Node loop; it now calls the `get_client_streak` gaps-and-islands RPC (migration 095) over the `daily_logs` spine via the `(client_id, date DESC)` index, returning two integers (result-bounded, not history-bounded).
