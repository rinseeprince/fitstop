-- =============================================================================
-- Migration 103: get_exercise_progression_window — p_session_count DEFAULT NULL
--
-- Supersedes migration 102's `p_session_count INT DEFAULT 12`. With DEFAULT 12,
-- a caller that OMITS the param (supabase-js drops undefined keys) gets 12 even
-- inside a date window — the window-aware COALESCE never sees NULL, so windowed
-- charts silently re-cap at 12. Setting the default to NULL makes
--   LIMIT COALESCE(p_session_count, CASE WHEN p_start_date IS NULL AND p_end_date IS NULL THEN 12 END)
-- the SOLE floor:
--   - no count, no window  → COALESCE(NULL, 12)   = 12   (recency cap)
--   - no count, date window → COALESCE(NULL, NULL) = NULL → uncapped within window
--   - explicit count N      → COALESCE(N, …)        = N
--
-- This lets the service OMIT the param (pass `undefined`) instead of sending an
-- explicit JSON null — which removes the need for a gen-types `["Args"]` cast in
-- services/exercise-analytics-service.ts (supabase gen-types can't express that a
-- DEFAULTed RPC param also accepts null). p_session_count now matches its sibling
-- optional params (p_exercise_id / p_exercise_name / p_start_date / p_end_date),
-- which are all DEFAULT NULL + omitted-when-absent.
--
-- This is a true CREATE OR REPLACE, NOT a DROP: the six-arg signature
-- (UUID, UUID, TEXT, INT, DATE, DATE) is UNCHANGED — only the default value of
-- p_session_count changes. Same identity → existing REVOKE/GRANT privileges are
-- preserved, so no DROP and no re-issued grants. The body is byte-identical to
-- migration 102's get_exercise_progression_window apart from that one default.
--
-- get_client_exercise_list is untouched: its date params are already DEFAULT NULL
-- (migration 102), so the service already omits them cast-free.
-- =============================================================================

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
  rpe NUMERIC
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
    sl.rpe
  FROM matching m
  JOIN windowed_sessions ws ON ws.session_log_id = m.session_log_id
  LEFT JOIN set_logs sl ON sl.exercise_log_id = m.exercise_log_id
  ORDER BY m.completed_at ASC, m.session_log_id ASC, m.exercise_log_id ASC, sl.set_number ASC NULLS LAST;
$$;
