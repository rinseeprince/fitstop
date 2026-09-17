-- =============================================================================
-- 180: programs are written with several sessions a day.
--
-- A coach builds a program with several sessions on a day - a morning run and
-- an evening lift - and placing it lays each day's sessions on that date in
-- order.
--
--   1. coach_saved_sessions.day_order and training_sessions.day_order: a
--      session's place among the sessions on its day of the program, 0 first.
--      A day of a program is its (week_index, order_index): the rows sharing
--      one are that day's sessions, read in (day_order, id) order, and a rest
--      day is one rest row, alone on its day. Rows already sharing a day are
--      numbered by the calendar entry that points at them, then by when they
--      were written, so every such day reads in a fixed order.
--   2. training_plans.frequency_per_week keeps its floor of one and loses its
--      ceiling of seven: a week can hold more than seven sessions.
--   3. edit_training_plan_atomic (migration 179) writes each session row at
--      its place in the day, as it already writes the calendar entry's.
--
-- Pure ASCII inside the $$ bodies (the CLI splitter is byte-fragile).
-- =============================================================================

-- 1. A session's place on its day.

ALTER TABLE public.coach_saved_sessions
  ADD COLUMN IF NOT EXISTS day_order INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.coach_saved_sessions DROP CONSTRAINT IF EXISTS coach_saved_sessions_day_order_check;
ALTER TABLE public.coach_saved_sessions
  ADD CONSTRAINT coach_saved_sessions_day_order_check CHECK (day_order >= 0);

UPDATE public.coach_saved_sessions s
   SET day_order = ranked.position
  FROM (
    SELECT id,
           (row_number() OVER (
              PARTITION BY saved_plan_id, week_index, order_index
              ORDER BY created_at, id
            ) - 1)::integer AS position
      FROM public.coach_saved_sessions
     WHERE saved_plan_id IS NOT NULL
  ) AS ranked
 WHERE s.id = ranked.id
   AND ranked.position > 0
   AND s.day_order <> ranked.position;

COMMENT ON COLUMN public.coach_saved_sessions.day_order IS
  'The session''s place among the sessions on its day of the program, 0 first. A day is (week_index, order_index); its rows read in (day_order, id) order, and a rest row is alone on its day. 0 for a standalone session. Migration 180.';

ALTER TABLE public.training_sessions
  ADD COLUMN IF NOT EXISTS day_order INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.training_sessions DROP CONSTRAINT IF EXISTS training_sessions_day_order_check;
ALTER TABLE public.training_sessions
  ADD CONSTRAINT training_sessions_day_order_check CHECK (day_order >= 0);

UPDATE public.training_sessions s
   SET day_order = ranked.position
  FROM (
    SELECT t.id,
           (row_number() OVER (
              PARTITION BY t.plan_id, t.week_index, t.order_index
              ORDER BY (
                SELECT min(e.day_order)
                  FROM public.training_events e
                 WHERE e.training_session_id = t.id
              ) NULLS LAST, t.created_at, t.id
            ) - 1)::integer AS position
      FROM public.training_sessions t
     WHERE t.is_active
  ) AS ranked
 WHERE s.id = ranked.id
   AND ranked.position > 0
   AND s.day_order <> ranked.position;

COMMENT ON COLUMN public.training_sessions.day_order IS
  'The session''s place among the sessions on its day of the placed program, 0 first. A day is (week_index, order_index); its live rows read in (day_order, id) order, and a rest row is alone on its day. Placement copies the program''s order; Edit plan''s save writes each day''s. Migration 180.';

-- 2. A week can hold more than seven sessions.

ALTER TABLE public.training_plans DROP CONSTRAINT IF EXISTS training_plans_frequency_per_week_check;
ALTER TABLE public.training_plans
  ADD CONSTRAINT training_plans_frequency_per_week_check CHECK (frequency_per_week >= 1);

