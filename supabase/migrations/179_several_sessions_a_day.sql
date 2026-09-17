-- =============================================================================
-- 179: a day can hold several sessions.
--
-- Any day on a client's calendar can hold several sessions, in order, each its
-- own workout - a morning run and an evening lift. Nothing refuses a day for
-- already holding one, and moving a session onto such a day adds it there,
-- after the sessions already on it.
--
--   1. The one-scheduled-session-per-day index (migration 136) is dropped. It
--      said so itself: a launch-scope rule, to go when several sessions a day
--      ship.
--   2. training_events.day_order: a session's place among the client's
--      sessions on its date, 0 first. Readers order a day by (day_order, id).
--      Existing days are numbered by when their sessions were written, so every
--      day already holding two reads in a fixed order.
--   3. move_training_events_atomic (migration 150) - the client's week and the
--      coach's calendar drag - no longer refuses a day that holds a session, or
--      two moves onto one day. A moved session joins its new day after the
--      sessions staying there; several moving onto one day land in the order
--      the list gives them.
--   4. move_training_plan_atomic (migration 177) - a program's start-date move
--      - no longer refuses a day that holds a session. A day a session lands on
--      keeps the sessions already there first; the program's sessions follow
--      in the order they held on their own day.
--   5. edit_training_plan_atomic (migration 178) - Edit plan's save - writes
--      every session of a day, in order. Each day of p_days carries its
--      sessions (an empty list is a rest day), and each session may name the
--      calendar entry it was opened from (event_id). A session keeps that entry
--      when it is still on the session's day - same id, so a client halfway
--      through logging it keeps their entry, and its edited mark stays when the
--      session is unchanged; the day's other sessions take the day's remaining
--      entries in order (their marks cleared); a session left over gets a new
--      entry and an entry left over goes. Every entry the day keeps takes its
--      session's place as its day_order. The version the editor was built from
--      now includes each entry's day_order.
--
-- Both move functions keep their park-then-place: training_events is still
-- unique on (client_id, training_session_id, date), which a single shifting
-- UPDATE could trip half way through.
--
-- Pure ASCII inside the $$ bodies (the CLI splitter is byte-fragile).
-- =============================================================================

-- 1. The one-per-day rule goes.

DROP INDEX IF EXISTS public.idx_training_events_one_scheduled_per_day;

-- 2. The order within a day.

ALTER TABLE public.training_events
  ADD COLUMN IF NOT EXISTS day_order INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.training_events DROP CONSTRAINT IF EXISTS training_events_day_order_check;
ALTER TABLE public.training_events
  ADD CONSTRAINT training_events_day_order_check CHECK (day_order >= 0);

UPDATE public.training_events e
   SET day_order = ranked.position
  FROM (
    SELECT id,
           (row_number() OVER (PARTITION BY client_id, date ORDER BY created_at, id) - 1)::integer
             AS position
      FROM public.training_events
  ) AS ranked
 WHERE e.id = ranked.id
   AND ranked.position > 0
   AND e.day_order <> ranked.position;

COMMENT ON COLUMN public.training_events.day_order IS
  'The session''s place among the client''s sessions on its date, 0 first; readers order a day by (day_order, id). A session moved onto a day joins it after the sessions already there (move_training_events_atomic, move_training_plan_atomic); Edit plan''s save writes each day''s order; a session dropped from the library joins its day last. Migration 179.';

-- 3. The client's week and the coach's drag.

