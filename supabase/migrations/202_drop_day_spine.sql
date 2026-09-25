-- =============================================================================
-- Migration 202: the day spine goes — every client log is its own table, found
-- by client and date (docs/DAY-SPINE-FLATTEN-PLAN.md §2, commit 2).
--
-- Two tables make a day, wellness_logs and nutrition_logs, each one row per
-- client per day: UNIQUE (client_id, date) is the upsert's conflict target and
-- every reader's key. There is no parent row and no child id. Dropped, in
-- dependency order: the view daily_logs_full (it selects the columns below);
-- the two daily_log_id columns with their foreign keys and UNIQUE (daily_log_id)
-- indexes; the two plain (client_id, date DESC) indexes, which the new UNIQUE
-- indexes serve (a btree is read backwards for ORDER BY date DESC); training_logs
-- (nothing writes it; D2); both upsert_daily_log_atomic overloads (zero callers,
-- and bodies naming food-log columns migration 173 dropped) and get_client_streak
-- (read by the perf harness alone; D4); then daily_logs itself with its notes
-- (the client app has no day note; D1), its four indexes, its updated_at trigger
-- and its clients foreign key.
--
-- DEV facts at push time (aeaphsslctwcmebldrzx, 2026-09-25): 0 duplicate
-- (client_id, date) in either child (the UNIQUEs' precondition); 0 children
-- whose (client_id, date) differs from their spine row's; 14 childless spine
-- rows, which the tables hold nothing for (8 on the perf-correctness 3.7 client,
-- its streak fixture; 6 on one test client over 5–10 Sep); daily_logs 17,324
-- rows, 1,978 with a note; training_logs 726 rows on 2 seed clients, newest
-- 2026-08-13. PROD (etezzztgafcotyahgijk) held 0 rows in all four tables on
-- 2026-09-25 and is re-probed before its own push (CONVENTIONS §8).
--
-- Idempotent: each constraint is added only when absent and every drop is
-- IF EXISTS, so a half-applied push re-runs cleanly. No table is created and
-- no grant changes: the view's grants go with it, and a constraint needs none.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wellness_logs_client_date_key'
      AND conrelid = 'public.wellness_logs'::regclass
  ) THEN
    ALTER TABLE public.wellness_logs
      ADD CONSTRAINT wellness_logs_client_date_key UNIQUE (client_id, date);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'nutrition_logs_client_date_key'
      AND conrelid = 'public.nutrition_logs'::regclass
  ) THEN
    ALTER TABLE public.nutrition_logs
      ADD CONSTRAINT nutrition_logs_client_date_key UNIQUE (client_id, date);
  END IF;
END $$;

-- The view before the columns it selects.
DROP VIEW IF EXISTS public.daily_logs_full;

-- Each column takes its foreign key and its UNIQUE (daily_log_id) index with it.
ALTER TABLE public.wellness_logs  DROP COLUMN IF EXISTS daily_log_id;
ALTER TABLE public.nutrition_logs DROP COLUMN IF EXISTS daily_log_id;

-- The UNIQUE (client_id, date) indexes above serve these scans both ways.
DROP INDEX IF EXISTS public.idx_wellness_logs_client_date;
DROP INDEX IF EXISTS public.idx_nutrition_logs_client_date;

-- D2: no writer since the Daily Pulse retired; its two indexes, its trigger and
-- its three foreign keys go with it.
DROP TABLE IF EXISTS public.training_logs;

-- The functions before the table their bodies name.
DROP FUNCTION IF EXISTS public.upsert_daily_log_atomic(uuid, date, text, jsonb, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.upsert_daily_log_atomic(uuid, date, text, jsonb, jsonb, jsonb, uuid, uuid);
DROP FUNCTION IF EXISTS public.get_client_streak(uuid, date, date);

-- D1: the spine and its notes, its four indexes, its updated_at trigger and its
-- clients foreign key.
DROP TABLE IF EXISTS public.daily_logs;
