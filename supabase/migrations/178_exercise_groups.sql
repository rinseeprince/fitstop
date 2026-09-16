-- =============================================================================
-- 178: every exercise sits in a group.
--
-- A session is an ordered list of groups; a group is an ordered list of
-- exercises (docs/TRAINING-UPGRADE-EXECUTION-PLAN.md section 4.2). A group has a
-- format - straight sets, superset/circuit, AMRAP, EMOM or For time - and its
-- settings: rounds, time cap, EMOM interval, rest between exercises, rest
-- between rounds, notes. A group with one exercise on straight sets is exactly
-- the exercise the product had before this migration.
--
-- Two tables, mirroring the two tiers of sessions and exercises:
--   coach_saved_exercise_groups - a library session's groups
--   training_exercise_groups    - a client plan's session's groups
--
-- An exercise records its group (group_id) and its position in it
-- (order_index - a group's order_index is its place in the session, an
-- exercise's is its place in its group). The exercise keeps its session id: the
-- foreign key to its group is on (group_id, session id), so an exercise can
-- never sit in another session's group.
--
-- No soft-delete flag on groups. A client exercise is retired by is_active; a
-- group is read through the active exercises that point at it, so a group whose
-- exercises were all retired (the placed-session tray replaces a session's
-- exercises by inserting new rows and retiring the old) is read by nobody and
-- keeps its settings for the retired rows that point at it.
--
-- The backfill makes every existing exercise a straight-sets group of one, in
-- its session's current order - (order_index, id), the order every reader used.
-- Each backfilled group takes its exercise's own id: one group per exercise, so
-- the mapping needs no lookup table. New groups get fresh ids.
--
-- superset_group is dropped from both exercise tables: nothing reads it, and
-- both DEV tables held no value in it on 2026-09-16.
--
-- edit_training_plan_atomic (migration 176) keeps its signature and grants; a
-- session day in p_days now carries "groups", each with its settings and its
-- "exercises", and positions are the elements' places in their arrays.
--
-- Deny-all RLS and explicit grants on the new tables (CONVENTIONS section 8):
-- every reader and writer is service_role.
--
-- Pure ASCII inside the $$ body (the CLI splitter is byte-fragile).
-- =============================================================================

-- 1. The groups tables. Setting bounds mirror lib/training-constants.ts.

CREATE TABLE IF NOT EXISTS public.coach_saved_exercise_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  saved_session_id UUID NOT NULL,
  order_index INTEGER NOT NULL,
  format TEXT NOT NULL,
  rounds INTEGER,
  time_cap_seconds INTEGER,
  interval_seconds INTEGER,
  rest_between_exercises_seconds INTEGER,
  rest_between_rounds_seconds INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT coach_saved_exercise_groups_saved_session_id_fkey
    FOREIGN KEY (saved_session_id) REFERENCES public.coach_saved_sessions(id) ON DELETE CASCADE,
  CONSTRAINT coach_saved_exercise_groups_id_session_key UNIQUE (id, saved_session_id),
  CONSTRAINT coach_saved_exercise_groups_order_index_check CHECK (order_index >= 0),
  CONSTRAINT coach_saved_exercise_groups_format_check
    CHECK (format IN ('straight_sets', 'circuit', 'amrap', 'emom', 'for_time')),
  CONSTRAINT coach_saved_exercise_groups_rounds_check
    CHECK (rounds IS NULL OR rounds BETWEEN 1 AND 100),
  CONSTRAINT coach_saved_exercise_groups_time_cap_check
    CHECK (time_cap_seconds IS NULL OR time_cap_seconds BETWEEN 1 AND 14400),
  CONSTRAINT coach_saved_exercise_groups_interval_check
    CHECK (interval_seconds IS NULL OR interval_seconds BETWEEN 1 AND 3600),
  CONSTRAINT coach_saved_exercise_groups_rest_exercises_check
    CHECK (rest_between_exercises_seconds IS NULL OR rest_between_exercises_seconds BETWEEN 0 AND 3600),
  CONSTRAINT coach_saved_exercise_groups_rest_rounds_check
    CHECK (rest_between_rounds_seconds IS NULL OR rest_between_rounds_seconds BETWEEN 0 AND 3600),
  CONSTRAINT coach_saved_exercise_groups_notes_check
    CHECK (notes IS NULL OR char_length(notes) <= 1000)
);

