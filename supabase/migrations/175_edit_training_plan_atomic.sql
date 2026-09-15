-- =============================================================================
-- 175: Edit plan's save, in one transaction.
--
-- The plan editor opens a client's program as it is laid on the calendar, and
-- whatever the coach leaves in it becomes the plan from the first day that can
-- still change. This function is that save. Its only caller,
-- services/plan-edit-service.ts, decides the days:
--   * p_first_day - the first editable day: the client's deletion floor (their
--     today, or tomorrow once they have logged a workout today), never before
--     the plan's start.
--   * p_last_day - the plan's new last day: the editor's weeks, capped at the
--     block, the next block or the next plan; never before p_first_day - 1.
--   * p_days - one entry per day from p_first_day to p_last_day, every day
--     present exactly once.
--   * p_version - what the editor was built from: the plan row's updated_at,
--     every event it read from its first editable day on (the days `from` to
--     `through`), and every session row those events point at.
--
-- In order:
--   1. Lock the plan, every event the save may touch and the rows it read.
--   2. Refuse with stale: when anything the editor was built from changed -
--      the plan row, an event (added, removed, moved, re-pointed, logged or
--      re-priced) or a session row - or when a day from p_first_day on has
--      been logged since the caller read the floor.
--   3. Every day gets a fresh session row (rest days too: the plan keeps one
--      row per day). A session day KEEPS the scheduled event already on its
--      date and replaces what it holds - same id, so a client halfway through
--      logging today keeps their entry - or gets a new event; a rest day loses
--      its scheduled event. Nothing written here keeps the edited mark.
--   4. Scheduled events after p_last_day, up to the old last day, are deleted:
--      the plan got shorter.
--   5. The plan's old rows from the first editable day on are retired, except
--      a row that any event or session log still points at (a logged swap, a
--      coach's duplicate).
--   6. The plan row takes its new end, name, focus, week count and frequency.
--
-- Error contract (message prefixes the caller maps): not_found:, stale:,
-- invalid:. The live-window exclusion (23P01) and the one-scheduled-per-day
-- index (23505) can still fire on a race, and the caller treats both as stale.
--
-- Pure ASCII inside the $$ body (the CLI splitter is byte-fragile).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.edit_training_plan_atomic(
  p_client_id UUID,
  p_plan_id UUID,
  p_first_day DATE,
  p_last_day DATE,
  p_name TEXT,
  p_split_type TEXT,
  p_program_duration_weeks INTEGER,
  p_frequency_per_week INTEGER,
  p_days JSONB,
  p_version JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan RECORD;
  v_seen_from DATE := (p_version->>'from')::date;
  v_seen_through DATE := (p_version->>'through')::date;
  v_lock_through DATE;
  v_first_position INTEGER;
  v_day RECORD;
  v_row UUID;
  v_event UUID;
  v_new_rows UUID[] := '{}';
  v_count INTEGER;
  v_events_kept INTEGER := 0;
  v_events_added INTEGER := 0;
  v_events_removed INTEGER := 0;
  v_rows_retired INTEGER := 0;
BEGIN
  SELECT id, effective_from, effective_until, updated_at
    INTO v_plan
    FROM training_plans
   WHERE id = p_plan_id
     AND client_id = p_client_id
     AND deleted_at IS NULL
     AND status <> 'archived'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: plan % is not a live plan of this client', p_plan_id;
  END IF;

  IF p_first_day < v_plan.effective_from OR p_last_day < p_first_day - 1 THEN
    RAISE EXCEPTION 'invalid: first day %, last day % for a plan starting %',
      p_first_day, p_last_day, v_plan.effective_from;
  END IF;
  IF p_days IS NULL OR jsonb_typeof(p_days) <> 'array'
     OR v_seen_from IS NULL OR v_seen_through IS NULL THEN
    RAISE EXCEPTION 'invalid: p_days must be an array and p_version must name the days it read';
  END IF;
  -- Every day from p_first_day to p_last_day, each once (the loop below
  -- refuses a day outside the range).
  IF jsonb_array_length(p_days) <> GREATEST(p_last_day - p_first_day + 1, 0)
     OR jsonb_array_length(p_days) <> (
       SELECT count(DISTINCT d->>'date') FROM jsonb_array_elements(p_days) AS d
     ) THEN
    RAISE EXCEPTION 'invalid: p_days must hold each day from % to % once', p_first_day, p_last_day;
  END IF;

  -- 1. Everything the save may touch or compare, locked.
  v_lock_through := GREATEST(p_last_day, v_plan.effective_until, v_seen_through);
  PERFORM 1
    FROM training_events
   WHERE client_id = p_client_id
     AND date BETWEEN LEAST(p_first_day, v_seen_from) AND v_lock_through
   FOR UPDATE;
  PERFORM 1
    FROM training_sessions
   WHERE id IN (
     SELECT x.id FROM jsonb_populate_recordset(NULL::training_sessions, p_version->'sessions') AS x
   )
   FOR UPDATE;

  -- 2. What the editor was built from is still what is there.
  IF v_plan.updated_at IS DISTINCT FROM (p_version->>'plan_updated_at')::timestamptz THEN
    RAISE EXCEPTION 'stale: the plan changed since the editor opened';
  END IF;

  IF EXISTS (
    (SELECT e.id, e.date, e.training_session_id, e.status, e.calorie_surplus_percentage
       FROM training_events e
      WHERE e.client_id = p_client_id
        AND e.date BETWEEN v_seen_from AND v_seen_through
     EXCEPT
     SELECT x.id, x.date, x.training_session_id, x.status, x.calorie_surplus_percentage
       FROM jsonb_populate_recordset(NULL::training_events, p_version->'events') AS x)
    UNION ALL
    (SELECT x.id, x.date, x.training_session_id, x.status, x.calorie_surplus_percentage
       FROM jsonb_populate_recordset(NULL::training_events, p_version->'events') AS x
     EXCEPT
     SELECT e.id, e.date, e.training_session_id, e.status, e.calorie_surplus_percentage
       FROM training_events e
      WHERE e.client_id = p_client_id
        AND e.date BETWEEN v_seen_from AND v_seen_through)
  ) THEN
    RAISE EXCEPTION 'stale: the calendar changed since the editor opened';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_populate_recordset(NULL::training_sessions, p_version->'sessions') AS x
      LEFT JOIN training_sessions s ON s.id = x.id
     WHERE s.id IS NULL
        OR s.updated_at IS DISTINCT FROM x.updated_at
  ) THEN
    RAISE EXCEPTION 'stale: a session changed since the editor opened';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM training_events
     WHERE client_id = p_client_id
       AND status <> 'scheduled'
       AND date BETWEEN p_first_day AND v_lock_through
  ) THEN
    RAISE EXCEPTION 'stale: a day from % on has been logged', p_first_day;
  END IF;

  -- 3. The days.
  v_first_position := p_first_day - v_plan.effective_from;

  FOR v_day IN
    SELECT (d->>'date')::date AS day,
           COALESCE((d->>'is_rest')::boolean, false) AS is_rest,
           d AS body
      FROM jsonb_array_elements(p_days) AS d
     ORDER BY 1
  LOOP
    IF v_day.day < p_first_day OR v_day.day > p_last_day THEN
      RAISE EXCEPTION 'invalid: day % is outside % to %', v_day.day, p_first_day, p_last_day;
    END IF;

    -- The day's position in the plan: week_index * 7 + order_index % 7 is the
    -- day every placed row sits on, and this row sits on it the same way.
    INSERT INTO training_sessions (
      plan_id, name, focus, notes, day_of_week, week_index, order_index,
      is_rest, estimated_duration_minutes, calorie_surplus_percentage, is_active
    ) VALUES (
      p_plan_id,
      CASE WHEN v_day.is_rest THEN 'Rest' ELSE v_day.body->>'name' END,
      CASE WHEN v_day.is_rest THEN NULL ELSE v_day.body->>'focus' END,
      CASE WHEN v_day.is_rest THEN NULL ELSE v_day.body->>'notes' END,
      NULL,
      (v_day.day - v_plan.effective_from) / 7,
      v_day.day - v_plan.effective_from,
      v_day.is_rest,
      CASE WHEN v_day.is_rest THEN NULL ELSE (v_day.body->>'estimated_duration_minutes')::integer END,
      CASE WHEN v_day.is_rest THEN NULL ELSE (v_day.body->>'calorie_surplus_percentage')::numeric END,
      true
    )
    RETURNING id INTO v_row;
    v_new_rows := v_new_rows || v_row;

    IF v_day.is_rest THEN
      DELETE FROM training_events
       WHERE client_id = p_client_id
         AND date = v_day.day
         AND status = 'scheduled';
      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_events_removed := v_events_removed + v_count;
    ELSE
      INSERT INTO training_exercises (
        session_id, name, exercise_id, order_index, sets, reps_min, reps_max,
        reps_target, rpe_target, percentage_1rm, tempo, rest_seconds, notes,
        superset_group, is_warmup, set_specs, video_url, prescribed_fields, is_active
      )
      SELECT v_row, x.name, x.exercise_id, x.order_index, x.sets, x.reps_min, x.reps_max,
             x.reps_target, x.rpe_target, x.percentage_1rm, x.tempo, x.rest_seconds, x.notes,
             x.superset_group, COALESCE(x.is_warmup, false), x.set_specs, x.video_url,
             x.prescribed_fields, true
        FROM jsonb_populate_recordset(
               NULL::training_exercises,
               COALESCE(v_day.body->'exercises', '[]'::jsonb)
             ) AS x;

      -- Keep the day's entry and replace what it holds.
      UPDATE training_events
         SET training_plan_id = p_plan_id,
             training_session_id = v_row,
             session_name = v_day.body->>'name',
             session_focus = v_day.body->>'focus',
             estimated_calories = NULL,
             calorie_surplus_percentage = (v_day.body->>'calorie_surplus_percentage')::numeric,
             is_modified = false,
             updated_at = now()
       WHERE client_id = p_client_id
         AND date = v_day.day
         AND status = 'scheduled'
      RETURNING id INTO v_event;
      IF FOUND THEN
        v_events_kept := v_events_kept + 1;
      ELSE
        INSERT INTO training_events (
          client_id, training_plan_id, training_session_id, date, session_name,
          session_focus, estimated_calories, calorie_surplus_percentage, status, is_modified
        ) VALUES (
          p_client_id, p_plan_id, v_row, v_day.day, v_day.body->>'name',
          v_day.body->>'focus', NULL, (v_day.body->>'calorie_surplus_percentage')::numeric,
          'scheduled', false
        );
        v_events_added := v_events_added + 1;
      END IF;
    END IF;
  END LOOP;

  -- 4. The plan got shorter: its days after the new last day are cleared.
  DELETE FROM training_events
   WHERE client_id = p_client_id
     AND status = 'scheduled'
     AND date > p_last_day
     AND date >= p_first_day
     AND date <= v_plan.effective_until;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_events_removed := v_events_removed + v_count;

  -- 5. The rows the new ones replace, unless a day or a log still uses them.
  UPDATE training_sessions s
     SET is_active = false,
         updated_at = now()
   WHERE s.plan_id = p_plan_id
     AND s.is_active
     AND NOT (s.id = ANY (v_new_rows))
     AND s.week_index * 7 + s.order_index % 7 >= v_first_position
     AND NOT EXISTS (
       SELECT 1
         FROM training_events e
        WHERE e.client_id = p_client_id
          AND e.training_session_id = s.id
     )
     AND NOT EXISTS (
       SELECT 1
         FROM session_logs l
        WHERE l.training_session_id = s.id
     );
  GET DIAGNOSTICS v_rows_retired = ROW_COUNT;

  -- 6. The plan row.
  UPDATE training_plans
     SET effective_until = p_last_day,
         name = p_name,
         split_type = p_split_type,
         program_duration_weeks = p_program_duration_weeks,
         frequency_per_week = p_frequency_per_week,
         updated_at = now()
   WHERE id = p_plan_id;

  RETURN jsonb_build_object(
    'rows_created', COALESCE(array_length(v_new_rows, 1), 0),
    'events_kept', v_events_kept,
    'events_added', v_events_added,
    'events_removed', v_events_removed,
    'rows_retired', v_rows_retired
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.edit_training_plan_atomic(UUID, UUID, DATE, DATE, TEXT, TEXT, INTEGER, INTEGER, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.edit_training_plan_atomic(UUID, UUID, DATE, DATE, TEXT, TEXT, INTEGER, INTEGER, JSONB, JSONB) TO service_role;

COMMENT ON FUNCTION public.edit_training_plan_atomic(UUID, UUID, DATE, DATE, TEXT, TEXT, INTEGER, INTEGER, JSONB, JSONB) IS
  'Edit plan''s save: rewrites a placed program from its first editable day in one transaction, refusing when the calendar changed since the editor opened. Called only by services/plan-edit-service.ts.';
