# Client portal — perf baseline

**Captured:** 2026-09-30 · **Git SHA:** eda2bc0b · **Target:** aeaphsslctwcmebldrzx.supabase.co
**Node:** v26.3.0 · Moving snapshot — re-run after each scale session (3.6+) to refresh.

## Fixture

Client: `5ca1ec1e-0000-4000-8000-000000000001`

| Table | Rows |
|---|---|
| session_logs | 206 |
| exercise_logs | 1236 |
| set_logs | 4952 |
| wellness_logs | 360 |
| nutrition_logs | 360 |
| check_ins | 51 |
| client_habit_logs | 1800 |
| client_measurements | 712 |
| client_phases (journey blocks) | 4 |

Reproduce: `npx tsx scripts/seed-scale-client.ts` then `npx tsx scripts/perf-baseline.ts`.

Cold = first call after a Supabase connection-warmup query (so cold reflects query/page-cache cold, not TCP/TLS handshake). p50 / p95 use the 5 warm runs only (p95 = max-of-5).

## getClientExerciseList

**File:** `services/exercise-analytics-service.ts:160` · **Call:** `getClientExerciseList(PERF_CLIENT_ID)`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 680.0 | 6 | 1025 |
| warm-1 | 336.4 | 6 | 1025 |
| warm-2 | 329.8 | 6 | 1025 |
| warm-3 | 328.1 | 6 | 1025 |
| warm-4 | 342.7 | 6 | 1025 |
| warm-5 | 312.0 | 6 | 1025 |

**Warm p50:** 329.8 ms · **Warm p95 (max of 5):** 342.7 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | rpc:get_client_exercise_list | 6 | 1055 | 311.8 |

## getExerciseProgressionSeries (sessionCount=12)

**File:** `services/exercise-analytics-service.ts:213` · **Call:** `getExerciseProgressionSeries(PERF_CLIENT_ID, { exerciseId, sessionCount: 12 })`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 681.4 | 58 | 10312 |
| warm-1 | 532.0 | 58 | 10312 |
| warm-2 | 546.9 | 58 | 10312 |
| warm-3 | 483.8 | 58 | 10312 |
| warm-4 | 585.4 | 58 | 10312 |
| warm-5 | 518.1 | 58 | 10312 |

**Warm p50:** 532.0 ms · **Warm p95 (max of 5):** 585.4 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | rpc:get_exercise_progression_window | 46 | 31143 | 267.7 |
| 2 | session_logs | 12 | 853 | 249.3 |

## getExerciseProgressionSeries (sessionCount=500)

**File:** `services/exercise-analytics-service.ts:213` · **Call:** `getExerciseProgressionSeries(PERF_CLIENT_ID, { exerciseId, sessionCount: 500 })`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 1777.2 | 1027 | 178454 |
| warm-1 | 1565.8 | 1027 | 178454 |
| warm-2 | 1462.1 | 1027 | 178454 |
| warm-3 | 1535.2 | 1027 | 178454 |
| warm-4 | 1635.6 | 1027 | 178454 |
| warm-5 | 1534.9 | 1027 | 178454 |

**Warm p50:** 1535.2 ms · **Warm p95 (max of 5):** 1635.6 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | rpc:get_exercise_progression_window | 821 | 555113 | 695.6 |
| 2 | session_logs | 100 | 7101 | 319.9 |
| 3 | session_logs | 100 | 7101 | 257.4 |
| 4 | session_logs | 6 | 427 | 255.8 |

## getExercisePRs

**File:** `services/exercise-analytics-service.ts:329` · **Call:** `getExercisePRs(PERF_CLIENT_ID, { exerciseId })`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 297.5 | 5 | 740 |
| warm-1 | 320.4 | 5 | 740 |
| warm-2 | 255.8 | 5 | 740 |
| warm-3 | 255.6 | 5 | 740 |
| warm-4 | 256.3 | 5 | 740 |
| warm-5 | 353.3 | 5 | 740 |

**Warm p50:** 256.3 ms · **Warm p95 (max of 5):** 353.3 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | rpc:get_exercise_prs | 5 | 963 | 353.1 |

## getClientProgressData

**File:** `services/client-portal-progress.ts:160` · **Call:** `getClientProgressData(PERF_CLIENT_ID, 90)`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 1259.3 | 212 | 24635 |
| warm-1 | 1076.1 | 212 | 24635 |
| warm-2 | 742.7 | 212 | 24635 |
| warm-3 | 743.7 | 212 | 24635 |
| warm-4 | 760.7 | 212 | 24635 |
| warm-5 | 711.2 | 212 | 24635 |