-- 3. Edit plan's save writes each session row at its place in the day.

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
  v_session RECORD;
  v_row UUID;
  v_event UUID;
  v_new_rows UUID[] := '{}';
  v_claims UUID[];
  v_open UUID[];
  v_next_open INTEGER;
  v_day_kept UUID[];
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
  -- refuses a day outside the range), each carrying its sessions as a list.
  IF jsonb_array_length(p_days) <> GREATEST(p_last_day - p_first_day + 1, 0)
     OR jsonb_array_length(p_days) <> (
       SELECT count(DISTINCT d->>'date') FROM jsonb_array_elements(p_days) AS d
     ) THEN
    RAISE EXCEPTION 'invalid: p_days must hold each day from % to % once', p_first_day, p_last_day;
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_days) AS d
     WHERE jsonb_typeof(d->'sessions') IS DISTINCT FROM 'array'
  ) THEN
    RAISE EXCEPTION 'invalid: every day must carry its sessions as a list';
  END IF;
  -- A group holds at least one exercise.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_days) AS d
      CROSS JOIN LATERAL jsonb_array_elements(d->'sessions') AS s
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(s->'groups') = 'array' THEN s->'groups' ELSE '[]'::jsonb END
      ) AS g
     WHERE CASE WHEN jsonb_typeof(g->'exercises') = 'array'
                THEN jsonb_array_length(g->'exercises') = 0
                ELSE true END
  ) THEN
    RAISE EXCEPTION 'invalid: every group must hold at least one exercise';
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
    (SELECT e.id, e.date, e.day_order, e.training_session_id, e.status, e.calorie_surplus_percentage
       FROM training_events e
      WHERE e.client_id = p_client_id
        AND e.date BETWEEN v_seen_from AND v_seen_through
     EXCEPT
     SELECT x.id, x.date, x.day_order, x.training_session_id, x.status, x.calorie_surplus_percentage
       FROM jsonb_populate_recordset(NULL::training_events, p_version->'events') AS x)
    UNION ALL
    (SELECT x.id, x.date, x.day_order, x.training_session_id, x.status, x.calorie_surplus_percentage
       FROM jsonb_populate_recordset(NULL::training_events, p_version->'events') AS x
     EXCEPT
     SELECT e.id, e.date, e.day_order, e.training_session_id, e.status, e.calorie_surplus_percentage
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
           d->'sessions' AS sessions
      FROM jsonb_array_elements(p_days) AS d
     ORDER BY 1
  LOOP
    IF v_day.day < p_first_day OR v_day.day > p_last_day THEN
      RAISE EXCEPTION 'invalid: day % is outside % to %', v_day.day, p_first_day, p_last_day;
    END IF;

    -- A rest day: its row, and nothing left on the calendar.
    IF jsonb_array_length(v_day.sessions) = 0 THEN
      INSERT INTO training_sessions (
        plan_id, name, focus, notes, day_of_week, week_index, order_index, day_order,
        is_rest, estimated_duration_minutes, calorie_surplus_percentage, is_active
      ) VALUES (
        p_plan_id, 'Rest', NULL, NULL, NULL,
        (v_day.day - v_plan.effective_from) / 7,
        v_day.day - v_plan.effective_from,
        0,
        true, NULL, NULL, true
      )
      RETURNING id INTO v_row;
      v_new_rows := v_new_rows || v_row;

      DELETE FROM training_events
       WHERE client_id = p_client_id
         AND date = v_day.day
         AND status = 'scheduled';
      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_events_removed := v_events_removed + v_count;
      CONTINUE;
    END IF;

    -- Which calendar entry each session keeps: the entry it was opened from,
    -- when that entry is on this day and no earlier session kept it.
    v_claims := '{}';
    FOR v_session IN
      SELECT s.value AS body
        FROM jsonb_array_elements(v_day.sessions) WITH ORDINALITY AS s(value, ordinality)
       ORDER BY s.ordinality
    LOOP
      SELECT e.id
        INTO v_event
        FROM training_events e
       WHERE e.client_id = p_client_id
         AND e.date = v_day.day
         AND e.status = 'scheduled'
         AND e.id = (v_session.body->>'event_id')::uuid
         AND NOT (e.id = ANY (v_claims));
      IF FOUND THEN
        v_claims := array_append(v_claims, v_event);
      ELSE
        v_claims := array_append(v_claims, NULL::uuid);
      END IF;
    END LOOP;

    -- The day's entries no session named, in the day's order: the other
    -- sessions take them in turn.
    SELECT COALESCE(array_agg(e.id ORDER BY e.day_order, e.id), '{}')
      INTO v_open
      FROM training_events e
     WHERE e.client_id = p_client_id
       AND e.date = v_day.day
       AND e.status = 'scheduled'
       AND NOT (e.id = ANY (array_remove(v_claims, NULL)));
    v_next_open := 1;
    v_day_kept := '{}';

    FOR v_session IN
      SELECT s.value AS body, s.ordinality::integer AS position
        FROM jsonb_array_elements(v_day.sessions) WITH ORDINALITY AS s(value, ordinality)
       ORDER BY s.ordinality
    LOOP
      -- The day's position in the plan: week_index * 7 + order_index % 7 is the
      -- day every placed row sits on, and this row sits on it the same way, at
      -- its place in the day.
      INSERT INTO training_sessions (
        plan_id, name, focus, notes, day_of_week, week_index, order_index, day_order,
        is_rest, estimated_duration_minutes, calorie_surplus_percentage, is_active
      ) VALUES (
        p_plan_id,
        v_session.body->>'name',
        v_session.body->>'focus',
        v_session.body->>'notes',
        NULL,
        (v_day.day - v_plan.effective_from) / 7,
        v_day.day - v_plan.effective_from,
        v_session.position - 1,
        false,
        (v_session.body->>'estimated_duration_minutes')::integer,
        (v_session.body->>'calorie_surplus_percentage')::numeric,
        true
      )
      RETURNING id INTO v_row;
      v_new_rows := v_new_rows || v_row;

      -- The session's groups in order, each with its exercises in order: a
      -- group's position is its place in "groups", an exercise's its place in
      -- its group's "exercises".
      WITH session_groups AS (
        SELECT g.value AS body, (g.ordinality - 1)::integer AS position
          FROM jsonb_array_elements(COALESCE(v_session.body->'groups', '[]'::jsonb))
               WITH ORDINALITY AS g(value, ordinality)
      ), new_groups AS (
        INSERT INTO training_exercise_groups (
          session_id, order_index, format, rounds, time_cap_seconds, interval_seconds,
          rest_between_exercises_seconds, rest_between_rounds_seconds, notes
        )
        SELECT v_row, sg.position, x.format, x.rounds, x.time_cap_seconds, x.interval_seconds,
               x.rest_between_exercises_seconds, x.rest_between_rounds_seconds, x.notes
          FROM session_groups sg
          CROSS JOIN LATERAL jsonb_populate_record(NULL::training_exercise_groups, sg.body) AS x
        RETURNING id, order_index
      )
      INSERT INTO training_exercises (
        session_id, group_id, order_index, name, exercise_id, sets, reps_min, reps_max,
        reps_target, rpe_target, percentage_1rm, tempo, rest_seconds, notes,
        is_warmup, set_specs, video_url, prescribed_fields, is_active
      )
      SELECT v_row, ng.id, (ex.ordinality - 1)::integer, x.name, x.exercise_id, x.sets,
             x.reps_min, x.reps_max, x.reps_target, x.rpe_target, x.percentage_1rm, x.tempo,
             x.rest_seconds, x.notes, COALESCE(x.is_warmup, false), x.set_specs, x.video_url,
             x.prescribed_fields, true
        FROM new_groups ng
        JOIN session_groups sg ON sg.position = ng.order_index
        CROSS JOIN LATERAL jsonb_array_elements(sg.body->'exercises')
             WITH ORDINALITY AS ex(value, ordinality)
        CROSS JOIN LATERAL jsonb_populate_record(NULL::training_exercises, ex.value) AS x;

      v_event := v_claims[v_session.position];
      IF v_event IS NOT NULL THEN
        -- The entry the session was opened from: its edited mark stays only
        -- when the session is unchanged (the is_modified on the right is the
        -- row's own, before this update).
        UPDATE training_events
           SET training_plan_id = p_plan_id,
               training_session_id = v_row,
               session_name = v_session.body->>'name',
               session_focus = v_session.body->>'focus',
               estimated_calories = NULL,
               calorie_surplus_percentage = (v_session.body->>'calorie_surplus_percentage')::numeric,
               day_order = v_session.position - 1,
               is_modified = CASE
                 WHEN (v_session.body->>'unchanged')::boolean IS TRUE THEN is_modified
                 ELSE false
               END,
               updated_at = now()
         WHERE id = v_event;
        v_events_kept := v_events_kept + 1;
      ELSIF v_next_open <= COALESCE(array_length(v_open, 1), 0) THEN
        -- Another of the day's entries, now holding this session.
        v_event := v_open[v_next_open];
        v_next_open := v_next_open + 1;
        UPDATE training_events
           SET training_plan_id = p_plan_id,
               training_session_id = v_row,
               session_name = v_session.body->>'name',
               session_focus = v_session.body->>'focus',
               estimated_calories = NULL,
               calorie_surplus_percentage = (v_session.body->>'calorie_surplus_percentage')::numeric,
               day_order = v_session.position - 1,
               is_modified = false,
               updated_at = now()
         WHERE id = v_event;
        v_events_kept := v_events_kept + 1;
      ELSE
        INSERT INTO training_events (
          client_id, training_plan_id, training_session_id, date, day_order, session_name,
          session_focus, estimated_calories, calorie_surplus_percentage, status, is_modified
        ) VALUES (
          p_client_id, p_plan_id, v_row, v_day.day, v_session.position - 1,
          v_session.body->>'name', v_session.body->>'focus', NULL,
          (v_session.body->>'calorie_surplus_percentage')::numeric, 'scheduled', false
        )
        RETURNING id INTO v_event;
        v_events_added := v_events_added + 1;
      END IF;
      v_day_kept := v_day_kept || v_event;
    END LOOP;

    -- The day's entries no session kept: the coach removed their sessions.
    DELETE FROM training_events
     WHERE client_id = p_client_id
       AND date = v_day.day
       AND status = 'scheduled'
       AND NOT (id = ANY (v_day_kept));
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_events_removed := v_events_removed + v_count;
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
  'Edit plan''s save: rewrites a placed program from its first editable day in one transaction - every session of a day in order, its row and its calendar entry both at its place in the day, each with its groups and their exercises in order - refusing when the calendar changed since the editor opened; a session keeps the calendar entry it was opened from, and its edited mark when unchanged. Called only by services/plan-edit-service.ts.';
