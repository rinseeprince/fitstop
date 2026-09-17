-- =============================================================================
-- 181: a client clears a workout log they did not mean to save.
--
-- There is no skip any more (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md, §4.7 M4):
-- a save with nothing logged is refused, so "I did not do this after all" is an
-- explicit act rather than an empty log that locks the day. Clearing a log puts
-- the workout back exactly where it was before the client logged it - still
-- scheduled, nothing recorded - so it can be logged again, and its day reads
-- missed once it has passed.
--
-- Two tables in one transaction, so a cleared workout can never be left
-- half-linked:
--   1. Lock the workout, scoped to its client. A foreign or missing id is
--      not_found: and nothing is written.
--   2. Delete the log keyed to it - by the event's own link and by the log's
--      back-reference, which are the same row unless a half-failed link left
--      one side behind. exercise_logs cascade from session_logs and set_logs
--      from exercise_logs, so the sets go with it.
--   3. The workout goes back to scheduled with no link.
--
-- The day rule is the caller's (services/daily-log-permissions-service.ts):
-- a client clears a log exactly where they may edit the day, and the route
-- answers 403 otherwise, as the log write does.
--
-- Error contract (message prefixes the caller maps): not_found:.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.clear_training_event_log(
  p_client_id UUID,
  p_event_id  UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_log_id UUID;
  v_deleted        INTEGER := 0;
BEGIN
  SELECT session_log_id
    INTO v_session_log_id
    FROM training_events
   WHERE id = p_event_id
     AND client_id = p_client_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found:%', p_event_id;
  END IF;

  WITH removed AS (
    DELETE FROM session_logs
     WHERE client_id = p_client_id
       AND (id = v_session_log_id OR training_event_id = p_event_id)
    RETURNING id
  )
  SELECT count(*) INTO v_deleted FROM removed;

  -- Always written, even with no log to delete: a workout marked completed
  -- whose log went missing is exactly the state this puts right.
  UPDATE training_events
     SET session_log_id = NULL,
         status = 'scheduled',
         updated_at = now()
   WHERE id = p_event_id;

  RETURN jsonb_build_object('cleared', v_deleted > 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.clear_training_event_log(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_training_event_log(UUID, UUID) TO service_role;

COMMENT ON FUNCTION public.clear_training_event_log(UUID, UUID) IS
  'Clear a client''s workout log: delete the session_log keyed to the training_event (its exercise_logs and set_logs cascade) and put the event back to scheduled with no link, in one transaction. Called only by services/training-log-service.ts; the day rule is the caller''s.';