CREATE TABLE IF NOT EXISTS public.training_exercise_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  order_index INTEGER NOT NULL,
  format TEXT NOT NULL,
  rounds INTEGER,
  time_cap_seconds INTEGER,
  interval_seconds INTEGER,
  rest_between_exercises_seconds INTEGER,
  rest_between_rounds_seconds INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT training_exercise_groups_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES public.training_sessions(id) ON DELETE CASCADE,
  CONSTRAINT training_exercise_groups_id_session_key UNIQUE (id, session_id),
  CONSTRAINT training_exercise_groups_order_index_check CHECK (order_index >= 0),
  CONSTRAINT training_exercise_groups_format_check
    CHECK (format IN ('straight_sets', 'circuit', 'amrap', 'emom', 'for_time')),
  CONSTRAINT training_exercise_groups_rounds_check
    CHECK (rounds IS NULL OR rounds BETWEEN 1 AND 100),
  CONSTRAINT training_exercise_groups_time_cap_check
    CHECK (time_cap_seconds IS NULL OR time_cap_seconds BETWEEN 1 AND 14400),
  CONSTRAINT training_exercise_groups_interval_check
    CHECK (interval_seconds IS NULL OR interval_seconds BETWEEN 1 AND 3600),
  CONSTRAINT training_exercise_groups_rest_exercises_check
    CHECK (rest_between_exercises_seconds IS NULL OR rest_between_exercises_seconds BETWEEN 0 AND 3600),
  CONSTRAINT training_exercise_groups_rest_rounds_check
    CHECK (rest_between_rounds_seconds IS NULL OR rest_between_rounds_seconds BETWEEN 0 AND 3600),
  CONSTRAINT training_exercise_groups_notes_check
    CHECK (notes IS NULL OR char_length(notes) <= 1000)
);

CREATE INDEX IF NOT EXISTS idx_coach_saved_exercise_groups_session
  ON public.coach_saved_exercise_groups (saved_session_id, order_index);
CREATE INDEX IF NOT EXISTS idx_training_exercise_groups_session
  ON public.training_exercise_groups (session_id, order_index);

DROP TRIGGER IF EXISTS coach_saved_exercise_groups_updated_at ON public.coach_saved_exercise_groups;
CREATE TRIGGER coach_saved_exercise_groups_updated_at
  BEFORE UPDATE ON public.coach_saved_exercise_groups
  FOR EACH ROW
  EXECUTE FUNCTION update_training_plan_updated_at();

DROP TRIGGER IF EXISTS training_exercise_groups_updated_at ON public.training_exercise_groups;
CREATE TRIGGER training_exercise_groups_updated_at
  BEFORE UPDATE ON public.training_exercise_groups
  FOR EACH ROW
  EXECUTE FUNCTION update_training_plan_updated_at();

ALTER TABLE IF EXISTS public.coach_saved_exercise_groups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.coach_saved_exercise_groups FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.coach_saved_exercise_groups TO service_role;

ALTER TABLE IF EXISTS public.training_exercise_groups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.training_exercise_groups FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.training_exercise_groups TO service_role;

COMMENT ON TABLE public.coach_saved_exercise_groups IS
  'A library session''s groups, in order (order_index). Every coach_saved_exercises row sits in one, at its order_index. Migration 178.';
COMMENT ON TABLE public.training_exercise_groups IS
  'A client plan session''s groups, in order (order_index). Every training_exercises row sits in one, at its order_index; a group is read through the active exercises that point at it. Migration 178.';

-- 2. Every existing exercise becomes a straight-sets group of one.

ALTER TABLE public.coach_saved_exercises ADD COLUMN IF NOT EXISTS group_id UUID;
ALTER TABLE public.training_exercises ADD COLUMN IF NOT EXISTS group_id UUID;

INSERT INTO public.coach_saved_exercise_groups (id, saved_session_id, order_index, format, created_at, updated_at)
SELECT e.id,
       e.saved_session_id,
       (row_number() OVER (PARTITION BY e.saved_session_id ORDER BY e.order_index, e.id) - 1)::integer,
       'straight_sets',
       e.created_at,
       e.created_at
  FROM public.coach_saved_exercises e
 WHERE e.group_id IS NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.training_exercise_groups (id, session_id, order_index, format, created_at, updated_at)
SELECT e.id,
       e.session_id,
       (row_number() OVER (PARTITION BY e.session_id ORDER BY e.order_index, e.id) - 1)::integer,
       'straight_sets',
       e.created_at,
       e.created_at
  FROM public.training_exercises e
 WHERE e.group_id IS NULL
