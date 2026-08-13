# Client portal — perf baseline

**Captured:** 2026-08-13 · **Git SHA:** e7864c4 · **Target:** aeaphsslctwcmebldrzx.supabase.co
**Node:** v26.3.0 · Moving snapshot — re-run after each scale session (3.6+) to refresh.

## Fixture

Client: `5ca1ec1e-0000-4000-8000-000000000001`

| Table | Rows |
|---|---|
| session_logs | 203 |
| exercise_logs | 1218 |
| set_logs | 4846 |
| daily_logs | 360 |
| check_ins | 51 |
| daily_habit_logs | 1800 |
| body_metrics | 12 |
| client_phases (journey blocks) | 4 |
| nutrition_plan_notes | 52 |

Reproduce: `npx tsx scripts/seed-scale-client.ts` then `npx tsx scripts/perf-baseline.ts`. Note volume is `--notes <n>` (default 52 = roughly weekly saves over the year of tenure); raise it past 1000 to exercise the paged read's second page.

Cold = first call after a Supabase connection-warmup query (so cold reflects query/page-cache cold, not TCP/TLS handshake). p50 / p95 use the 5 warm runs only (p95 = max-of-5).

## getClientExerciseList

**File:** `services/exercise-analytics-service.ts:160` · **Call:** `getClientExerciseList(PERF_CLIENT_ID)`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 161.3 | 6 | 869 |
| warm-1 | 85.8 | 6 | 869 |
| warm-2 | 86.0 | 6 | 869 |
| warm-3 | 89.7 | 6 | 869 |
| warm-4 | 83.5 | 6 | 869 |
| warm-5 | 76.8 | 6 | 869 |

**Warm p50:** 85.8 ms · **Warm p95 (max of 5):** 89.7 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | rpc:get_client_exercise_list | 6 | 893 | 76.6 |

## getExerciseProgressionSeries (sessionCount=12)

**File:** `services/exercise-analytics-service.ts:213` · **Call:** `getExerciseProgressionSeries(PERF_CLIENT_ID, { exerciseId, sessionCount: 12 })`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 81.1 | 49 | 3195 |
| warm-1 | 75.2 | 49 | 3195 |
| warm-2 | 98.8 | 49 | 3195 |
| warm-3 | 77.6 | 49 | 3195 |
| warm-4 | 68.2 | 49 | 3195 |
| warm-5 | 62.2 | 49 | 3195 |

**Warm p50:** 75.2 ms · **Warm p95 (max of 5):** 98.8 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | rpc:get_exercise_progression_window | 49 | 19643 | 61.9 |

## getExerciseProgressionSeries (sessionCount=500)

**File:** `services/exercise-analytics-service.ts:213` · **Call:** `getExerciseProgressionSeries(PERF_CLIENT_ID, { exerciseId, sessionCount: 500 })`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 130.9 | 808 | 53804 |
| warm-1 | 108.8 | 808 | 53804 |
| warm-2 | 156.7 | 808 | 53804 |
| warm-3 | 123.2 | 808 | 53804 |
| warm-4 | 99.9 | 808 | 53804 |
| warm-5 | 100.3 | 808 | 53804 |

**Warm p50:** 108.8 ms · **Warm p95 (max of 5):** 156.7 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | rpc:get_exercise_progression_window | 808 | 323498 | 98.4 |

## getExercisePRs

**File:** `services/exercise-analytics-service.ts:329` · **Call:** `getExercisePRs(PERF_CLIENT_ID, { exerciseId })`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 53.2 | 5 | 380 |
| warm-1 | 44.6 | 5 | 380 |
| warm-2 | 49.9 | 5 | 380 |
| warm-3 | 53.5 | 5 | 380 |
| warm-4 | 48.7 | 5 | 380 |
| warm-5 | 48.0 | 5 | 380 |

**Warm p50:** 48.7 ms · **Warm p95 (max of 5):** 53.5 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | rpc:get_exercise_prs | 5 | 297 | 47.8 |

## getClientProgressData (admin-equivalent SQL)

**File:** `services/client-portal-progress.ts:51` · **Call:** `getClientProgressData(PERF_CLIENT_ID, 90)`

*Measured via direct supabaseAdmin queries that match the production read path (check_ins + clients). The function itself uses createPortalClient() (cookie-bound, Next.js-request-only) and can't run from a script — see Followups.*

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 84.7 | 13 | 38 |
| warm-1 | 89.6 | 13 | 38 |
| warm-2 | 87.4 | 13 | 38 |
| warm-3 | 83.8 | 13 | 38 |
| warm-4 | 83.0 | 13 | 38 |
| warm-5 | 83.3 | 13 | 38 |

**Warm p50:** 83.8 ms · **Warm p95 (max of 5):** 89.6 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | check_ins | 12 | 2417 | 41.8 |
| 2 | clients | 1 | 234 | 40.9 |

## calculateStreaks

**File:** `services/daily-logs-service.ts:285` · **Call:** `calculateStreaks(PERF_CLIENT_ID)`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 105.9 | 2 | 41 |
| warm-1 | 132.2 | 2 | 41 |
| warm-2 | 71.4 | 2 | 41 |
| warm-3 | 76.6 | 2 | 41 |
| warm-4 | 81.9 | 2 | 41 |
| warm-5 | 75.3 | 2 | 41 |

