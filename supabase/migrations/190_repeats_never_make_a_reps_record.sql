-- =============================================================================
-- Migration 190: repeats never make a reps record
-- (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md section 4.4, "Repeats and times";
-- owner, 2026-09-21)
--
-- Reps on a set with a distance or a time are repeats: 3 reps of 1 km is 3 km,
-- 3 reps of 30 s is 1:30, never a rep count. get_exercise_prs (migration 188)
-- still read them as reps: best_reps took the most reps in any set logged with
-- no load, so a run of 3 x 1 km made a "Best set - 3 reps" record, and rep_max
-- took any load with reps, so a carry of 3 x 40 m at 64 kg would have made a
-- "3 Rep Max - 64 kg". Both now skip a set with a distance or a duration.
--
-- Nothing else changes: best_time, heaviest_carry and longest_hold read the
-- sets as before, and the signature, the return shape, the warm-up handling,
-- the identity union and p_exclude_dates are migration 188's. The marker
-- kernel reads the same sets the same way (isBodyweightSet and isLift in
-- utils/exercise-session-markers.ts), so the chart, the Sessions table's star
-- and the Overview's PR feed agree with these records.
--
-- The same signature and return shape, so CREATE OR REPLACE keeps the grants;
-- the lockdown is restated below so this file says it. LANGUAGE sql STABLE /
-- SECURITY INVOKER / SET search_path = public carried verbatim. Pure ASCII
-- inside the $$ body.
-- =============================================================================

CREATE OR REPLACE FUNCTION get_exercise_prs(
  p_client_id UUID,
  p_exercise_id UUID DEFAULT NULL,
  p_exercise_name TEXT DEFAULT NULL,
  p_exclude_dates DATE[] DEFAULT NULL
)
RETURNS TABLE (
  kind TEXT,
  reps INT,
  weight NUMERIC,
  distance_meters NUMERIC,
  duration_seconds NUMERIC,
  date TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH sets AS (
    SELECT
      sl.reps,
      sl.weight,
      sl.distance_meters,
      sl.duration_seconds,
      slg.completed_at
    FROM exercise_logs el
    JOIN session_logs slg ON slg.id = el.session_log_id
    LEFT JOIN training_exercises te ON te.id = el.training_exercise_id
    JOIN set_logs sl ON sl.exercise_log_id = el.id
    WHERE slg.client_id = p_client_id
      AND sl.set_type <> 'warmup'
      AND (
        (p_exercise_id IS NOT NULL AND (el.exercise_id = p_exercise_id OR te.exercise_id = p_exercise_id))
        OR (p_exercise_name IS NOT NULL AND LOWER(el.performed_name) = LOWER(p_exercise_name))
      )
      AND (
        p_exclude_dates IS NULL
        OR NOT ((slg.completed_at AT TIME ZONE 'UTC')::DATE = ANY (p_exclude_dates))
      )
  ),
  rep_max AS (
    SELECT DISTINCT ON (s.reps)
      'rep_max'::TEXT AS kind, s.reps, s.weight, NULL::NUMERIC AS distance_meters, NULL::NUMERIC AS duration_seconds, s.completed_at
    FROM sets s
    WHERE s.reps IS NOT NULL AND s.weight IS NOT NULL AND s.weight > 0
      AND s.distance_meters IS NULL AND s.duration_seconds IS NULL
    ORDER BY s.reps ASC, s.weight DESC, s.completed_at ASC
  ),
  best_reps AS (
    SELECT
      'best_reps'::TEXT AS kind, s.reps, NULL::NUMERIC AS weight, NULL::NUMERIC AS distance_meters, NULL::NUMERIC AS duration_seconds, s.completed_at
    FROM sets s
    WHERE s.reps IS NOT NULL AND (s.weight IS NULL OR s.weight <= 0)
      AND s.distance_meters IS NULL AND s.duration_seconds IS NULL
    ORDER BY s.reps DESC, s.completed_at ASC
    LIMIT 1
  ),
  best_time AS (
    SELECT DISTINCT ON (s.distance_meters)
      'best_time'::TEXT AS kind, NULL::INT AS reps, NULL::NUMERIC AS weight, s.distance_meters, s.duration_seconds, s.completed_at
    FROM sets s
    WHERE s.distance_meters IS NOT NULL AND s.duration_seconds IS NOT NULL
    ORDER BY s.distance_meters ASC, s.duration_seconds ASC, s.completed_at ASC
    LIMIT 50
  ),
  heaviest_carry AS (
    SELECT DISTINCT ON (s.distance_meters)
      'heaviest_carry'::TEXT AS kind, NULL::INT AS reps, s.weight, s.distance_meters, NULL::NUMERIC AS duration_seconds, s.completed_at
    FROM sets s
    WHERE s.distance_meters IS NOT NULL AND s.weight IS NOT NULL AND s.weight > 0
    ORDER BY s.distance_meters ASC, s.weight DESC, s.completed_at ASC
    LIMIT 50
  ),
  longest_hold AS (
    SELECT
      'longest_hold'::TEXT AS kind, NULL::INT AS reps, NULL::NUMERIC AS weight, NULL::NUMERIC AS distance_meters, s.duration_seconds, s.completed_at
    FROM sets s
    WHERE s.duration_seconds IS NOT NULL AND s.distance_meters IS NULL
    ORDER BY s.duration_seconds DESC, s.completed_at ASC
    LIMIT 1
  ),
  bests AS (
    SELECT * FROM rep_max
    UNION ALL SELECT * FROM best_reps
    UNION ALL SELECT * FROM best_time
    UNION ALL SELECT * FROM heaviest_carry
    UNION ALL SELECT * FROM longest_hold
  )
  SELECT b.kind, b.reps, b.weight, b.distance_meters, b.duration_seconds, b.completed_at AS date
  FROM bests b
  ORDER BY b.kind ASC, b.reps ASC NULLS LAST, b.distance_meters ASC NULLS LAST;
$$;

REVOKE EXECUTE ON FUNCTION get_exercise_prs(UUID, UUID, TEXT, DATE[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION get_exercise_prs(UUID, UUID, TEXT, DATE[]) TO service_role;
