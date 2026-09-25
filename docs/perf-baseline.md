# Client portal — perf baseline

**Captured:** 2026-09-25 · **Git SHA:** 56ce443a · **Target:** aeaphsslctwcmebldrzx.supabase.co
**Node:** v26.3.0 · Moving snapshot — re-run after each scale session (3.6+) to refresh.

## Fixture

Client: `5ca1ec1e-0000-4000-8000-000000000001`

| Table | Rows |
|---|---|
| session_logs | 203 |
| exercise_logs | 1218 |
| set_logs | 4846 |
| wellness_logs | 360 |
| nutrition_logs | 360 |
| check_ins | 44 |
| daily_habit_logs | 1800 |
| client_measurements | 353 |
| client_phases (journey blocks) | 4 |

Reproduce: `npx tsx scripts/seed-scale-client.ts` then `npx tsx scripts/perf-baseline.ts`.

Cold = first call after a Supabase connection-warmup query (so cold reflects query/page-cache cold, not TCP/TLS handshake). p50 / p95 use the 5 warm runs only (p95 = max-of-5).

## getClientExerciseList

**File:** `services/exercise-analytics-service.ts:160` · **Call:** `getClientExerciseList(PERF_CLIENT_ID)`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 208.6 | 6 | 1025 |
| warm-1 | 102.0 | 6 | 1025 |
| warm-2 | 82.9 | 6 | 1025 |
| warm-3 | 82.9 | 6 | 1025 |
| warm-4 | 87.4 | 6 | 1025 |
| warm-5 | 76.6 | 6 | 1025 |

**Warm p50:** 82.9 ms · **Warm p95 (max of 5):** 102.0 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | rpc:get_client_exercise_list | 6 | 1055 | 76.4 |

## getExerciseProgressionSeries (sessionCount=12)

**File:** `services/exercise-analytics-service.ts:213` · **Call:** `getExerciseProgressionSeries(PERF_CLIENT_ID, { exerciseId, sessionCount: 12 })`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 184.9 | 61 | 10536 |
| warm-1 | 154.5 | 61 | 10536 |
| warm-2 | 130.3 | 61 | 10536 |
| warm-3 | 116.5 | 61 | 10536 |
| warm-4 | 108.6 | 61 | 10536 |
| warm-5 | 111.3 | 61 | 10536 |

**Warm p50:** 116.5 ms · **Warm p95 (max of 5):** 154.5 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | rpc:get_exercise_progression_window | 49 | 33167 | 62.6 |
| 2 | session_logs | 12 | 853 | 48.0 |

## getExerciseProgressionSeries (sessionCount=500)

**File:** `services/exercise-analytics-service.ts:213` · **Call:** `getExerciseProgressionSeries(PERF_CLIENT_ID, { exerciseId, sessionCount: 500 })`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 468.1 | 1011 | 176031 |
| warm-1 | 291.5 | 1011 | 176031 |
| warm-2 | 293.6 | 1011 | 176031 |
| warm-3 | 275.7 | 1011 | 176031 |
| warm-4 | 263.6 | 1011 | 176031 |
| warm-5 | 246.4 | 1011 | 176031 |

**Warm p50:** 275.7 ms · **Warm p95 (max of 5):** 293.6 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | rpc:get_exercise_progression_window | 808 | 546506 | 78.5 |
| 2 | session_logs | 100 | 7101 | 60.7 |
| 3 | session_logs | 100 | 7101 | 59.3 |
| 4 | session_logs | 3 | 214 | 42.5 |

## getExercisePRs

**File:** `services/exercise-analytics-service.ts:329` · **Call:** `getExercisePRs(PERF_CLIENT_ID, { exerciseId })`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 68.5 | 5 | 737 |
| warm-1 | 59.7 | 5 | 737 |
| warm-2 | 64.3 | 5 | 737 |
| warm-3 | 65.8 | 5 | 737 |
| warm-4 | 61.1 | 5 | 737 |
| warm-5 | 74.6 | 5 | 737 |

**Warm p50:** 64.3 ms · **Warm p95 (max of 5):** 74.6 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | rpc:get_exercise_prs | 5 | 957 | 74.5 |

## getClientProgressData

