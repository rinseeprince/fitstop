-- =============================================================================
-- Migration 188: Progress charts by exercise type (training upgrade, commit 16)
--
-- Each exercise's progress chart shows the markers that matter for its type
-- (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md section 4.4), and its PRs are its
-- type's bests. The three analytics functions change shape for it:
--
-- get_client_exercise_list gains the catalog row's exercise_type, which says
-- which markers lead an exercise's chart (NULL for a freehand name, which the
-- service reads as Strength).
--
-- get_exercise_progression_window returns every numeric measure a logged set
-- can carry (migration 184; SET_LOG_MEASURES in utils/set-log-measures.ts is
-- the one table, and utils/exercise-progress-markers.test.ts reads this file
-- against it), not only reps, weight and RPE, so the service computes a
-- session's best pace, split, watts, distance, time and hold beside its top
-- set, e1RM and volume. The window, the identity union, the warm-up handling
-- and the LEFT JOIN that keeps a zero-set exercise_log are unchanged.
--
-- get_exercise_prs returns typed bests, a kind per row: rep_max (the heaviest
-- weight per rep count, as before), best_reps (the most reps in a set logged
-- with no load), best_time (the fastest time per distance, exactly as logged),
-- heaviest_carry (the heaviest load per distance) and longest_hold (the
-- longest set logged with a time and no distance). A load is a weight above
-- zero, everywhere. Bounded: reps are CHECKed to 100 buckets, the two
-- per-distance kinds keep the 50 shortest distances, the two single bests one
-- row each. It gains p_exclude_dates: the Overview's PR feed asks for the bests
-- as they stood before the sessions it announces, by the days those sessions
-- are attributed to (session_logs.completed_at, a bare day at UTC midnight).
--
-- Every RETURNS TABLE shape changes and get_exercise_prs gains a parameter,
-- which forbids CREATE OR REPLACE: DROP each by its current live signature,
-- recreate, re-issue the grant lockdown (grants drop with the function).
-- LANGUAGE sql STABLE / SECURITY INVOKER / SET search_path = public carried
-- verbatim from 094/102/103/120. Pure ASCII inside the $$ bodies.
-- =============================================================================

DROP FUNCTION IF EXISTS get_client_exercise_list(UUID, DATE, DATE);
DROP FUNCTION IF EXISTS get_exercise_progression_window(UUID, UUID, TEXT, INT, DATE, DATE);
DROP FUNCTION IF EXISTS get_exercise_prs(UUID, UUID, TEXT);
-- plain DROPs, NO CASCADE -- called only from the service via PostgREST, no DB
-- dependents. If a DROP errors on a dependency, STOP and investigate.

