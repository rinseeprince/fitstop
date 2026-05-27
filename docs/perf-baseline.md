# Client portal — perf baseline

**Captured:** 2026-05-27 · **Git SHA:** dca3a32 · **Target:** aeaphsslctwcmebldrzx.supabase.co
**Node:** v24.2.0 · **No optimization applied** — this is the "before" snapshot for Sessions 3.6–3.10.

## Fixture

Client: `5ca1ec1e-0000-4000-8000-000000000001`

| Table | Rows |
|---|---|
| session_logs | 202 |
| exercise_logs | 1212 |
| set_logs | 4852 |
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
| cold | 1043.6 | 1226 | 869 |
| warm-1 | 325.4 | 1226 | 869 |
| warm-2 | 245.3 | 1226 | 869 |
| warm-3 | 154.0 | 1226 | 869 |
| warm-4 | 145.2 | 1226 | 869 |
| warm-5 | 223.3 | 1226 | 869 |

**Warm p50:** 223.3 ms · **Warm p95 (max of 5):** 325.4 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | session_logs | 202 | 17979 | 36.9 |
| 2 | exercise_logs | 1000 | 391614 | 141.7 |
| 3 | training_exercises | 24 | 2377 | 42.8 |

## getExerciseProgressionSeries (sessionCount=12)

**File:** `services/exercise-analytics-service.ts:213` · **Call:** `getExerciseProgressionSeries(PERF_CLIENT_ID, { exerciseId, sessionCount: 12 })`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 224.4 | 1884 | 3201 |
| warm-1 | 296.2 | 1884 | 3201 |
| warm-2 | 214.9 | 1884 | 3201 |
| warm-3 | 266.9 | 1884 | 3201 |
| warm-4 | 196.2 | 1884 | 3201 |
| warm-5 | 190.2 | 1884 | 3201 |

**Warm p50:** 214.9 ms · **Warm p95 (max of 5):** 296.2 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | session_logs | 202 | 17979 | 35.9 |
| 2 | exercise_logs | 1000 | 391614 | 65.9 |
| 3 | training_exercises | 24 | 2377 | 37.0 |
| 4 | set_logs | 658 | 130293 | 47.7 |

## getExerciseProgressionSeries (sessionCount=500)

**File:** `services/exercise-analytics-service.ts:213` · **Call:** `getExerciseProgressionSeries(PERF_CLIENT_ID, { exerciseId, sessionCount: 500 })`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 226.0 | 1884 | 44361 |
| warm-1 | 196.2 | 1884 | 44361 |
| warm-2 | 239.6 | 1884 | 44361 |
| warm-3 | 179.8 | 1882 | 44382 |
| warm-4 | 196.6 | 1882 | 44382 |
| warm-5 | 232.1 | 1882 | 44382 |

**Warm p50:** 196.6 ms · **Warm p95 (max of 5):** 239.6 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | session_logs | 202 | 17979 | 35.9 |
| 2 | exercise_logs | 1000 | 391600 | 110.2 |
| 3 | training_exercises | 24 | 2377 | 34.8 |
| 4 | set_logs | 656 | 129823 | 48.8 |

## getExercisePRs

**File:** `services/exercise-analytics-service.ts:329` · **Call:** `getExercisePRs(PERF_CLIENT_ID, { exerciseId })`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 183.3 | 1882 | 383 |
| warm-1 | 255.0 | 1882 | 383 |
| warm-2 | 180.7 | 1882 | 383 |
| warm-3 | 176.6 | 1882 | 383 |
| warm-4 | 258.2 | 1882 | 383 |
| warm-5 | 187.6 | 1882 | 383 |

**Warm p50:** 187.6 ms · **Warm p95 (max of 5):** 258.2 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | session_logs | 202 | 17979 | 36.7 |
| 2 | exercise_logs | 1000 | 391600 | 56.9 |
| 3 | training_exercises | 24 | 2377 | 38.6 |
| 4 | set_logs | 656 | 129823 | 52.6 |

## getClientProgressData (admin-equivalent SQL)

**File:** `services/client-portal-progress.ts:51` · **Call:** `getClientProgressData(PERF_CLIENT_ID, 90)`

*Measured via direct supabaseAdmin queries that match the production read path (check_ins + clients). The function itself uses createPortalClient() (cookie-bound, Next.js-request-only) and can't run from a script — see Followups.*

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 79.0 | 13 | 38 |
| warm-1 | 166.9 | 13 | 38 |
| warm-2 | 78.1 | 13 | 38 |
| warm-3 | 69.8 | 13 | 38 |
| warm-4 | 69.1 | 13 | 38 |
| warm-5 | 69.8 | 13 | 38 |

**Warm p50:** 69.8 ms · **Warm p95 (max of 5):** 166.9 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | check_ins | 12 | 2171 | 33.0 |
| 2 | clients | 1 | 257 | 36.7 |

## calculateStreaks

**File:** `services/daily-logs-service.ts:285` · **Call:** `calculateStreaks(PERF_CLIENT_ID)`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 62.2 | 360 | 41 |
| warm-1 | 53.1 | 360 | 41 |
| warm-2 | 126.5 | 360 | 41 |
| warm-3 | 54.9 | 360 | 41 |
| warm-4 | 58.6 | 360 | 41 |
| warm-5 | 60.4 | 360 | 41 |

**Warm p50:** 58.6 ms · **Warm p95 (max of 5):** 126.5 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | daily_logs_full | 360 | 200069 | 57.0 |

## getHabitLogs

**File:** `services/daily-habits-service.ts:273` · **Call:** `getHabitLogs(PERF_CLIENT_ID, today-90d, today)`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 71.2 | 455 | 195514 |
| warm-1 | 52.0 | 455 | 195514 |
| warm-2 | 47.3 | 455 | 195514 |
| warm-3 | 45.6 | 455 | 195514 |
| warm-4 | 127.1 | 455 | 195514 |
| warm-5 | 46.8 | 455 | 195514 |

**Warm p50:** 47.3 ms · **Warm p95 (max of 5):** 127.1 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | daily_habit_logs | 455 | 227819 | 45.9 |


## Followups (out of 3.5 scope)

- **`createPortalClient()` consolidation candidate (CONVENTIONS §8).** `services/client-portal-progress.ts` uses a session-scoped Supabase client when most service functions default to `supabaseAdmin` with explicit scoping. Phase 9 tech-debt sweep should reconcile — services should default to `supabaseAdmin`; session-scoped is the rare case.
- **`getClientProgressData` reads legacy denormalized columns on `clients` (`goal_weight`, `starting_weight`, `current_weight`) rather than the `client_goals` / `body_metrics` tables ARCHITECTURE.md describes as the preferred post-migration source.** Consolidation candidate alongside the `createPortalClient()` one.
- **`check_ins.client_id` is TEXT, not UUID.** Migration 023 artifact; everywhere else UUID. Worth a typed-FK migration eventually.
- **PostgREST 1000-row default cap.** Year-scale `getClientExerciseList` fetches >1,000 exercise_logs in a single `.in(...)` query — may be silently truncated. The numbers above will expose if so.
- **`daily_logs_full` is a view.** `calculateStreaks` reads it directly. Captured wall-time includes view overhead; 3.6 should consider materialization or denormalization.
