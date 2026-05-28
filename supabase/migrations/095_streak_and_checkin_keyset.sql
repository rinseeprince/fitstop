-- =============================================================================
-- Migration 095: Read-path perf — streak gaps-and-islands RPC + check-in keyset index
--
-- (1) get_client_streak: replaces the 365-day daily_logs_full *view* fetch
--     (20+ cols, 3-way LEFT JOIN, ~200 KB) + O(D²) JS loop in
--     services/daily-logs-service.ts calculateStreaks with a single bounded
--     index-only scan over daily_logs(client_id, date) returning two ints.
--
--     Follows the 094 precedent: read RPC taking an arbitrary p_client_id, so
--     SECURITY INVOKER (not DEFINER) + explicit REVOKE/GRANT to close the
--     PostgREST cross-client IDOR surface. LANGUAGE sql STABLE — pure read.
--
--     p_today / p_start_date are PARAMETERS (not CURRENT_DATE / interval math):
--     "today" and the 365-day window must be computed by the caller via
--     getTodayDateString() / getDateDaysAgo(365) (server-local), since Postgres
--     CURRENT_DATE resolves in the DB session tz (UTC) and could be off by a day.
--     No SQL DEFAULTs: supabase-js sends explicit null for undefined keys, so a
--     DEFAULT would never fire — the caller always passes both dates explicitly.
--
--     BEHAVIOR CHANGE (bugfix, flagged in session 3.7): the current streak is the
--     run ending today or yesterday, else 0. The prior JS (calculateStreakFromLogs)
--     had a latent bug where a leading gap did not reset "current", so it reported
--     the first logged run found scanning backward — e.g. a single log 5 days ago
--     yielded current=1. The SQL rule below is the correct definition; the JS
--     oracle is fixed to match.
--
-- (2) idx_check_ins_client_created_id: keyset ordering for the CLIENT check-ins
--     list (created_at DESC, id DESC tiebreak), serving the cursor predicate
--     `client_id = ? AND (created_at,id) < (?,?) ORDER BY created_at DESC, id DESC`
--     as an index range scan. The existing idx_check_ins_client_status
--     (client_id, status, created_at DESC) stays for status-filtered coach reads.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- RPC: get_client_streak
-- gaps-and-islands: consecutive logged dates share (d - row_number()) as a group
-- key. longest = max run length in the window; current = the run whose end is
-- p_today or p_today-1 (mirrors "start today, else yesterday"), else 0.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_client_streak(
  p_client_id UUID,
  p_today DATE,
  p_start_date DATE
)
RETURNS TABLE (
  current_streak INT,
  longest_streak INT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH days AS (
    -- daily_logs has UNIQUE(client_id, date); DISTINCT is belt-and-braces.
    SELECT DISTINCT date AS d
    FROM daily_logs
    WHERE client_id = p_client_id
      AND date >= p_start_date
      AND date <= p_today
  ),
  islands AS (
    SELECT d, d - (ROW_NUMBER() OVER (ORDER BY d))::int AS grp
    FROM days
  ),
  runs AS (
    SELECT COUNT(*)::int AS run_len, MAX(d) AS run_end
    FROM islands
    GROUP BY grp
  )
  SELECT
    COALESCE(
      (SELECT run_len FROM runs
        WHERE run_end IN (p_today, p_today - 1)
        ORDER BY run_end DESC
        LIMIT 1),
      0
    )::int AS current_streak,
    COALESCE((SELECT MAX(run_len) FROM runs), 0)::int AS longest_streak;
$$;

REVOKE EXECUTE ON FUNCTION get_client_streak(UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_client_streak(UUID, DATE, DATE) TO service_role;

-- -----------------------------------------------------------------------------
-- Index: client check-ins keyset (created_at DESC, id DESC)
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_check_ins_client_created_id
  ON check_ins(client_id, created_at DESC, id DESC);