**Warm p50:** 743.7 ms · **Warm p95 (max of 5):** 1076.1 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | clients | 1 | 67 | 227.5 |
| 2 | check_ins | 0 | 0 | 233.6 |
| 3 | wellness_logs | 91 | 15289 | 241.7 |
| 4 | clients | 1 | 67 | 241.8 |
| 5 | clients | 1 | 2068 | 244.7 |
| 6 | client_goals | 1 | 518 | 244.8 |
| 7 | client_measurements_live | 113 | 35737 | 248.7 |
| 8 | client_measurements_live | 1 | 317 | 236.2 |
| 9 | client_measurements_live | 1 | 316 | 236.4 |
| 10 | client_measurements_live | 1 | 257 | 236.5 |
| 11 | client_measurements_live | 1 | 258 | 236.7 |

## getBlockFacts (3-way fan-out)

**File:** `services/client-blocks-facts-service.ts` · **Call:** `getBlockFacts(PERF_CLIENT_ID, clientToday)`

*The blocks, then two parallel reads over the whole journey span, partitioned per block in memory — round trips are constant in the number of blocks, never per-block.*

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 508.4 | 7 | 1593 |
| warm-1 | 471.0 | 7 | 1593 |
| warm-2 | 474.4 | 7 | 1593 |
| warm-3 | 484.6 | 7 | 1593 |
| warm-4 | 474.5 | 7 | 1593 |
| warm-5 | 471.1 | 7 | 1593 |

**Warm p50:** 474.4 ms · **Warm p95 (max of 5):** 484.6 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | client_phases | 4 | 694 | 231.5 |
| 2 | nutrition_plans | 2 | 584 | 238.7 |
| 3 | training_plans | 1 | 132 | 238.9 |

## getClientJourney

**File:** `services/client-journey-service.ts` · **Call:** `getClientJourney(PERF_CLIENT_ID, today)`

*Client Program tab. Reads only the CURRENT block's note window — elapsed blocks' notes never leave the DB.*

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 505.2 | 121 | 1352 |
| warm-1 | 497.7 | 121 | 1352 |
| warm-2 | 504.0 | 121 | 1352 |
| warm-3 | 490.7 | 121 | 1352 |
| warm-4 | 484.3 | 121 | 1352 |
| warm-5 | 503.3 | 121 | 1352 |

**Warm p50:** 497.7 ms · **Warm p95 (max of 5):** 504.0 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | client_goals | 1 | 518 | 226.3 |
| 2 | client_phases | 4 | 694 | 241.8 |
| 3 | client_measurements_live | 1 | 316 | 234.7 |
| 4 | client_measurements_live | 1 | 317 | 234.8 |
| 5 | client_measurements_live | 1 | 257 | 240.2 |
| 6 | client_current_measurements | 7 | 2208 | 240.4 |
| 7 | nutrition_plans | 1 | 178 | 240.1 |
| 8 | client_measurements_live | 104 | 32987 | 253.3 |
| 9 | client_measurements_live | 1 | 258 | 260.7 |

## listHabitEntries

**File:** `services/client-habits-service.ts:155` · **Call:** `listHabitEntries(PERF_CLIENT_ID, { from: today-90d, to: today })`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 266.3 | 455 | 48620 |
| warm-1 | 316.7 | 455 | 48620 |
| warm-2 | 251.3 | 455 | 48620 |
| warm-3 | 251.4 | 455 | 48620 |
| warm-4 | 252.9 | 455 | 48620 |
| warm-5 | 251.3 | 455 | 48620 |

**Warm p50:** 251.4 ms · **Warm p95 (max of 5):** 316.7 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | client_habit_logs | 455 | 52260 | 250.8 |


## Followups (out of 3.5 scope)

- **`check_ins.client_id` is TEXT, not UUID.** Migration 023 artifact; everywhere else UUID. Worth a typed-FK migration eventually.
- **3.6 resolved:** `getClientExerciseList` / `getExerciseProgressionSeries` / `getExercisePRs` now go through SQL aggregation RPCs (migration 094) — reads are result-bounded, not history-bounded. The prior `PostgREST 1000-row cap` followup is gone with the multi-call fetch pattern.
