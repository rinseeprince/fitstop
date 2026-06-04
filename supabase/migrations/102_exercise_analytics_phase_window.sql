-- =============================================================================
-- Migration 102: Exercise analytics — optional date window (Session 7.7)
--
-- Adds optional date bounds (p_start_date / p_end_date) to two of the three
-- migration-094 analytics RPCs so the coach client-metrics page can scope the
-- exercise-progression charts to a Program / Phase / relative window. One
-- time-scope control (Session 7.5) drives BOTH the body/wellness charts and
-- these exercise charts — same resolved window, two chart families.
--
-- Why DROP + CREATE (not CREATE OR REPLACE): adding parameters changes the
-- function's argument-type list, which Postgres treats as a *different* function
-- identity. CREATE OR REPLACE cannot alter the signature, and leaving the old
-- 4-arg / 1-arg versions in place alongside the new ones would make the
-- named-arg PostgREST calls an ambiguous overload. The REVOKE/GRANT must be
-- re-issued because grants are dropped with the function.
--
-- get_exercise_prs is intentionally LEFT UNTOUCHED: PRs stay all-time (Session 1.9).
--
-- Window semantics — half-open range, NOT a `::date` cast, so the predicate
-- stays sargable against idx_session_logs_client_completed_id and the (+1 day)
-- upper bound is end-day-inclusive for free:
--   completed_at >= p_start_date
--   completed_at <  (p_end_date + INTERVAL '1 day')
--
-- Window-aware LIMIT (progression only): the 12-session recency floor applies
-- ONLY all-time. A date window already bounds the result by that one exercise's
-- logs in the window (≈≤100 even for a year-long program), so it must NOT be
-- re-capped at 12 — otherwise a phase chart silently truncates to 12.
--   LIMIT COALESCE(
--     p_session_count,
--     CASE WHEN p_start_date IS NULL AND p_end_date IS NULL THEN 12 END
--   )
--   - all-time, no count → COALESCE(NULL, 12)   = 12   (recency cap preserved)
--   - all-time, count=N  → COALESCE(N, …)        = N    (explicit cap)
--   - windowed, no count → COALESCE(NULL, NULL)  = NULL → unbounded within window
-- The matching service change (p_session_count ?? null) ships in the same commit;
-- SQL alone (service still sending 12) would leave every phase chart capped at 12.
--
-- LANGUAGE sql STABLE / SECURITY INVOKER / REVOKE-then-GRANT-service_role are
-- carried verbatim from migration 094; everything outside the window additions
-- is byte-identical to 094.
-- =============================================================================

DROP FUNCTION IF EXISTS get_exercise_progression_window(UUID, UUID, TEXT, INT);
DROP FUNCTION IF EXISTS get_client_exercise_list(UUID);
-- plain DROP, NO CASCADE — these RPCs have no DB-level dependents (called only
-- from the service via PostgREST). If a DROP errors on a dependency, STOP and
-- investigate; do not add CASCADE.

-- -----------------------------------------------------------------------------
-- RPC 1: get_client_exercise_list (+ optional date window)
-- 094 body verbatim, plus the two date-bound predicates in the `resolved` CTE.
-- No LIMIT here (distinct exercises are naturally bounded), so no cap change.
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
  last_logged_date TIMESTAMPTZ
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
  )
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
  ORDER BY log_count DESC, name ASC;
$$;

REVOKE EXECUTE ON FUNCTION get_client_exercise_list(UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_client_exercise_list(UUID, DATE, DATE) TO service_role;

-- -----------------------------------------------------------------------------
-- RPC 2: get_exercise_progression_window (+ optional date window + window-aware cap)
-- 094 body verbatim, plus the two date-bound predicates in the `matching` CTE
-- and the conditional LIMIT in `windowed_sessions`.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_exercise_progression_window(
  p_client_id UUID,
  p_exercise_id UUID DEFAULT NULL,
  p_exercise_name TEXT DEFAULT NULL,
  p_session_count INT DEFAULT 12,
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

REVOKE EXECUTE ON FUNCTION get_exercise_progression_window(UUID, UUID, TEXT, INT, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_exercise_progression_window(UUID, UUID, TEXT, INT, DATE, DATE) TO service_role;