**Warm p50:** 76.6 ms · **Warm p95 (max of 5):** 132.2 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | clients | 1 | 67 | 35.5 |
| 2 | rpc:get_client_streak | 1 | 45 | 38.6 |

## getBlockFacts (4-way fan-out)

**File:** `services/client-blocks-facts-service.ts` · **Call:** `getBlockFacts(PERF_CLIENT_ID, today)`

*Four parallel reads over the whole journey span, partitioned per block in memory — round trips are constant in the number of blocks, never per-block.*

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 138.8 | 434 | 9987 |
| warm-1 | 78.9 | 434 | 9987 |
| warm-2 | 114.5 | 434 | 9987 |
| warm-3 | 79.4 | 434 | 9987 |
| warm-4 | 98.6 | 434 | 9987 |
| warm-5 | 76.7 | 434 | 9987 |

**Warm p50:** 79.4 ms · **Warm p95 (max of 5):** 114.5 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | client_phases | 4 | 770 | 33.2 |
| 2 | training_plans | 1 | 124 | 37.0 |
| 3 | nutrition_plan_notes | 52 | 8936 | 37.0 |
| 4 | nutrition_plans | 2 | 387 | 43.1 |
| 5 | nutrition_events | 375 | 25126 | 43.2 |

## listNutritionPlanNotesInRange (365d)

**File:** `services/nutrition-plan-notes-service.ts` · **Call:** `listNutritionPlanNotesInRange(PERF_CLIENT_ID, today-365, today)`

*Paged (fetchAllPages). One page per 1000 rows; the query count below IS the page count.*

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 33.1 | 52 | 8884 |
| warm-1 | 36.4 | 52 | 8884 |
| warm-2 | 47.9 | 52 | 8884 |
| warm-3 | 36.6 | 52 | 8884 |
| warm-4 | 47.5 | 52 | 8884 |
| warm-5 | 34.9 | 52 | 8884 |

**Warm p50:** 36.6 ms · **Warm p95 (max of 5):** 47.9 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | nutrition_plan_notes | 52 | 8936 | 34.7 |

## getClientJourney

**File:** `services/client-journey-service.ts` · **Call:** `getClientJourney(PERF_CLIENT_ID, today)`

*Client Program tab. Reads only the CURRENT block's note window — elapsed blocks' notes never leave the DB.*

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 114.6 | 70 | 3460 |
| warm-1 | 100.3 | 70 | 3460 |
| warm-2 | 85.4 | 70 | 3460 |
| warm-3 | 99.4 | 70 | 3460 |
| warm-4 | 87.4 | 70 | 3460 |
| warm-5 | 90.3 | 70 | 3460 |

**Warm p50:** 90.3 ms · **Warm p95 (max of 5):** 100.3 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | client_phases | 4 | 770 | 36.2 |
| 2 | client_goals | 1 | 433 | 39.0 |
| 3 | nutrition_plan_notes | 13 | 2237 | 41.0 |
| 4 | check_ins | 51 | 11213 | 45.2 |
| 5 | client_metric_entries | 1 | 314 | 50.7 |

## getHabitLogs

**File:** `services/daily-habits-service.ts:273` · **Call:** `getHabitLogs(PERF_CLIENT_ID, today-90d, today)`

| run | wall ms | total rows fetched | payload bytes |
|-----|--------:|-------------------:|--------------:|
| cold | 103.1 | 455 | 195512 |
| warm-1 | 89.0 | 455 | 195512 |
| warm-2 | 87.7 | 455 | 195512 |
| warm-3 | 91.7 | 455 | 195512 |
| warm-4 | 84.3 | 455 | 195512 |
| warm-5 | 74.4 | 455 | 195512 |

**Warm p50:** 87.7 ms · **Warm p95 (max of 5):** 91.7 ms

**Query breakdown** (warm run 5):

| query | table | rows | bytes | ms |
|------:|-------|-----:|------:|---:|
| 1 | daily_habit_logs | 455 | 220537 | 73.5 |


## Followups (out of 3.5 scope)

- **`createPortalClient()` consolidation candidate (CONVENTIONS §8).** `services/client-portal-progress.ts` uses a session-scoped Supabase client when most service functions default to `supabaseAdmin` with explicit scoping. Phase 9 tech-debt sweep should reconcile — services should default to `supabaseAdmin`; session-scoped is the rare case.
- **`getClientProgressData` reads legacy denormalized columns on `clients` (`goal_weight`, `starting_weight`, `current_weight`) rather than the `client_goals` / `body_metrics` tables ARCHITECTURE.md describes as the preferred post-migration source.** Consolidation candidate alongside the `createPortalClient()` one.
- **`check_ins.client_id` is TEXT, not UUID.** Migration 023 artifact; everywhere else UUID. Worth a typed-FK migration eventually.
- **3.6 resolved:** `getClientExerciseList` / `getExerciseProgressionSeries` / `getExercisePRs` now go through SQL aggregation RPCs (migration 094) — reads are result-bounded, not history-bounded. The prior `PostgREST 1000-row cap` followup is gone with the multi-call fetch pattern.
- **3.7 resolved:** `calculateStreaks` no longer reads the `daily_logs_full` view + runs an O(D²) Node loop; it now calls the `get_client_streak` gaps-and-islands RPC (migration 095) over the `daily_logs` spine via the `(client_id, date DESC)` index, returning two integers (result-bounded, not history-bounded).