**File:** `services/client-portal-progress.ts:160` · **Call:** `getClientProgressData(PERF_CLIENT_ID, 90)`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 278.9 | 90 | 11919 |
| warm-1 | 175.6 | 90 | 11919 |
| warm-2 | 187.3 | 90 | 11919 |
| warm-3 | 192.8 | 90 | 11919 |
| warm-4 | 193.7 | 90 | 11919 |
| warm-5 | 169.4 | 90 | 11919 |

**Warm p50:** 187.3 ms · **Warm p95 (max of 5):** 193.7 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | clients | 1 | 67 | 54.5 |
| 2 | client_goals | 1 | 450 | 46.3 |
| 3 | check_ins | 0 | 0 | 51.0 |
| 4 | wellness_logs | 48 | 8065 | 56.4 |
| 5 | client_measurements_live | 36 | 11303 | 56.6 |
| 6 | clients | 1 | 2066 | 62.0 |
| 7 | clients | 1 | 67 | 64.8 |
| 8 | client_measurements_live | 1 | 318 | 38.8 |
| 9 | client_measurements_live | 0 | 2 | 45.5 |
| 10 | client_measurements_live | 1 | 317 | 46.3 |
| 11 | client_measurements_live | 0 | 2 | 47.5 |

## getBlockFacts (3-way fan-out)

**File:** `services/client-blocks-facts-service.ts` · **Call:** `getBlockFacts(PERF_CLIENT_ID, clientToday)`

*The blocks, then two parallel reads over the whole journey span, partitioned per block in memory — round trips are constant in the number of blocks, never per-block.*

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 203.6 | 7 | 1659 |
| warm-1 | 107.5 | 7 | 1659 |
| warm-2 | 99.9 | 7 | 1659 |
| warm-3 | 110.1 | 7 | 1659 |
| warm-4 | 108.5 | 7 | 1659 |
| warm-5 | 97.8 | 7 | 1659 |

**Warm p50:** 107.5 ms · **Warm p95 (max of 5):** 110.1 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | client_phases | 4 | 694 | 49.2 |
| 2 | training_plans | 1 | 132 | 41.7 |
| 3 | nutrition_plans | 2 | 603 | 48.0 |

## getClientJourney

**File:** `services/client-journey-service.ts` · **Call:** `getClientJourney(PERF_CLIENT_ID, today)`

*Client Program tab. Reads only the CURRENT block's note window — elapsed blocks' notes never leave the DB.*

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 114.1 | 66 | 1106 |
| warm-1 | 102.6 | 66 | 1106 |
| warm-2 | 106.6 | 66 | 1106 |
| warm-3 | 159.0 | 66 | 1106 |
| warm-4 | 117.7 | 66 | 1106 |
| warm-5 | 103.0 | 66 | 1106 |

**Warm p50:** 106.6 ms · **Warm p95 (max of 5):** 159.0 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | client_phases | 4 | 694 | 41.5 |
| 2 | client_goals | 1 | 450 | 41.7 |
| 3 | client_measurements_live | 1 | 318 | 46.6 |
| 4 | client_measurements_live | 0 | 2 | 50.9 |
| 5 | client_measurements_live | 52 | 16329 | 51.7 |
| 6 | client_current_measurements | 7 | 2206 | 53.7 |
| 7 | client_measurements_live | 1 | 317 | 58.5 |
| 8 | client_measurements_live | 0 | 2 | 60.7 |

## getHabitLogs

**File:** `services/daily-habits-service.ts:273` · **Call:** `getHabitLogs(PERF_CLIENT_ID, today-90d, today)`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 123.7 | 240 | 103130 |
| warm-1 | 76.7 | 240 | 103130 |
| warm-2 | 66.8 | 240 | 103130 |
| warm-3 | 76.2 | 240 | 103130 |
| warm-4 | 66.5 | 240 | 103130 |
| warm-5 | 64.5 | 240 | 103130 |

**Warm p50:** 66.8 ms · **Warm p95 (max of 5):** 76.7 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | daily_habit_logs | 240 | 116330 | 64.1 |


## Followups (out of 3.5 scope)

- **`check_ins.client_id` is TEXT, not UUID.** Migration 023 artifact; everywhere else UUID. Worth a typed-FK migration eventually.
- **3.6 resolved:** `getClientExerciseList` / `getExerciseProgressionSeries` / `getExercisePRs` now go through SQL aggregation RPCs (migration 094) — reads are result-bounded, not history-bounded. The prior `PostgREST 1000-row cap` followup is gone with the multi-call fetch pattern.
