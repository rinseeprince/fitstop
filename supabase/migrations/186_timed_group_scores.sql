-- =============================================================================
-- Migration 186: a timed group's score on the workout's log
-- (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md sections 4.2 and 4.5, commit 14)
--
-- An AMRAP scores rounds plus extra reps. A For time scores its finish time,
-- or the rounds and reps reached when the time cap ran out. An EMOM takes no
-- score: it logs its rows like any round-based group (owner, 2026-09-19). A
-- score is stored as that group's result on the workout's log: one row per
-- scored group, under session_logs.
--
-- The row keeps the group it scores (group_id, SET NULL on delete - the same
-- shape as exercise_logs.training_exercise_id) and a snapshot of the group's
-- settings as they were when the client scored it, so a scored group whose
-- exercises the client never ticked still describes itself once the session
-- is gone. The snapshot is the nine-key group snapshot every exercise
-- snapshot already carries (services/training-log-service.ts, GroupSnapshot).
--
-- Two shapes and nothing else: a finish time alone (a For time finished
-- inside its cap), or rounds and reps together (an AMRAP, or a For time that
-- was capped). The format the snapshot records decides which shapes the row
-- may take; utils/group-scores.ts is the same rule in the app, and its test
-- reads this file for the bounds.
--
-- Deny-all RLS and explicit grants (CONVENTIONS section 8): every reader and
-- writer is service_role. Clear log needs no change: the row cascades from
-- its session log, as exercise_logs do.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.session_log_group_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_log_id UUID NOT NULL,
  group_id UUID,
  prescribed_group_snapshot JSONB NOT NULL,
  rounds INTEGER,
  reps INTEGER,
  finish_seconds NUMERIC(7,1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT session_log_group_scores_session_log_id_fkey
    FOREIGN KEY (session_log_id) REFERENCES public.session_logs(id) ON DELETE CASCADE,
  CONSTRAINT session_log_group_scores_group_id_fkey
    FOREIGN KEY (group_id) REFERENCES public.training_exercise_groups(id) ON DELETE SET NULL,
  CONSTRAINT session_log_group_scores_rounds_check
    CHECK (rounds IS NULL OR rounds BETWEEN 0 AND 1000),
  CONSTRAINT session_log_group_scores_reps_check
    CHECK (reps IS NULL OR reps BETWEEN 0 AND 1000),
  CONSTRAINT session_log_group_scores_finish_check
    CHECK (finish_seconds IS NULL OR finish_seconds BETWEEN 0.1 AND 86400),
  -- A finish time alone, or rounds and reps together.
  CONSTRAINT session_log_group_scores_shape_check
    CHECK (
      (finish_seconds IS NOT NULL AND rounds IS NULL AND reps IS NULL)
      OR (finish_seconds IS NULL AND rounds IS NOT NULL AND reps IS NOT NULL)
    ),
  -- Only an AMRAP or a For time takes a score, and only a For time a time.
  CONSTRAINT session_log_group_scores_format_check
    CHECK (prescribed_group_snapshot->>'format' IN ('amrap', 'for_time')),
  CONSTRAINT session_log_group_scores_time_format_check
    CHECK (finish_seconds IS NULL OR prescribed_group_snapshot->>'format' = 'for_time')
);

CREATE INDEX IF NOT EXISTS idx_session_log_group_scores_log
  ON public.session_log_group_scores (session_log_id);
CREATE UNIQUE INDEX IF NOT EXISTS session_log_group_scores_log_group_key
  ON public.session_log_group_scores (session_log_id, group_id)
  WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_session_log_group_scores_group
  ON public.session_log_group_scores (group_id)
  WHERE group_id IS NOT NULL;

DROP TRIGGER IF EXISTS session_log_group_scores_updated_at ON public.session_log_group_scores;
CREATE TRIGGER session_log_group_scores_updated_at
  BEFORE UPDATE ON public.session_log_group_scores
  FOR EACH ROW
  EXECUTE FUNCTION update_training_plan_updated_at();

ALTER TABLE IF EXISTS public.session_log_group_scores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.session_log_group_scores FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.session_log_group_scores TO service_role;

COMMENT ON TABLE public.session_log_group_scores IS
  'A timed group''s score on a workout''s log, one row per scored group: rounds plus reps (an AMRAP, or a capped For time) or a finish time (a For time finished inside its cap). group_id is the client group scored, SET NULL when it goes; prescribed_group_snapshot is the group''s settings as logged. Written only by services/training-log-group-scores.ts; cascades with its session log. Migration 186.';
COMMENT ON COLUMN public.session_log_group_scores.finish_seconds IS
  'A For time''s finish time in seconds, to a tenth; typed and read as a duration (m:ss, h:mm:ss). Null when the group was capped or is an AMRAP.';
COMMENT ON COLUMN public.session_log_group_scores.rounds IS
  'Rounds completed: an AMRAP''s score, or how far a capped For time got. Null when a For time finished.';
COMMENT ON COLUMN public.session_log_group_scores.reps IS
  'Reps beyond the last full round (0 when none). Always beside rounds.';
