# Client portal — perf baseline

**Captured:** 2026-09-24 · **Git SHA:** a4920fda · **Target:** aeaphsslctwcmebldrzx.supabase.co
**Node:** v26.3.0 · Moving snapshot — re-run after each scale session (3.6+) to refresh.

## Fixture

Client: `5ca1ec1e-0000-4000-8000-000000000001`

| Table | Rows |
|---|---|
| session_logs | 203 |
| exercise_logs | 1218 |
| set_logs | 4846 |
| daily_logs | 360 |
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
| cold | 567.5 | 6 | 1025 |
| warm-1 | 129.6 | 6 | 1025 |
| warm-2 | 79.7 | 6 | 1025 |
| warm-3 | 86.1 | 6 | 1025 |
| warm-4 | 79.4 | 6 | 1025 |
| warm-5 | 86.2 | 6 | 1025 |

**Warm p50:** 86.1 ms · **Warm p95 (max of 5):** 129.6 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | rpc:get_client_exercise_list | 6 | 1055 | 85.9 |

## getExerciseProgressionSeries (sessionCount=12)

**File:** `services/exercise-analytics-service.ts:213` · **Call:** `getExerciseProgressionSeries(PERF_CLIENT_ID, { exerciseId, sessionCount: 12 })`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 220.8 | 61 | 10536 |
| warm-1 | 154.7 | 61 | 10536 |
| warm-2 | 114.4 | 61 | 10536 |
| warm-3 | 95.4 | 61 | 10536 |
| warm-4 | 87.3 | 61 | 10536 |
| warm-5 | 95.8 | 61 | 10536 |

**Warm p50:** 95.8 ms · **Warm p95 (max of 5):** 154.7 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | rpc:get_exercise_progression_window | 49 | 33167 | 57.4 |
| 2 | session_logs | 12 | 853 | 37.4 |

## getExerciseProgressionSeries (sessionCount=500)

**File:** `services/exercise-analytics-service.ts:213` · **Call:** `getExerciseProgressionSeries(PERF_CLIENT_ID, { exerciseId, sessionCount: 500 })`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 594.2 | 1011 | 176031 |
| warm-1 | 337.0 | 1011 | 176031 |
| warm-2 | 234.1 | 1011 | 176031 |
| warm-3 | 241.6 | 1011 | 176031 |
| warm-4 | 226.9 | 1011 | 176031 |
| warm-5 | 222.9 | 1011 | 176031 |

**Warm p50:** 234.1 ms · **Warm p95 (max of 5):** 337.0 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | rpc:get_exercise_progression_window | 808 | 546506 | 73.1 |
| 2 | session_logs | 100 | 7101 | 48.3 |
| 3 | session_logs | 100 | 7101 | 44.5 |
| 4 | session_logs | 3 | 214 | 51.7 |

## getExercisePRs

**File:** `services/exercise-analytics-service.ts:329` · **Call:** `getExercisePRs(PERF_CLIENT_ID, { exerciseId })`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 104.5 | 5 | 737 |
| warm-1 | 50.8 | 5 | 737 |
| warm-2 | 51.5 | 5 | 737 |
| warm-3 | 49.2 | 5 | 737 |
| warm-4 | 46.2 | 5 | 737 |
| warm-5 | 47.5 | 5 | 737 |

**Warm p50:** 49.2 ms · **Warm p95 (max of 5):** 51.5 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | rpc:get_exercise_prs | 5 | 957 | 47.4 |

## getClientProgressData

**File:** `services/client-portal-progress.ts:160` · **Call:** `getClientProgressData(PERF_CLIENT_ID, 90)`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 445.5 | 90 | 11919 |
| warm-1 | 199.5 | 90 | 11919 |
| warm-2 | 172.7 | 90 | 11919 |
| warm-3 | 258.7 | 90 | 11919 |
| warm-4 | 129.2 | 90 | 11919 |
| warm-5 | 141.3 | 90 | 11919 |

**Warm p50:** 172.7 ms · **Warm p95 (max of 5):** 258.7 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | clients | 1 | 67 | 31.7 |
| 2 | wellness_logs | 48 | 8065 | 41.4 |
| 3 | check_ins | 0 | 0 | 63.5 |
| 4 | client_goals | 1 | 450 | 65.2 |
| 5 | client_measurements_live | 36 | 11303 | 65.6 |
| 6 | clients | 1 | 67 | 65.6 |
| 7 | clients | 1 | 2066 | 70.0 |
| 8 | client_measurements_live | 0 | 2 | 36.1 |
| 9 | client_measurements_live | 0 | 2 | 39.7 |
| 10 | client_measurements_live | 1 | 317 | 40.4 |
| 11 | client_measurements_live | 1 | 318 | 41.4 |

