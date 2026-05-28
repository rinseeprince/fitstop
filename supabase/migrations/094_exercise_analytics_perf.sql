-- =============================================================================
-- Migration 094: Exercise analytics perf — keyset index + read RPCs
--
-- Pushes the three exercise-analytics aggregations (list / progression-window /
-- PRs) into SQL so reads are bounded by the result, not by career history.
-- Replaces the unbounded fetchExerciseLogsForClient pattern in
-- services/exercise-analytics-service.ts.
--
-- Deliberate deviation from project precedent (e.g. 067 transition_phase_atomic):
-- these are read RPCs taking an arbitrary p_client_id, so they use
-- SECURITY INVOKER (not DEFINER) and explicit REVOKE/GRANT to close the
-- PostgREST cross-client IDOR surface. The all-DEFINER precedent applies to
-- atomic-write RPCs that need to bypass RLS; that rationale does not apply here.
-- Flagged per Phase-3 "deviation wins, flag it in the session" rule.
--
-- LANGUAGE sql STABLE on all three — pure reads, no control flow. Do not inherit
-- plpgsql by copy-paste from 067 (which needs plpgsql for atomic-write branches).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Index: session-grain keyset ordering
-- Extends 067's (client_id, completed_at DESC) with an id DESC tiebreak so cursor
-- reads are stable when two sessions share completed_at. Supersedes the 067 index
-- for reads; both kept here — the 2-col one is dropped in a future tech-debt sweep.
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_session_logs_client_completed_id
  ON session_logs(client_id, completed_at DESC, id DESC);

-- -----------------------------------------------------------------------------
-- RPC 1: get_client_exercise_list
-- Aggregates all exercises a client has logged, grouped by the dual-identity
-- COALESCE(el.exercise_id, te.exercise_id, LOWER(performed_name)). Returns one
-- row per distinct exercise with log_count, last_logged_date, and the
-- most-recent performed_name (or 'Unknown exercise' fallback for true-NULL
-- legacy rows). Ordered by log_count DESC, name ASC for stable output.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_client_exercise_list(p_client_id UUID)
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

REVOKE EXECUTE ON FUNCTION get_client_exercise_list(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_client_exercise_list(UUID) TO service_role;

-- -----------------------------------------------------------------------------
-- RPC 2: get_exercise_progression_window
-- Returns flat exercise_log × set_log rows for the most-recent-N sessions
-- matching the target exercise (identity-union: el.exercise_id, te.exercise_id,
-- or LOWER(performed_name) fallback). JS regroups and runs per-set math.
--
-- LIMIT COALESCE(p_session_count, 12) is load-bearing: SQL DEFAULT 12 only fires
-- when the parameter is omitted at the call site, but supabase-js sends explicit
-- null for undefined keys, and LIMIT NULL is unbounded — the silent regression
-- this clause exists to prevent.
--
-- LEFT JOIN set_logs preserves exercise_logs with zero sets (matches today's JS).
-- Final ORDER BY is deterministic for downstream group iteration.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_exercise_progression_window(
  p_client_id UUID,
  p_exercise_id UUID DEFAULT NULL,
  p_exercise_name TEXT DEFAULT NULL,
  p_session_count INT DEFAULT 12
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
  ),
  windowed_sessions AS (
    SELECT m.session_log_id, MIN(m.completed_at) AS completed_at
    FROM matching m
    GROUP BY m.session_log_id
    ORDER BY MIN(m.completed_at) DESC, m.session_log_id DESC
    LIMIT COALESCE(p_session_count, 12)
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

REVOKE EXECUTE ON FUNCTION get_exercise_progression_window(UUID, UUID, TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_exercise_progression_window(UUID, UUID, TEXT, INT) TO service_role;

-- -----------------------------------------------------------------------------
-- RPC 3: get_exercise_prs
-- Returns best weight per distinct rep count for a target exercise, in reps ASC.
-- isRecent (28-day flag) is computed JS-side.
--
-- completed_at ASC on tied weights: PR date conventionally means *first
-- achieved*. Today's JS keeps the first-encountered set's date on ties
-- (strict-greater-than) — ASC is the closest behavior-preserving tiebreak.
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
    AND sl.reps IS NOT NULL
    AND sl.weight IS NOT NULL
    AND sl.weight > 0
    AND (
      (p_exercise_id IS NOT NULL AND (el.exercise_id = p_exercise_id OR te.exercise_id = p_exercise_id))
      OR (p_exercise_name IS NOT NULL AND LOWER(el.performed_name) = LOWER(p_exercise_name))
    )
  ORDER BY sl.reps ASC, sl.weight DESC, slg.completed_at ASC;
$$;

REVOKE EXECUTE ON FUNCTION get_exercise_prs(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_exercise_prs(UUID, UUID, TEXT) TO service_role;