-- -----------------------------------------------------------------------------
-- get_client_exercise_list (+ exercise_type)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_client_exercise_list(
  p_client_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
  exercise_id UUID,
  name TEXT,
  log_count INT,
  last_logged_date TIMESTAMPTZ,
  exercise_type TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH resolved AS (
    SELECT
      sl.completed_at,
      el.id AS exercise_log_id,
      COALESCE(el.exercise_id, te.exercise_id) AS resolved_exercise_id,
      el.performed_name,
      COALESCE(
        el.exercise_id::TEXT,
        te.exercise_id::TEXT,
        LOWER(el.performed_name),
        'unknown'
      ) AS identity_key
    FROM exercise_logs el
    JOIN session_logs sl ON sl.id = el.session_log_id
    LEFT JOIN training_exercises te ON te.id = el.training_exercise_id
    WHERE sl.client_id = p_client_id
      AND (p_start_date IS NULL OR sl.completed_at >= p_start_date)
      AND (p_end_date   IS NULL OR sl.completed_at <  (p_end_date + INTERVAL '1 day'))
  ),
  grouped AS (
    SELECT
      (ARRAY_AGG(resolved_exercise_id ORDER BY completed_at DESC, exercise_log_id DESC)
        FILTER (WHERE resolved_exercise_id IS NOT NULL))[1] AS exercise_id,
      COALESCE(
        (ARRAY_AGG(performed_name ORDER BY completed_at DESC NULLS LAST, exercise_log_id DESC))[1],
        'Unknown exercise'
      ) AS name,
      COUNT(*)::INT AS log_count,
      MAX(completed_at) AS last_logged_date
    FROM resolved
    GROUP BY identity_key
  )
  SELECT
    g.exercise_id,
    g.name,
    g.log_count,
    g.last_logged_date,
    ex.exercise_type
  FROM grouped g
  LEFT JOIN exercises ex ON ex.id = g.exercise_id
  ORDER BY g.log_count DESC, g.name ASC;
$$;

REVOKE EXECUTE ON FUNCTION get_client_exercise_list(UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION get_client_exercise_list(UUID, DATE, DATE) TO service_role;

-- -----------------------------------------------------------------------------
-- get_exercise_progression_window (+ every numeric measure of a logged set)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_exercise_progression_window(
  p_client_id UUID,
  p_exercise_id UUID DEFAULT NULL,
  p_exercise_name TEXT DEFAULT NULL,
  p_session_count INT DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
  session_log_id UUID,
  completed_at TIMESTAMPTZ,
  exercise_log_id UUID,
  prescribed_exercise_snapshot JSONB,
  set_id UUID,
  set_number INT,
  set_type TEXT,
  reps INT,
  weight NUMERIC,
  rpe NUMERIC,
  rir NUMERIC,
  distance_meters NUMERIC,
  duration_seconds NUMERIC,
  pace_seconds_per_km INT,
  split_seconds_per_500m NUMERIC,
  calories INT,
  cadence INT,
  stroke_rate INT,
  resistance NUMERIC,
  heart_rate_zone INT,
  heart_rate INT,
  power INT,
  ftp_percent NUMERIC,
  rest_seconds INT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH matching AS (
    SELECT
      el.id AS exercise_log_id,
      el.session_log_id,
      sl.completed_at,
      el.prescribed_exercise_snapshot
    FROM exercise_logs el
    JOIN session_logs sl ON sl.id = el.session_log_id
    LEFT JOIN training_exercises te ON te.id = el.training_exercise_id
    WHERE sl.client_id = p_client_id
      AND (
        (p_exercise_id IS NOT NULL AND (el.exercise_id = p_exercise_id OR te.exercise_id = p_exercise_id))
        OR (p_exercise_name IS NOT NULL AND LOWER(el.performed_name) = LOWER(p_exercise_name))
      )
      AND (p_start_date IS NULL OR sl.completed_at >= p_start_date)
      AND (p_end_date   IS NULL OR sl.completed_at <  (p_end_date + INTERVAL '1 day'))
  ),
  windowed_sessions AS (
    SELECT m.session_log_id, MIN(m.completed_at) AS completed_at
    FROM matching m
    GROUP BY m.session_log_id
    ORDER BY MIN(m.completed_at) DESC, m.session_log_id DESC
    LIMIT COALESCE(
      p_session_count,
      CASE WHEN p_start_date IS NULL AND p_end_date IS NULL THEN 12 END
    )
  )
  SELECT
    m.session_log_id,
    m.completed_at,
    m.exercise_log_id,
    m.prescribed_exercise_snapshot,
    sl.id AS set_id,
    sl.set_number,
    sl.set_type,
    sl.reps,
    sl.weight,
    sl.rpe,
    sl.rir,
    sl.distance_meters,
    sl.duration_seconds,
    sl.pace_seconds_per_km,
    sl.split_seconds_per_500m,
    sl.calories,
    sl.cadence,
    sl.stroke_rate,
    sl.resistance,
    sl.heart_rate_zone,
    sl.heart_rate,
    sl.power,
    sl.ftp_percent,
    sl.rest_seconds
  FROM matching m
  JOIN windowed_sessions ws ON ws.session_log_id = m.session_log_id
  LEFT JOIN set_logs sl ON sl.exercise_log_id = m.exercise_log_id
  ORDER BY m.completed_at ASC, m.session_log_id ASC, m.exercise_log_id ASC, sl.set_number ASC NULLS LAST;
$$;

REVOKE EXECUTE ON FUNCTION get_exercise_progression_window(UUID, UUID, TEXT, INT, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION get_exercise_progression_window(UUID, UUID, TEXT, INT, DATE, DATE) TO service_role;

-- -----------------------------------------------------------------------------
-- get_exercise_prs: typed bests (+ p_exclude_dates)
-- -----------------------------------------------------------------------------

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
    ORDER BY s.reps ASC, s.weight DESC, s.completed_at ASC
  ),
  best_reps AS (
    SELECT
      'best_reps'::TEXT AS kind, s.reps, NULL::NUMERIC AS weight, NULL::NUMERIC AS distance_meters, NULL::NUMERIC AS duration_seconds, s.completed_at
    FROM sets s
    WHERE s.reps IS NOT NULL AND (s.weight IS NULL OR s.weight <= 0)
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