## calculateStreaks

**File:** `services/daily-logs-service.ts:285` · **Call:** `calculateStreaks(PERF_CLIENT_ID)`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 109.5 | 2 | 39 |
| warm-1 | 69.8 | 2 | 39 |
| warm-2 | 66.3 | 2 | 39 |
| warm-3 | 65.2 | 2 | 39 |
| warm-4 | 65.7 | 2 | 39 |
| warm-5 | 69.0 | 2 | 39 |

**Warm p50:** 66.3 ms · **Warm p95 (max of 5):** 69.8 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | clients | 1 | 67 | 34.3 |
| 2 | rpc:get_client_streak | 1 | 43 | 33.8 |

## getBlockFacts (3-way fan-out)

**File:** `services/client-blocks-facts-service.ts` · **Call:** `getBlockFacts(PERF_CLIENT_ID, clientToday)`

*The blocks, then two parallel reads over the whole journey span, partitioned per block in memory — round trips are constant in the number of blocks, never per-block.*

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 117.4 | 7 | 1659 |
| warm-1 | 78.9 | 7 | 1659 |
| warm-2 | 70.6 | 7 | 1659 |
| warm-3 | 70.3 | 7 | 1659 |
| warm-4 | 69.3 | 7 | 1659 |
| warm-5 | 71.8 | 7 | 1659 |

**Warm p50:** 70.6 ms · **Warm p95 (max of 5):** 78.9 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | client_phases | 4 | 694 | 34.0 |
| 2 | nutrition_plans | 2 | 603 | 34.7 |
| 3 | training_plans | 1 | 132 | 37.4 |

## getClientJourney

**File:** `services/client-journey-service.ts` · **Call:** `getClientJourney(PERF_CLIENT_ID, today)`

*Client Program tab. Reads only the CURRENT block's note window — elapsed blocks' notes never leave the DB.*

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 112.5 | 66 | 1106 |
| warm-1 | 106.7 | 66 | 1106 |
| warm-2 | 90.3 | 66 | 1106 |
| warm-3 | 124.2 | 66 | 1106 |
| warm-4 | 108.8 | 66 | 1106 |
| warm-5 | 81.3 | 66 | 1106 |

**Warm p50:** 106.7 ms · **Warm p95 (max of 5):** 124.2 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | client_goals | 1 | 450 | 31.6 |
| 2 | client_phases | 4 | 694 | 37.0 |
| 3 | client_measurements_live | 0 | 2 | 40.2 |
| 4 | client_measurements_live | 1 | 317 | 40.3 |
| 5 | client_measurements_live | 1 | 318 | 40.4 |
| 6 | client_current_measurements | 7 | 2206 | 40.8 |
| 7 | client_measurements_live | 0 | 2 | 43.3 |
| 8 | client_measurements_live | 52 | 16329 | 43.6 |

## getHabitLogs

**File:** `services/daily-habits-service.ts:273` · **Call:** `getHabitLogs(PERF_CLIENT_ID, today-90d, today)`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 96.6 | 240 | 103130 |
| warm-1 | 53.0 | 240 | 103130 |
| warm-2 | 56.8 | 240 | 103130 |
| warm-3 | 56.1 | 240 | 103130 |
| warm-4 | 54.0 | 240 | 103130 |
| warm-5 | 58.0 | 240 | 103130 |

**Warm p50:** 56.1 ms · **Warm p95 (max of 5):** 58.0 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | daily_habit_logs | 240 | 116330 | 57.6 |


## Followups (out of 3.5 scope)

- **`check_ins.client_id` is TEXT, not UUID.** Migration 023 artifact; everywhere else UUID. Worth a typed-FK migration eventually.
- **3.6 resolved:** `getClientExerciseList` / `getExerciseProgressionSeries` / `getExercisePRs` now go through SQL aggregation RPCs (migration 094) — reads are result-bounded, not history-bounded. The prior `PostgREST 1000-row cap` followup is gone with the multi-call fetch pattern.
- **3.7 resolved:** `calculateStreaks` no longer reads the `daily_logs_full` view + runs an O(D²) Node loop; it now calls the `get_client_streak` gaps-and-islands RPC (migration 095) over the `daily_logs` spine via the `(client_id, date DESC)` index, returning two integers (result-bounded, not history-bounded).