CREATE OR REPLACE FUNCTION public.move_training_events_atomic(
  p_client_id UUID,
  p_moves JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_move  RECORD;
  v_event RECORD;
  v_ids   UUID[];
BEGIN
  IF p_moves IS NULL
     OR jsonb_typeof(p_moves) <> 'array'
     OR jsonb_array_length(p_moves) = 0 THEN
    RAISE EXCEPTION 'invalid_moves: p_moves must be a non-empty array';
  END IF;

  SELECT array_agg((m->>'event_id')::uuid)
    INTO v_ids
    FROM jsonb_array_elements(p_moves) AS m;

  IF (SELECT count(*) FROM unnest(v_ids) AS i)
     <> (SELECT count(DISTINCT i) FROM unnest(v_ids) AS i) THEN
    RAISE EXCEPTION 'duplicate_event: an event appears twice';
  END IF;

  -- Lock every moving row and verify it. A foreign row is reported as
  -- not_found, never as "someone else's".
  FOR v_move IN
    SELECT (m->>'event_id')::uuid AS event_id,
           (m->>'from_date')::date AS from_date,
           (m->>'to_date')::date   AS to_date
      FROM jsonb_array_elements(p_moves) AS m
  LOOP
    SELECT id, client_id, date, status
      INTO v_event
      FROM training_events
     WHERE id = v_move.event_id
     FOR UPDATE;

    IF NOT FOUND OR v_event.client_id <> p_client_id THEN
      RAISE EXCEPTION 'not_found: event % is not this client''s', v_move.event_id;
    END IF;
    IF v_event.status <> 'scheduled' THEN
      RAISE EXCEPTION 'not_scheduled: event % has left the scheduled state', v_move.event_id;
    END IF;
    IF v_event.date <> v_move.from_date THEN
      RAISE EXCEPTION 'drift: event % is on %, not %',
        v_move.event_id, v_event.date, v_move.from_date;
    END IF;
  END LOOP;

  -- Park: every moving row leaves its day for a date of its own far outside
  -- any real calendar, so no row collides on (client, session, date) on the
  -- way and the days a session lands on hold only the sessions staying there.
  UPDATE training_events e
     SET date = DATE '2999-01-01' + m.ord::int
    FROM (
      SELECT (x->>'event_id')::uuid AS event_id, ord
        FROM jsonb_array_elements(p_moves) WITH ORDINALITY AS t(x, ord)
    ) AS m
   WHERE e.id = m.event_id;

  -- Place: a moved session joins its new day after every session already
  -- there, the moves landing on one day in the order the list gives them.
  -- is_modified drives the calendar card's edited badge; it is not a write
  -- predicate.
  UPDATE training_events e
     SET date        = m.to_date,
         day_order   = COALESCE(staying.last_order, -1) + m.arrival,
         is_modified = true,
         updated_at  = now()
    FROM (
      SELECT (x->>'event_id')::uuid AS event_id,
             (x->>'to_date')::date  AS to_date,
             row_number() OVER (PARTITION BY (x->>'to_date')::date ORDER BY ord)::integer
               AS arrival
        FROM jsonb_array_elements(p_moves) WITH ORDINALITY AS t(x, ord)
    ) AS m
    LEFT JOIN LATERAL (
      SELECT max(s.day_order) AS last_order
        FROM training_events s
       WHERE s.client_id = p_client_id
         AND s.date = m.to_date
    ) AS staying ON true
   WHERE e.id = m.event_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.move_training_events_atomic(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_training_events_atomic(UUID, JSONB) TO service_role;

COMMENT ON FUNCTION public.move_training_events_atomic(UUID, JSONB) IS
  'Move N still-scheduled training events in one transaction; each joins its new day after the sessions already there, several onto one day in list order. Called by services/training-event-layout-service.ts (the client''s week) and services/training-event-calendar-service.ts (the coach''s drag).';

-- 4. A program's start-date move.

CREATE OR REPLACE FUNCTION public.move_training_plan_atomic(
  p_client_id UUID,
  p_plan_id UUID,
  p_starts_on DATE,
  p_floor DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- A park far before any real calendar (about 700 BC); every parked date stays
  -- distinct because every session moves by the same offset.
  c_park CONSTANT INTEGER := 1000000;
  v_plan RECORD;
  v_shift INTEGER;
  v_from DATE;
  v_until DATE;
  v_other RECORD;
  v_block RECORD;
  v_moved INTEGER := 0;
BEGIN
  IF p_starts_on IS NULL OR p_floor IS NULL THEN
    RAISE EXCEPTION 'invalid: a new start and the floor are required';
  END IF;

  SELECT id, effective_from, effective_until
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

  IF v_plan.effective_from < p_floor THEN
    RAISE EXCEPTION 'started: the program started on %', v_plan.effective_from;
  END IF;
  IF p_starts_on < p_floor THEN
    RAISE EXCEPTION 'before_floor:%', p_floor;
  END IF;

  v_shift := p_starts_on - v_plan.effective_from;
  IF v_shift = 0 THEN
    RETURN jsonb_build_object(
      'starts_on', v_plan.effective_from,
      'ends_on', v_plan.effective_until,
      'sessions_moved', 0
    );
  END IF;
  v_from := v_plan.effective_from + v_shift;
  v_until := v_plan.effective_until + v_shift;

  -- 1. Every day the move reads or writes, locked.
  PERFORM 1
    FROM training_events
   WHERE client_id = p_client_id
     AND date BETWEEN LEAST(v_plan.effective_from, v_from)
                  AND GREATEST(v_plan.effective_until, v_until)
   FOR UPDATE;

  -- 2. The refusals.
  IF EXISTS (
    SELECT 1
      FROM training_events
     WHERE client_id = p_client_id
       AND date BETWEEN v_plan.effective_from AND v_plan.effective_until
       AND status <> 'scheduled'
  ) THEN
    RAISE EXCEPTION 'started: a day of the program has been logged';
  END IF;

  SELECT name
    INTO v_other
    FROM training_plans
   WHERE client_id = p_client_id
     AND id <> p_plan_id
     AND deleted_at IS NULL
     AND status <> 'archived'
     AND effective_from <= v_until
     AND effective_until >= v_from
   ORDER BY effective_from
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'overlap:%', v_other.name;
  END IF;

  -- A block the new dates meet without holding them whole: they cross its
  -- start when they begin before it, else its end.
  SELECT name, starts_on
    INTO v_block
    FROM client_phases
   WHERE client_id = p_client_id
     AND archived_at IS NULL
     AND starts_on <= v_until
     AND ends_on >= v_from
     AND NOT (starts_on <= v_from AND ends_on >= v_until)
   ORDER BY starts_on
   LIMIT 1;
  IF FOUND THEN
    IF v_block.starts_on > v_from THEN
      RAISE EXCEPTION 'block:start:%', v_block.name;
    END IF;
    RAISE EXCEPTION 'block:end:%', v_block.name;
  END IF;

  -- 3. The window.
  UPDATE training_plans
     SET effective_from = v_from,
         effective_until = v_until,
         updated_at = now()
   WHERE id = p_plan_id;

  -- 4. Park, then place. A day a session lands on keeps the sessions already
  --    there first; the program's sessions follow them in the order they held
  --    on their own day.
  UPDATE training_events
     SET date = date - c_park
   WHERE client_id = p_client_id
     AND date BETWEEN v_plan.effective_from AND v_plan.effective_until;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  UPDATE training_events e
     SET date = parked.date + c_park + v_shift,
         day_order = COALESCE(held.last_order, -1) + parked.arrival,
         updated_at = now()
    FROM (
      SELECT id,
             date,
             row_number() OVER (PARTITION BY date ORDER BY day_order, id)::integer AS arrival
        FROM training_events
       WHERE client_id = p_client_id
         AND date BETWEEN v_plan.effective_from - c_park AND v_plan.effective_until - c_park
    ) AS parked
    LEFT JOIN LATERAL (
      SELECT max(h.day_order) AS last_order
        FROM training_events h
       WHERE h.client_id = p_client_id
         AND h.date = parked.date + c_park + v_shift
    ) AS held ON true
   WHERE e.id = parked.id;

  RETURN jsonb_build_object(
    'starts_on', v_from,
    'ends_on', v_until,
    'sessions_moved', v_moved
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.move_training_plan_atomic(UUID, UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_training_plan_atomic(UUID, UUID, DATE, DATE) TO service_role;

COMMENT ON FUNCTION public.move_training_plan_atomic(UUID, UUID, DATE, DATE) IS
  'Move a program that has not started to a new start date: its window and every session between its start and end shift by the same number of days in one transaction, joining any day they land on after the sessions already there, refusing a start before the floor, an overlap or a block edge. Called only by services/training-plan-move-service.ts.';

-- 5. Edit plan's save writes every session of a day.

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
        plan_id, name, focus, notes, day_of_week, week_index, order_index,
        is_rest, estimated_duration_minutes, calorie_surplus_percentage, is_active
      ) VALUES (
        p_plan_id, 'Rest', NULL, NULL, NULL,
        (v_day.day - v_plan.effective_from) / 7,
        v_day.day - v_plan.effective_from,
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
      -- day every placed row sits on, and this row sits on it the same way.
      INSERT INTO training_sessions (
        plan_id, name, focus, notes, day_of_week, week_index, order_index,
        is_rest, estimated_duration_minutes, calorie_surplus_percentage, is_active
      ) VALUES (
        p_plan_id,
        v_session.body->>'name',
        v_session.body->>'focus',
        v_session.body->>'notes',
        NULL,
        (v_day.day - v_plan.effective_from) / 7,
        v_day.day - v_plan.effective_from,
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
  'Edit plan''s save: rewrites a placed program from its first editable day in one transaction - every session of a day in order, each with its groups and their exercises in order - refusing when the calendar changed since the editor opened; a session keeps the calendar entry it was opened from, and its edited mark when unchanged. Called only by services/plan-edit-service.ts.';
