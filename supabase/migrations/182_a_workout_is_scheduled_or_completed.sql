-- =============================================================================
-- 182: a workout is scheduled or completed, and a log is full or partial.
--
-- The last of the completion commits (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md,
-- §4.7 M1/M2/M4). `training_events.status` stored two facts in one word -
-- whether the client logged the workout, and how much of the prescription they
-- did - so every reader had to know that two of its five values meant yes, and
-- the same week read 4/5 on one screen and 5/5 on the next. From here the
-- column answers ONE question: has the client logged this workout.
--
--   1. The empty logs go. A `skipped` log is an absence of work dressed as a
--      record, and it locked a day the client might later want to backfill.
--      "I did not do this after all" is Clear log (migration 181). The
--      training_events.session_log_id FK is ON DELETE SET NULL, so deleting
--      them unlinks their workouts; exercise_logs cascade from session_logs and
--      set_logs from exercise_logs, so nothing is orphaned. Probed on dev
--      2026-09-18: 2 rows, both carrying no exercise rows.
--   2. `partial` becomes `completed` - a partly completed workout was still
--      done, and how it went is on its log.
--   3. `skipped` and `missed` become `scheduled` - nothing has written either
--      for some time, and a workout nobody logged is one still to be done,
--      which its own date already reads as missed. A row of either still
--      holding a log after step 1 is a logged workout and reads `completed`
--      instead, so the link and the status cannot disagree.
--   4. The two CHECKs shrink to what the product writes. `completed` with no
--      log is left exactly as it is: 227 rows on dev, logged before the link
--      existed, and a workout done at a quality nobody wrote down is a full
--      one.
--
-- session_logs' CHECK still carries the table's pre-rename name, so it is
-- dropped by that name AND by the name it takes here, and the push stays
-- re-runnable. training_events carries no trigger, so the updates stamp
-- updated_at themselves.
-- =============================================================================

-- 1. The empty logs.
DELETE FROM public.session_logs
 WHERE completion_quality = 'skipped';

-- 2. A partly completed workout is a workout the client did.
UPDATE public.training_events
   SET status = 'completed',
       updated_at = now()
 WHERE status = 'partial';

-- 3. A workout nobody logged is still to be done.
UPDATE public.training_events
   SET status = CASE WHEN session_log_id IS NULL THEN 'scheduled' ELSE 'completed' END,
       updated_at = now()
 WHERE status IN ('skipped', 'missed');

-- 4. The words the product can store.
ALTER TABLE public.training_events
  DROP CONSTRAINT IF EXISTS training_events_status_check;
ALTER TABLE public.training_events
  ADD CONSTRAINT training_events_status_check
  CHECK (status IN ('scheduled', 'completed'));

ALTER TABLE public.session_logs
  DROP CONSTRAINT IF EXISTS client_session_completions_completion_quality_check;
ALTER TABLE public.session_logs
  DROP CONSTRAINT IF EXISTS session_logs_completion_quality_check;
ALTER TABLE public.session_logs
  ADD CONSTRAINT session_logs_completion_quality_check
  CHECK (completion_quality IN ('full', 'partial'));

COMMENT ON COLUMN public.training_events.status IS
  'Whether the client has LOGGED this workout, and nothing else. scheduled = not logged; completed = logged, at any quality. How the workout went is session_logs.completion_quality on the log this row links to - never this column. missed is not stored: a workout still scheduled on a day that has passed is missed, judged on the reading surface''s own calendar. Written with the link, in one statement (services/training-event-service.ts), and cleared back to scheduled by clear_training_event_log.';

COMMENT ON COLUMN public.session_logs.completion_quality IS
  'How the logged workout went. full = every prescribed working set on every exercise was recorded; partial = anything short of that. Warm-ups count on neither side. Server-derived at save from the sets the client sent against the session''s own prescription (utils/completion-quality.ts); the client''s own value is honoured only on a payload carrying no exercises. It never says whether the workout was logged - the linked training_events.status does. NULL on a row written before the column existed, which reads as full.';
