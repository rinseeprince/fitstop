-- 128: Drop coach_saved_plans.cycle_length + rest_pattern.
--
-- Both columns were a denormalized cache re-derived from the session rows on
-- every save. Program length now lives on program_duration_weeks (the authored
-- truth, kept accurate by the builder's save pipeline) and program shape lives
-- on the coach_saved_sessions rows themselves (week_index / order_index /
-- is_rest). Nothing reads the columns anymore.
--
-- Backfill program_duration_weeks from the cache before dropping it so no
-- existing row is left without a length (rows that predate the duration PATCH).

UPDATE coach_saved_plans
SET program_duration_weeks = GREATEST(1, ROUND(COALESCE(cycle_length, 0) / 7.0))::int
WHERE program_duration_weeks IS NULL;

ALTER TABLE coach_saved_plans
  DROP COLUMN IF EXISTS cycle_length,
  DROP COLUMN IF EXISTS rest_pattern;
