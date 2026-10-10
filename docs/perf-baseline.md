# Client portal — perf baseline

**Captured:** 2026-10-10 · **Git SHA:** 7145a9a4 · **Target:** aeaphsslctwcmebldrzx.supabase.co
**Node:** v26.3.0 · Moving snapshot — re-run after each scale session (3.6+) to refresh.

## Fixture

Client: `5ca1ec1e-0000-4000-8000-000000000001`

| Table | Rows |
|---|---|
| session_logs | 206 |
| exercise_logs | 1236 |
| set_logs | 4952 |
| wellness_logs | 359 |
| nutrition_logs | 359 |
| check_ins | 51 |
| client_habit_logs | 1800 |
| client_measurements | 1426 |

Reproduce: `npx tsx scripts/seed-scale-client.ts` then `npx tsx scripts/perf-baseline.ts`.

Cold = first call after a Supabase connection-warmup query (so cold reflects query/page-cache cold, not TCP/TLS handshake). p50 / p95 use the 5 warm runs only (p95 = max-of-5).

## getClientExerciseList

**File:** `services/exercise-analytics-service.ts:160` · **Call:** `getClientExerciseList(PERF_CLIENT_ID)`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 365.5 | 6 | 1025 |
| warm-1 | 370.0 | 6 | 1025 |
| warm-2 | 432.5 | 6 | 1025 |
| warm-3 | 303.9 | 6 | 1025 |
| warm-4 | 568.6 | 6 | 1025 |
| warm-5 | 282.3 | 6 | 1025 |

**Warm p50:** 370.0 ms · **Warm p95 (max of 5):** 568.6 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | rpc:get_client_exercise_list | 6 | 1055 | 282.2 |

## getExerciseProgressionSeries (sessionCount=12)

**File:** `services/exercise-analytics-service.ts:213` · **Call:** `getExerciseProgressionSeries(PERF_CLIENT_ID, { exerciseId, sessionCount: 12 })`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 623.8 | 58 | 10298 |
| warm-1 | 650.6 | 58 | 10298 |
| warm-2 | 549.0 | 58 | 10298 |
| warm-3 | 1553.6 | 58 | 10298 |
| warm-4 | 565.1 | 58 | 10298 |
| warm-5 | 610.3 | 58 | 10298 |

**Warm p50:** 610.3 ms · **Warm p95 (max of 5):** 1553.6 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | rpc:get_exercise_progression_window | 46 | 31131 | 281.6 |
| 2 | session_logs | 12 | 853 | 327.2 |

## getExerciseProgressionSeries (sessionCount=500)

**File:** `services/exercise-analytics-service.ts:213` · **Call:** `getExerciseProgressionSeries(PERF_CLIENT_ID, { exerciseId, sessionCount: 500 })`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 1658.3 | 1027 | 178440 |
| warm-1 | 1667.1 | 1027 | 178440 |
| warm-2 | 2206.7 | 1027 | 178440 |
| warm-3 | 2046.7 | 1027 | 178440 |
| warm-4 | 1608.4 | 1027 | 178440 |
| warm-5 | 1724.8 | 1027 | 178440 |

**Warm p50:** 1724.8 ms · **Warm p95 (max of 5):** 2206.7 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | rpc:get_exercise_progression_window | 821 | 555117 | 849.4 |
| 2 | session_logs | 100 | 7101 | 307.9 |
| 3 | session_logs | 100 | 7101 | 308.7 |
| 4 | session_logs | 6 | 427 | 252.7 |

## getExercisePRs

**File:** `services/exercise-analytics-service.ts:329` · **Call:** `getExercisePRs(PERF_CLIENT_ID, { exerciseId })`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 299.7 | 5 | 740 |
| warm-1 | 353.4 | 5 | 740 |
| warm-2 | 1384.0 | 5 | 740 |
| warm-3 | 272.6 | 5 | 740 |
| warm-4 | 290.4 | 5 | 740 |
| warm-5 | 297.7 | 5 | 740 |

**Warm p50:** 297.7 ms · **Warm p95 (max of 5):** 1384.0 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | rpc:get_exercise_prs | 5 | 963 | 297.6 |

## getClientProgressData

**File:** `services/client-portal-progress.ts:160` · **Call:** `getClientProgressData(PERF_CLIENT_ID, 90)`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 1024.2 | 365 | 36114 |
| warm-1 | 828.0 | 365 | 36114 |
| warm-2 | 768.8 | 365 | 36114 |
| warm-3 | 809.0 | 365 | 36114 |
| warm-4 | 961.7 | 365 | 36114 |
| warm-5 | 967.9 | 365 | 36114 |

**Warm p50:** 828.0 ms · **Warm p95 (max of 5):** 967.9 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | clients | 1 | 67 | 266.3 |
| 2 | client_goals | 1 | 518 | 256.6 |
| 3 | clients | 1 | 67 | 259.0 |
| 4 | client_measurements_live | 267 | 84590 | 291.6 |
| 5 | check_ins | 0 | 0 | 292.0 |
| 6 | clients | 1 | 2069 | 292.4 |
| 7 | wellness_logs | 90 | 15121 | 303.6 |
| 8 | client_measurements_live | 1 | 317 | 249.2 |
| 9 | client_measurements_live | 1 | 316 | 264.4 |
| 10 | client_measurements_live | 1 | 317 | 374.8 |
| 11 | client_measurements_live | 1 | 316 | 439.1 |

## getClientGoalWire

**File:** `services/client-goal-wire-service.ts` · **Call:** `getClientGoalWire(PERF_CLIENT_ID, clientToday)`

*Client Program tab's goal card: the goal in force, then the readings on its start day in one round trip.*

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 545.7 | 5 | 183 |
| warm-1 | 513.4 | 5 | 183 |
| warm-2 | 530.1 | 5 | 183 |
| warm-3 | 526.4 | 5 | 183 |
| warm-4 | 542.7 | 5 | 183 |
| warm-5 | 494.6 | 5 | 183 |

**Warm p50:** 526.4 ms · **Warm p95 (max of 5):** 542.7 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | client_goals | 1 | 518 | 247.5 |
| 2 | client_measurements_live | 1 | 316 | 243.5 |
| 3 | client_measurements_live | 1 | 317 | 246.4 |
| 4 | client_measurements_live | 1 | 316 | 246.4 |
| 5 | client_measurements_live | 1 | 317 | 246.6 |

## listHabitEntries

**File:** `services/client-habits-service.ts:155` · **Call:** `listHabitEntries(PERF_CLIENT_ID, { from: today-90d, to: today })`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 259.7 | 455 | 48620 |
| warm-1 | 265.6 | 455 | 48620 |
| warm-2 | 282.0 | 455 | 48620 |
| warm-3 | 1360.9 | 455 | 48620 |
| warm-4 | 259.1 | 455 | 48620 |
| warm-5 | 276.5 | 455 | 48620 |

**Warm p50:** 276.5 ms · **Warm p95 (max of 5):** 1360.9 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | client_habit_logs | 455 | 52260 | 276.0 |


## Followups (out of 3.5 scope)

- **`check_ins.client_id` is TEXT, not UUID.** Migration 023 artifact; everywhere else UUID. Worth a typed-FK migration eventually.
- **3.6 resolved:** `getClientExerciseList` / `getExerciseProgressionSeries` / `getExercisePRs` now go through SQL aggregation RPCs (migration 094) — reads are result-bounded, not history-bounded. The prior `PostgREST 1000-row cap` followup is gone with the multi-call fetch pattern.