ON CONFLICT (id) DO NOTHING;

UPDATE public.coach_saved_exercises SET group_id = id, order_index = 0 WHERE group_id IS NULL;
UPDATE public.training_exercises SET group_id = id, order_index = 0 WHERE group_id IS NULL;

ALTER TABLE public.coach_saved_exercises ALTER COLUMN group_id SET NOT NULL;
ALTER TABLE public.training_exercises ALTER COLUMN group_id SET NOT NULL;

ALTER TABLE public.coach_saved_exercises DROP CONSTRAINT IF EXISTS coach_saved_exercises_group_fkey;
ALTER TABLE public.coach_saved_exercises
  ADD CONSTRAINT coach_saved_exercises_group_fkey
  FOREIGN KEY (group_id, saved_session_id)
  REFERENCES public.coach_saved_exercise_groups (id, saved_session_id)
  ON DELETE CASCADE;

ALTER TABLE public.training_exercises DROP CONSTRAINT IF EXISTS training_exercises_group_fkey;
ALTER TABLE public.training_exercises
  ADD CONSTRAINT training_exercises_group_fkey
  FOREIGN KEY (group_id, session_id)
  REFERENCES public.training_exercise_groups (id, session_id)
  ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_coach_saved_exercises_group
  ON public.coach_saved_exercises (group_id, order_index);
CREATE INDEX IF NOT EXISTS idx_training_exercises_group
  ON public.training_exercises (group_id, order_index);

COMMENT ON COLUMN public.coach_saved_exercises.group_id IS
  'The group this exercise sits in; order_index is its position in that group. Migration 178.';
COMMENT ON COLUMN public.training_exercises.group_id IS
  'The group this exercise sits in; order_index is its position in that group. Migration 178.';

-- 3. superset_group goes.

ALTER TABLE public.coach_saved_exercises DROP COLUMN IF EXISTS superset_group;
ALTER TABLE public.training_exercises DROP COLUMN IF EXISTS superset_group;

-- 4. Edit plan's save writes groups.

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
  -- A group holds at least one exercise.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_days) AS d
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(d->'groups') = 'array' THEN d->'groups' ELSE '[]'::jsonb END
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
      -- The day's groups in order, each with its exercises in order: a group's
      -- position is its place in "groups", an exercise's its place in its
      -- group's "exercises".
      WITH day_groups AS (
        SELECT g.value AS body, (g.ordinality - 1)::integer AS position
          FROM jsonb_array_elements(COALESCE(v_day.body->'groups', '[]'::jsonb))
               WITH ORDINALITY AS g(value, ordinality)
      ), new_groups AS (
        INSERT INTO training_exercise_groups (
          session_id, order_index, format, rounds, time_cap_seconds, interval_seconds,
          rest_between_exercises_seconds, rest_between_rounds_seconds, notes
        )
        SELECT v_row, dg.position, x.format, x.rounds, x.time_cap_seconds, x.interval_seconds,
               x.rest_between_exercises_seconds, x.rest_between_rounds_seconds, x.notes
          FROM day_groups dg
          CROSS JOIN LATERAL jsonb_populate_record(NULL::training_exercise_groups, dg.body) AS x
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
        JOIN day_groups dg ON dg.position = ng.order_index
        CROSS JOIN LATERAL jsonb_array_elements(dg.body->'exercises')
             WITH ORDINALITY AS ex(value, ordinality)
        CROSS JOIN LATERAL jsonb_populate_record(NULL::training_exercises, ex.value) AS x;

      -- Keep the day's entry and replace what it holds. Its edited mark stays
      -- only when the day is unchanged (the is_modified on the right is the
      -- row's own, before this update).
      UPDATE training_events
         SET training_plan_id = p_plan_id,
             training_session_id = v_row,
             session_name = v_day.body->>'name',
             session_focus = v_day.body->>'focus',
             estimated_calories = NULL,
             calorie_surplus_percentage = (v_day.body->>'calorie_surplus_percentage')::numeric,
             is_modified = CASE
               WHEN (v_day.body->>'unchanged')::boolean IS TRUE THEN is_modified
               ELSE false
             END,
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
  'Edit plan''s save: rewrites a placed program from its first editable day in one transaction - each session day''s groups and their exercises in order - refusing when the calendar changed since the editor opened; a day saved unchanged keeps its edited mark. Called only by services/plan-edit-service.ts.';
