-- =============================================================================
-- 212_delete_account_key_indexes.sql -- an index on every foreign key a deleted
-- account's cascades walk (docs/BETTER-AUTH-PLAN.md section 6 commit 6, owner's
-- go 2026-10-09).
--
-- Migration 211's two functions delete an account's rows in one statement each,
-- and Postgres then runs, for every deleted row, one lookup per foreign key
-- that points at its table: a CASCADE deletes the rows pointing at it, a SET
-- NULL clears their key, a NO ACTION checks none is left. A key with no index
-- led by its column makes each of those lookups a scan of the whole table,
-- every tenant's rows included. On DEV, deleting a seed coach with twenty
-- clients took 14.9 s this way, and the app calls the functions through the
-- Data API, which cancels a statement after 8 s; with these indexes, 2.8 s.
-- CONVENTIONS section 8: indexes on foreign keys.
--
-- 1. The sixteen indexes: each key below had no index led by its column on DEV
--    (2026-10-09), and every one sits on a table a coach's or a client's
--    deletion reaches.
-- 2. A closing check: every foreign key into a table the deletion reaches (the
--    tables a coach's row cascades to, at any depth) has an index led by its
--    first column.
--
-- Additive. Re-runnable. Pure ASCII.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The indexes.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_attention_dismissals_client_id ON public.attention_dismissals (client_id);
CREATE INDEX IF NOT EXISTS idx_check_in_exercise_highlights_exercise_id ON public.check_in_exercise_highlights (exercise_id);
CREATE INDEX IF NOT EXISTS idx_check_in_form_questions_question_id ON public.check_in_form_questions (question_id);
CREATE INDEX IF NOT EXISTS idx_check_in_reminders_check_in_id ON public.check_in_reminders (check_in_id);
CREATE INDEX IF NOT EXISTS idx_client_notes_coach_id ON public.client_notes (coach_id);
CREATE INDEX IF NOT EXISTS idx_coach_client_views_client_id ON public.coach_client_views (client_id);
CREATE INDEX IF NOT EXISTS idx_content_assignments_assigned_by ON public.content_assignments (assigned_by);
CREATE INDEX IF NOT EXISTS idx_exercise_logs_exercise_id ON public.exercise_logs (exercise_id);
CREATE INDEX IF NOT EXISTS idx_exercise_logs_training_exercise_id ON public.exercise_logs (training_exercise_id);
CREATE INDEX IF NOT EXISTS idx_nutrition_logs_nutrition_plan_id ON public.nutrition_logs (nutrition_plan_id);
CREATE INDEX IF NOT EXISTS idx_nutrition_plan_kept_goals_kept_by ON public.nutrition_plan_kept_goals (kept_by);
CREATE INDEX IF NOT EXISTS idx_nutrition_plans_coach_id ON public.nutrition_plans (coach_id);
CREATE INDEX IF NOT EXISTS idx_training_events_session_log_id ON public.training_events (session_log_id);
CREATE INDEX IF NOT EXISTS idx_training_events_training_session_id ON public.training_events (training_session_id);
CREATE INDEX IF NOT EXISTS idx_training_plans_coach_id ON public.training_plans (coach_id);
CREATE INDEX IF NOT EXISTS idx_training_plans_saved_plan_id ON public.training_plans (saved_plan_id);

-- ---------------------------------------------------------------------------
-- 2. Closing check.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  missing text;
BEGIN
  WITH RECURSIVE reach(tbl) AS (
    SELECT 'public.coaches'::regclass
    UNION
    SELECT c.conrelid::regclass
      FROM pg_constraint c
      JOIN reach r ON c.confrelid = r.tbl
     WHERE c.contype = 'f' AND c.confdeltype = 'c'
  )
  SELECT string_agg(format('%s.%s', c.conrelid::regclass, a.attname), ', ')
    INTO missing
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
   WHERE c.contype = 'f'
     AND c.confrelid IN (SELECT tbl FROM reach)
     AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1]);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 212: a foreign key a deleted account''s cascades walk has no index led by its column: %', missing;
  END IF;
END $$;
