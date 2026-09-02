-- =============================================================================
-- 159_drop_measurement_stores.sql -- the old measurement stores go
-- (docs/MEASUREMENT-LOG-PLAN.md section 2; commit 3 of six).
--
-- Every body measurement is a row in client_measurements (migration 158), and
-- every writer and reader has moved to it. This migration removes the stores
-- that used to hold a copy of the same reading:
--
--   1. the seven measurement columns on check_ins -- a check-in owns no
--      measurement column; its readings are log rows stamped with its id;
--   2. body_metrics -- the weight-and-body-fat event log, with its two policies
--      (migration 064) and two indexes;
--   3. the physique rows of client_metric_entries, and its CHECK narrowed to
--      the five wellness keys -- the table keeps coach-logged wellness only
--      (owner decision D2); a physique key on this table is now a constraint
--      error, not a second copy;
--   4. clients.current_weight / current_body_fat_percentage (the "now" cache)
--      and starting_weight / starting_body_fat_percentage (the start pair) --
--      "now" is the newest row through client_current_measurements and the
--      baseline is derived through client_baseline_measurements (D8, D4).
--
-- Nothing in the catalog depends on any of these (probed: no view, function,
-- trigger or policy references the columns; body_metrics is referenced only
-- by its own objects, which drop with it). Every drop is IF EXISTS so a
-- failed push is re-runnable.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. check_ins: the seven measurement columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.check_ins
  DROP COLUMN IF EXISTS weight,
  DROP COLUMN IF EXISTS body_fat_percentage,
  DROP COLUMN IF EXISTS waist,
  DROP COLUMN IF EXISTS hips,
  DROP COLUMN IF EXISTS chest,
  DROP COLUMN IF EXISTS arms,
  DROP COLUMN IF EXISTS thighs;

-- ---------------------------------------------------------------------------
-- 2. body_metrics: the table, and with it clients_view_own_body_metrics,
--    coaches_view_client_body_metrics and its indexes
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.body_metrics;

-- ---------------------------------------------------------------------------
-- 3. client_metric_entries: wellness keys only
-- ---------------------------------------------------------------------------
DELETE FROM public.client_metric_entries
WHERE metric_key IN ('weight','bodyFat','waist','hips','chest','arms','thighs');

ALTER TABLE public.client_metric_entries
  DROP CONSTRAINT IF EXISTS client_metric_entries_metric_key_check;
ALTER TABLE public.client_metric_entries
  ADD CONSTRAINT client_metric_entries_metric_key_check
  CHECK (metric_key IN ('mood','energy','sleep','stress','soreness'));

COMMENT ON TABLE public.client_metric_entries IS
  'Coach-logged WELLNESS entries (mood, energy, sleep, stress, soreness): one row per client, metric and day; re-logging a day replaces the value. Every body measurement is a row in client_measurements.';

-- ---------------------------------------------------------------------------
-- 4. clients: the two "now" caches and the start pair
-- ---------------------------------------------------------------------------
ALTER TABLE public.clients
  DROP COLUMN IF EXISTS current_weight,
  DROP COLUMN IF EXISTS current_body_fat_percentage,
  DROP COLUMN IF EXISTS starting_weight,
  DROP COLUMN IF EXISTS starting_body_fat_percentage;
