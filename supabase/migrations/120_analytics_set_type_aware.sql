-- =============================================================================
-- Migration 120: Set-type-aware exercise analytics (Training Builder S1)
--
-- Threads the new set_logs.set_type (migration 119) through the analytics RPCs
-- so the service can exclude warm-ups from volume/compliance and treat
-- AMRAP/failure/drop sets correctly. In Phase 1 every real set_log is 'working'
-- (the column default), so prod behaviour is unchanged until the Phase 2 builder
-- lets a coach prescribe set types; the JS mapper is proven now with synthetic
-- mixed-type unit tests.
--
-- get_exercise_progression_window: the RETURNS TABLE shape changes (adds
-- set_type), which forbids CREATE OR REPLACE -> DROP by the CURRENT live 6-arg
-- signature (migration 103's body over migration 102's identity), then recreate
-- and re-issue the grant lockdown (grants drop with the function). Body is
-- byte-identical to migration 103 apart from the added set_type column in the
-- RETURNS TABLE and the final SELECT. The LEFT JOIN set_logs is preserved
-- (zero-set exercise_logs still emit one row) -- warm-up filtering happens in the
-- service, not here, so it does not drop those rows.
--
-- get_exercise_prs: signature and RETURNS are UNCHANGED, so this is a true
-- CREATE OR REPLACE (grants preserved, no DROP). The only change is a warm-up
-- exclusion in the WHERE -- a warm-up set must never register as a PR.
--
-- LANGUAGE sql STABLE / SECURITY INVOKER / SET search_path = public carried
-- verbatim from 094/102/103. Pure ASCII inside the $$ bodies.
-- =============================================================================

DROP FUNCTION IF EXISTS get_exercise_progression_window(UUID, UUID, TEXT, INT, DATE, DATE);
-- plain DROP, NO CASCADE -- called only from the service via PostgREST, no DB
-- dependents. If a DROP errors on a dependency, STOP and investigate.

-- -----------------------------------------------------------------------------
-- get_exercise_progression_window (+ set_type)
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
  reps INT,
  weight NUMERIC,
  rpe NUMERIC,
  set_type TEXT
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
    sl.reps,
    sl.weight,
    sl.rpe,
    sl.set_type
  FROM matching m
  JOIN windowed_sessions ws ON ws.session_log_id = m.session_log_id
  LEFT JOIN set_logs sl ON sl.exercise_log_id = m.exercise_log_id
  ORDER BY m.completed_at ASC, m.session_log_id ASC, m.exercise_log_id ASC, sl.set_number ASC NULLS LAST;
$$;

REVOKE EXECUTE ON FUNCTION get_exercise_progression_window(UUID, UUID, TEXT, INT, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION get_exercise_progression_window(UUID, UUID, TEXT, INT, DATE, DATE) TO service_role;

-- -----------------------------------------------------------------------------
-- get_exercise_prs (+ warm-up exclusion) -- signature/RETURNS unchanged
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_exercise_prs(
  p_client_id UUID,
  p_exercise_id UUID DEFAULT NULL,
  p_exercise_name TEXT DEFAULT NULL
)
RETURNS TABLE (
  reps INT,
  weight NUMERIC,
  date TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT ON (sl.reps)
    sl.reps,
    sl.weight,
    slg.completed_at AS date
  FROM exercise_logs el
  JOIN session_logs slg ON slg.id = el.session_log_id
  LEFT JOIN training_exercises te ON te.id = el.training_exercise_id
  JOIN set_logs sl ON sl.exercise_log_id = el.id
  WHERE slg.client_id = p_client_id
    AND sl.reps IS NOT NULL AND sl.weight IS NOT NULL AND sl.weight > 0
    AND sl.set_type <> 'warmup'
    AND (
      (p_exercise_id IS NOT NULL AND (el.exercise_id = p_exercise_id OR te.exercise_id = p_exercise_id))
      OR (p_exercise_name IS NOT NULL AND LOWER(el.performed_name) = LOWER(p_exercise_name))
    )
  ORDER BY sl.reps ASC, sl.weight DESC, slg.completed_at ASC;
$$;

REVOKE EXECUTE ON FUNCTION get_exercise_prs(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION get_exercise_prs(UUID, UUID, TEXT) TO service_role;
