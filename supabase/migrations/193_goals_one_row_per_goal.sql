-- =============================================================================
-- 193_goals_one_row_per_goal.sql -- a goal is ONE ROW, dated
-- (docs/MEASUREMENT-LOG-PLAN.md §6 commit 8d; owner decisions 2026-09-22).
--
-- A goal is a name, a type, optional targets, an optional description and a
-- start day. It runs until the next goal starts, so no end is stored: goals
-- can neither overlap nor leave a gap. A planned goal is a row dated ahead,
-- invisible to every reader until its day. Its deadlines are recorded against
-- it in their own dated list, the newest on or before a day being that day's
-- deadline -- a deadline change keeps the goal; a change of targets or type is
-- a new goal. A goal that has started never changes its type, targets or start
-- day; today's goal may be corrected today. Delete is a hard delete: nothing
-- references a goal row, and the delete hands back a copy for its undo.
--
-- 1. The old versioned table moves aside (its two SELECT policies, its trigger
--    and its indexes go with it when it is dropped in 5).
-- 2. The two tables. RLS on, no policies, and the server role may READ them
--    only: every write is one of the six functions in 4.
-- 3. The existing rows convert. Days are the client's calendar day by the
--    app's rule (services/today-service.ts). Same-day rows collapse to the
--    day's last; consecutive days differing only in deadline are one goal with
--    deadline entries; a goal's type is the client's questionnaire answer, else
--    it comes from its targets against the reading on its start day; its name
--    is its type's. The old primary_goal (seed words, not the questionnaire's
--    list) and notes (seed filler) are not carried.
-- 4. The six write functions, SECURITY DEFINER and executable by service_role
--    alone, one transaction each, serialised per client, and writing nothing
--    when nothing changed. Refusals are "code: message" -- a contract the goals
--    service maps to typed errors.
-- 5. The drops: the old table, and the profile's copy of the goal.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The old table moves aside, freeing its names.
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.client_goals RENAME TO client_goals_before_193;
ALTER TABLE IF EXISTS public.client_goals_before_193
  RENAME CONSTRAINT client_goals_pkey TO client_goals_before_193_pkey;

-- ---------------------------------------------------------------------------
-- 2. The two tables.
-- ---------------------------------------------------------------------------
CREATE TABLE public.client_goals (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                  UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name                       TEXT NOT NULL
                               CHECK (btrim(name) <> '' AND char_length(name) <= 80),
  type                       TEXT NOT NULL
                               CHECK (type IN ('lose_weight', 'build_muscle', 'recomposition',
                                               'maintain', 'event_prep', 'general_fitness')),
  target_weight              NUMERIC CHECK (target_weight > 0),
  target_body_fat_percentage NUMERIC
                               CHECK (target_body_fat_percentage > 0 AND target_body_fat_percentage < 100),
  description                TEXT CHECK (char_length(description) <= 500),
  starts_on                  DATE NOT NULL,
  source                     TEXT NOT NULL CHECK (source IN ('coach', 'intake')),
  set_by                     UUID REFERENCES public.coaches(id) ON DELETE SET NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT client_goals_one_per_day UNIQUE (client_id, starts_on)
);

CREATE INDEX client_goals_set_by_idx
  ON public.client_goals (set_by) WHERE set_by IS NOT NULL;

COMMENT ON TABLE public.client_goals IS
  'One row per goal. A goal runs from starts_on until the next goal starts; no end is stored. A row dated ahead is a planned goal. Written only by the six goal functions; hard-deleted (delete_client_goal returns a copy for the undo).';
COMMENT ON COLUMN public.client_goals.name IS
  'A label for this goal, defaulted from its type. Editable any time.';
COMMENT ON COLUMN public.client_goals.type IS
  'The intake''s six goal types (lib/goals/goal-types.ts). Fixed once the goal has started.';
COMMENT ON COLUMN public.client_goals.target_weight IS
  'Kilograms (CONVENTIONS §20). Optional for every type.';
COMMENT ON COLUMN public.client_goals.starts_on IS
  'The first day of the goal on the client''s calendar. Fixed once the goal has started.';
COMMENT ON COLUMN public.client_goals.source IS
  'coach, or intake for the goal Sync metrics copied from the questionnaire.';
COMMENT ON COLUMN public.client_goals.set_by IS
  'The coach who set the goal.';

CREATE TABLE public.client_goal_deadlines (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id      UUID NOT NULL REFERENCES public.client_goals(id) ON DELETE CASCADE,
  effective_on DATE NOT NULL,
  deadline     DATE,
  set_by       UUID REFERENCES public.coaches(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT client_goal_deadlines_one_per_day UNIQUE (goal_id, effective_on)
);

CREATE INDEX client_goal_deadlines_set_by_idx
  ON public.client_goal_deadlines (set_by) WHERE set_by IS NOT NULL;

COMMENT ON TABLE public.client_goal_deadlines IS
  'Every deadline a goal has had -- a date, or none -- and the day it took effect. The newest on or before a day is that day''s deadline. A goal that has not started, or started today, has exactly one, dated its start.';

CREATE TRIGGER update_client_goals_updated_at
  BEFORE UPDATE ON public.client_goals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_client_goal_deadlines_updated_at
  BEFORE UPDATE ON public.client_goal_deadlines
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.client_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_goal_deadlines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.client_goals, public.client_goal_deadlines
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.client_goals, public.client_goal_deadlines TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The conversion.
-- ---------------------------------------------------------------------------

-- One row per client per calendar day: the day's last version.
CREATE TEMP TABLE goal_day_rows AS
WITH dated AS (
  SELECT g.*,
         (g.effective_from AT TIME ZONE CASE
            WHEN c.timezone IS NOT NULL AND c.timezone <> 'UTC' THEN c.timezone
            WHEN co.timezone IS NOT NULL AND co.timezone <> 'UTC' THEN co.timezone
            ELSE 'UTC'
          END)::date AS day
    FROM public.client_goals_before_193 g
    JOIN public.clients c ON c.id = g.client_id
    LEFT JOIN public.coaches co ON co.id = c.coach_id
)
SELECT DISTINCT ON (client_id, day) *
  FROM dated
 ORDER BY client_id, day, effective_from DESC, created_at DESC;

-- Each day-row, marked with whether it starts a goal (its targets differ from
-- the day before) and numbered into its goal.
CREATE TEMP TABLE goal_runs AS
SELECT r.*,
       SUM(CASE WHEN r.starts_goal THEN 1 ELSE 0 END)
         OVER (PARTITION BY r.client_id ORDER BY r.day) AS goal_no
  FROM (
    SELECT d.*,
           (LAG(d.day) OVER w IS NULL
             OR d.goal_weight IS DISTINCT FROM LAG(d.goal_weight) OVER w
             OR d.goal_body_fat_percentage IS DISTINCT FROM LAG(d.goal_body_fat_percentage) OVER w
           ) AS starts_goal,
           LAG(d.goal_deadline) OVER w AS previous_deadline,
           CASE
             WHEN d.set_by ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
              AND EXISTS (SELECT 1 FROM public.coaches co WHERE co.id::text = lower(d.set_by))
             THEN lower(d.set_by)::uuid
           END AS set_by_coach
      FROM goal_day_rows d
    WINDOW w AS (PARTITION BY d.client_id ORDER BY d.day)
  ) r;

INSERT INTO public.client_goals (
  id, client_id, name, type, target_weight, target_body_fat_percentage,
  description, starts_on, source, set_by, created_at, updated_at
)
SELECT t.id,
       t.client_id,
       CASE t.type
         WHEN 'lose_weight' THEN 'Lose weight'
         WHEN 'build_muscle' THEN 'Build muscle'
         WHEN 'recomposition' THEN 'Recomp'
         WHEN 'maintain' THEN 'Maintain'
         WHEN 'event_prep' THEN 'Event prep'
         ELSE 'General fitness'
       END,
       t.type,
       t.goal_weight,
       t.goal_body_fat_percentage,
       NULL,
       t.day,
       CASE WHEN t.set_by = 'intake' THEN 'intake' ELSE 'coach' END,
       t.set_by_coach,
       t.created_at,
       t.created_at
  FROM (
    SELECT f.*,
           COALESCE(
             (SELECT i.primary_goal
                FROM public.client_intake i
               WHERE i.client_id = f.client_id
                 AND i.primary_goal IN ('lose_weight', 'build_muscle', 'recomposition',
                                        'maintain', 'event_prep', 'general_fitness')),
             CASE
               WHEN f.goal_weight IS NOT NULL AND reading.value IS NOT NULL
                    AND f.goal_weight < reading.value THEN 'lose_weight'
               WHEN f.goal_weight IS NOT NULL AND reading.value IS NOT NULL
                    AND f.goal_weight > reading.value THEN 'build_muscle'
               WHEN f.goal_weight IS NOT NULL AND reading.value IS NOT NULL THEN 'maintain'
               WHEN f.goal_weight IS NULL AND f.goal_body_fat_percentage IS NOT NULL THEN 'recomposition'
               ELSE 'general_fitness'
             END
           ) AS type
      FROM goal_runs f
      -- The reading on the goal's start day: the day's value on or before it,
      -- else the first one after it (the baseline's rule, on this day).
      LEFT JOIN LATERAL (
        SELECT COALESCE(
          (SELECT m.value FROM public.client_measurements_live m
            WHERE m.client_id = f.client_id AND m.metric_key = 'weight' AND m.recorded_on <= f.day
            ORDER BY m.recorded_on DESC, m.recorded_at DESC, m.id DESC LIMIT 1),
          (SELECT m.value FROM public.client_measurements_live m
            WHERE m.client_id = f.client_id AND m.metric_key = 'weight' AND m.recorded_on > f.day
            ORDER BY m.recorded_on ASC, m.recorded_at DESC, m.id DESC LIMIT 1)
        ) AS value
      ) reading ON true
     WHERE f.starts_goal
  ) t;

-- Every goal's first deadline (a date or none), dated its start, and each
-- later day whose deadline differs from the day before.
INSERT INTO public.client_goal_deadlines (goal_id, effective_on, deadline, set_by, created_at, updated_at)
SELECT goal.id, r.day, r.goal_deadline, r.set_by_coach, r.created_at, r.created_at
  FROM goal_runs r
  JOIN goal_runs goal
    ON goal.client_id = r.client_id AND goal.goal_no = r.goal_no AND goal.starts_goal
 WHERE r.starts_goal OR r.goal_deadline IS DISTINCT FROM r.previous_deadline;

DROP TABLE goal_runs;
DROP TABLE goal_day_rows;

-- ---------------------------------------------------------------------------
-- 4. The write functions.
-- ---------------------------------------------------------------------------

-- A goal from a day: today (the "set a goal" of the sheet) or a later day
-- (planning). Refuses a start in the past, a second goal on one day, a
-- deadline before the start or on/after the next goal's start, and -- when
-- planning -- a start on or before the previous goal's deadline. A goal set
-- from today replaces the current one, which ends yesterday whatever its
-- deadline says.
CREATE OR REPLACE FUNCTION public.add_client_goal(
  p_client_id UUID,
  p_today DATE,
  p_starts_on DATE,
  p_type TEXT,
  p_name TEXT,
  p_source TEXT,
  p_set_by UUID DEFAULT NULL,
  p_target_weight NUMERIC DEFAULT NULL,
  p_target_body_fat_percentage NUMERIC DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_deadline DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_next RECORD;
  v_previous RECORD;
  v_previous_deadline DATE;
BEGIN
  IF p_client_id IS NULL OR p_today IS NULL OR p_starts_on IS NULL
     OR p_type IS NULL OR p_name IS NULL OR p_source IS NULL THEN
    RAISE EXCEPTION 'invalid_args: a client, today, a start day, a type, a name and a source are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('client_goals:' || p_client_id::text, 0));

  IF NOT EXISTS (SELECT 1 FROM clients WHERE id = p_client_id) THEN
    RAISE EXCEPTION 'not_found: client % does not exist', p_client_id;
  END IF;
  IF p_starts_on < p_today THEN
    RAISE EXCEPTION 'starts_in_past: a goal starts today or later';
  END IF;
  IF EXISTS (SELECT 1 FROM client_goals WHERE client_id = p_client_id AND starts_on = p_starts_on) THEN
    RAISE EXCEPTION 'day_taken: another goal starts on %', p_starts_on;
  END IF;
  IF p_deadline IS NOT NULL AND p_deadline < p_starts_on THEN
    RAISE EXCEPTION 'deadline_before_start: the deadline is before the goal starts';
  END IF;

  SELECT id, name, starts_on INTO v_next
    FROM client_goals
   WHERE client_id = p_client_id AND starts_on > p_starts_on
   ORDER BY starts_on
   LIMIT 1;
  IF p_deadline IS NOT NULL AND v_next.id IS NOT NULL AND p_deadline >= v_next.starts_on THEN
    RAISE EXCEPTION 'deadline_after_next:%',
      json_build_object('goalId', v_next.id, 'name', v_next.name, 'startsOn', v_next.starts_on);
  END IF;

  IF p_starts_on > p_today THEN
    SELECT id, name INTO v_previous
      FROM client_goals
     WHERE client_id = p_client_id AND starts_on < p_starts_on
     ORDER BY starts_on DESC
     LIMIT 1;
    IF v_previous.id IS NOT NULL THEN
      SELECT deadline INTO v_previous_deadline
        FROM client_goal_deadlines
       WHERE goal_id = v_previous.id
       ORDER BY effective_on DESC
       LIMIT 1;
      IF v_previous_deadline IS NOT NULL AND v_previous_deadline >= p_starts_on THEN
        RAISE EXCEPTION 'previous_deadline:%',
          json_build_object('goalId', v_previous.id, 'name', v_previous.name, 'deadline', v_previous_deadline);
      END IF;
    END IF;
  END IF;

  BEGIN
    INSERT INTO client_goals (
      client_id, name, type, target_weight, target_body_fat_percentage,
      description, starts_on, source, set_by
    ) VALUES (
      p_client_id, btrim(p_name), p_type, p_target_weight, p_target_body_fat_percentage,
      NULLIF(btrim(p_description), ''), p_starts_on, p_source, p_set_by
    )
    RETURNING id INTO v_id;
  EXCEPTION
    WHEN check_violation THEN
      RAISE EXCEPTION 'invalid_args: %', SQLERRM;
    WHEN unique_violation THEN
      RAISE EXCEPTION 'day_taken: another goal starts on %', p_starts_on;
  END;

  INSERT INTO client_goal_deadlines (goal_id, effective_on, deadline, set_by)
  VALUES (v_id, p_starts_on, p_deadline, p_set_by);

  RETURN v_id;
END;
$$;

-- A goal that has not started, or started today, rewritten whole: its type,
-- name, targets, description, deadline and -- a planned goal only -- its start
-- day. Returns whether anything changed.
CREATE OR REPLACE FUNCTION public.edit_client_goal(
  p_goal_id UUID,
  p_client_id UUID,
  p_today DATE,
  p_type TEXT,
  p_name TEXT,
  p_starts_on DATE,
  p_set_by UUID DEFAULT NULL,
  p_target_weight NUMERIC DEFAULT NULL,
  p_target_body_fat_percentage NUMERIC DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_deadline DATE DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_goal client_goals%ROWTYPE;
  v_deadline DATE;
  v_next RECORD;
  v_previous RECORD;
  v_previous_deadline DATE;
BEGIN
  IF p_goal_id IS NULL OR p_client_id IS NULL OR p_today IS NULL
     OR p_type IS NULL OR p_name IS NULL OR p_starts_on IS NULL THEN
    RAISE EXCEPTION 'invalid_args: a goal, a client, today, a type, a name and a start day are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('client_goals:' || p_client_id::text, 0));

  SELECT * INTO v_goal FROM client_goals
   WHERE id = p_goal_id AND client_id = p_client_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: goal % is not this client''s', p_goal_id;
  END IF;
  IF v_goal.starts_on < p_today THEN
    RAISE EXCEPTION 'started: a goal that has started changes only its deadline and its name';
  END IF;
  IF v_goal.starts_on = p_today AND p_starts_on <> v_goal.starts_on THEN
    RAISE EXCEPTION 'started: today''s goal keeps its start day';
  END IF;
  IF p_starts_on < p_today THEN
    RAISE EXCEPTION 'starts_in_past: a goal starts today or later';
  END IF;
  IF p_starts_on <> v_goal.starts_on AND EXISTS (
    SELECT 1 FROM client_goals WHERE client_id = p_client_id AND starts_on = p_starts_on
  ) THEN
    RAISE EXCEPTION 'day_taken: another goal starts on %', p_starts_on;
  END IF;
  IF p_deadline IS NOT NULL AND p_deadline < p_starts_on THEN
    RAISE EXCEPTION 'deadline_before_start: the deadline is before the goal starts';
  END IF;

  SELECT id, name, starts_on INTO v_next
    FROM client_goals
   WHERE client_id = p_client_id AND starts_on > p_starts_on AND id <> p_goal_id
   ORDER BY starts_on
   LIMIT 1;
  IF p_deadline IS NOT NULL AND v_next.id IS NOT NULL AND p_deadline >= v_next.starts_on THEN
    RAISE EXCEPTION 'deadline_after_next:%',
      json_build_object('goalId', v_next.id, 'name', v_next.name, 'startsOn', v_next.starts_on);
  END IF;

  IF p_starts_on > p_today THEN
    SELECT id, name INTO v_previous
      FROM client_goals
     WHERE client_id = p_client_id AND starts_on < p_starts_on AND id <> p_goal_id
     ORDER BY starts_on DESC
     LIMIT 1;
    IF v_previous.id IS NOT NULL THEN
      SELECT deadline INTO v_previous_deadline
        FROM client_goal_deadlines
       WHERE goal_id = v_previous.id
       ORDER BY effective_on DESC
       LIMIT 1;
      IF v_previous_deadline IS NOT NULL AND v_previous_deadline >= p_starts_on THEN
        RAISE EXCEPTION 'previous_deadline:%',
          json_build_object('goalId', v_previous.id, 'name', v_previous.name, 'deadline', v_previous_deadline);
      END IF;
    END IF;
  END IF;

  SELECT deadline INTO v_deadline
    FROM client_goal_deadlines
   WHERE goal_id = p_goal_id
   ORDER BY effective_on DESC
   LIMIT 1;

  IF v_goal.type = p_type
     AND v_goal.name = btrim(p_name)
     AND v_goal.target_weight IS NOT DISTINCT FROM p_target_weight
     AND v_goal.target_body_fat_percentage IS NOT DISTINCT FROM p_target_body_fat_percentage
     AND v_goal.description IS NOT DISTINCT FROM NULLIF(btrim(p_description), '')
     AND v_goal.starts_on = p_starts_on
     AND v_deadline IS NOT DISTINCT FROM p_deadline THEN
    RETURN false;
  END IF;

  BEGIN
    UPDATE client_goals
       SET type = p_type,
           name = btrim(p_name),
           target_weight = p_target_weight,
           target_body_fat_percentage = p_target_body_fat_percentage,
           description = NULLIF(btrim(p_description), ''),
           starts_on = p_starts_on
     WHERE id = p_goal_id;
  EXCEPTION
    WHEN check_violation THEN
      RAISE EXCEPTION 'invalid_args: %', SQLERRM;
    WHEN unique_violation THEN
      RAISE EXCEPTION 'day_taken: another goal starts on %', p_starts_on;
  END;

  -- Not started, or started today: its one deadline entry, dated its start.
  DELETE FROM client_goal_deadlines WHERE goal_id = p_goal_id;
  INSERT INTO client_goal_deadlines (goal_id, effective_on, deadline, set_by)
  VALUES (p_goal_id, p_starts_on, p_deadline, p_set_by);

  RETURN true;
END;
$$;

-- A goal's deadline changed, keeping the goal. A planned goal's (or today's)
-- one entry is rewritten; a running goal records the change dated today, and a
-- change back to yesterday's deadline removes today's entry rather than
-- writing a copy of the one before it. A goal that has ended never changes.
-- Returns whether anything changed.
CREATE OR REPLACE FUNCTION public.set_client_goal_deadline(
  p_goal_id UUID,
  p_client_id UUID,
  p_today DATE,
  p_set_by UUID DEFAULT NULL,
  p_deadline DATE DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_goal client_goals%ROWTYPE;
  v_next RECORD;
  v_on DATE;
  v_current DATE;
  v_before DATE;
  v_has_before BOOLEAN;
BEGIN
  IF p_goal_id IS NULL OR p_client_id IS NULL OR p_today IS NULL THEN
    RAISE EXCEPTION 'invalid_args: a goal, a client and today are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('client_goals:' || p_client_id::text, 0));

  SELECT * INTO v_goal FROM client_goals
   WHERE id = p_goal_id AND client_id = p_client_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: goal % is not this client''s', p_goal_id;
  END IF;
  IF v_goal.starts_on <= p_today AND EXISTS (
    SELECT 1 FROM client_goals
     WHERE client_id = p_client_id AND starts_on > v_goal.starts_on AND starts_on <= p_today
  ) THEN
    RAISE EXCEPTION 'ended: a goal that has ended keeps its deadline';
  END IF;
  IF p_deadline IS NOT NULL AND p_deadline < v_goal.starts_on THEN
    RAISE EXCEPTION 'deadline_before_start: the deadline is before the goal starts';
  END IF;

  SELECT id, name, starts_on INTO v_next
    FROM client_goals
   WHERE client_id = p_client_id AND starts_on > v_goal.starts_on
   ORDER BY starts_on
   LIMIT 1;
  IF p_deadline IS NOT NULL AND v_next.id IS NOT NULL AND p_deadline >= v_next.starts_on THEN
    RAISE EXCEPTION 'deadline_after_next:%',
      json_build_object('goalId', v_next.id, 'name', v_next.name, 'startsOn', v_next.starts_on);
  END IF;

  SELECT deadline INTO v_current
    FROM client_goal_deadlines
   WHERE goal_id = p_goal_id
   ORDER BY effective_on DESC
   LIMIT 1;
  IF v_current IS NOT DISTINCT FROM p_deadline THEN
    RETURN false;
  END IF;

  v_on := GREATEST(v_goal.starts_on, p_today);

  IF v_on > v_goal.starts_on THEN
    SELECT deadline, true INTO v_before, v_has_before
      FROM client_goal_deadlines
     WHERE goal_id = p_goal_id AND effective_on < v_on
     ORDER BY effective_on DESC
     LIMIT 1;
    IF v_has_before AND v_before IS NOT DISTINCT FROM p_deadline THEN
      DELETE FROM client_goal_deadlines WHERE goal_id = p_goal_id AND effective_on = v_on;
      RETURN true;
    END IF;
  END IF;

  INSERT INTO client_goal_deadlines (goal_id, effective_on, deadline, set_by)
  VALUES (p_goal_id, v_on, p_deadline, p_set_by)
  ON CONFLICT (goal_id, effective_on)
  DO UPDATE SET deadline = EXCLUDED.deadline, set_by = EXCLUDED.set_by;

  RETURN true;
END;
$$;

-- A goal's labels: its name and description, on any goal. Returns whether
-- anything changed.
CREATE OR REPLACE FUNCTION public.rename_client_goal(
  p_goal_id UUID,
  p_client_id UUID,
  p_name TEXT,
  p_description TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_goal client_goals%ROWTYPE;
BEGIN
  IF p_goal_id IS NULL OR p_client_id IS NULL OR p_name IS NULL THEN
    RAISE EXCEPTION 'invalid_args: a goal, a client and a name are required';
  END IF;

  SELECT * INTO v_goal FROM client_goals
   WHERE id = p_goal_id AND client_id = p_client_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: goal % is not this client''s', p_goal_id;
  END IF;
  IF v_goal.name = btrim(p_name)
     AND v_goal.description IS NOT DISTINCT FROM NULLIF(btrim(p_description), '') THEN
    RETURN false;
  END IF;

  BEGIN
    UPDATE client_goals
       SET name = btrim(p_name),
           description = NULLIF(btrim(p_description), '')
     WHERE id = p_goal_id;
  EXCEPTION
    WHEN check_violation THEN
      RAISE EXCEPTION 'invalid_args: %', SQLERRM;
  END;

  RETURN true;
END;
$$;

-- A goal hard-deleted, with its deadlines. Returns exactly what was deleted,
-- for the undo; the goal before it covers its days again.
CREATE OR REPLACE FUNCTION public.delete_client_goal(
  p_goal_id UUID,
  p_client_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_goal client_goals%ROWTYPE;
  v_copy JSONB;
BEGIN
  IF p_goal_id IS NULL OR p_client_id IS NULL THEN
    RAISE EXCEPTION 'invalid_args: a goal and a client are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('client_goals:' || p_client_id::text, 0));

  SELECT * INTO v_goal FROM client_goals
   WHERE id = p_goal_id AND client_id = p_client_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: goal % is not this client''s', p_goal_id;
  END IF;

  v_copy := jsonb_build_object(
    'goal', to_jsonb(v_goal),
    'deadlines', COALESCE(
      (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.effective_on)
         FROM client_goal_deadlines d
        WHERE d.goal_id = p_goal_id),
      '[]'::jsonb
    )
  );

  DELETE FROM client_goals WHERE id = p_goal_id;

  RETURN v_copy;
END;
$$;

-- A deleted goal put back exactly as delete_client_goal returned it -- the same
-- id, fields and deadlines. Refused when the goal exists again or another goal
-- now starts on its day.
CREATE OR REPLACE FUNCTION public.restore_client_goal(
  p_client_id UUID,
  p_copy JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_goal client_goals%ROWTYPE;
BEGIN
  IF p_client_id IS NULL OR p_copy IS NULL OR p_copy->'goal' IS NULL THEN
    RAISE EXCEPTION 'invalid_args: a client and the deleted goal are required';
  END IF;

  v_goal := jsonb_populate_record(NULL::client_goals, p_copy->'goal');
  IF v_goal.id IS NULL OR v_goal.client_id IS DISTINCT FROM p_client_id THEN
    RAISE EXCEPTION 'invalid_args: the goal is not this client''s';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('client_goals:' || p_client_id::text, 0));

  IF EXISTS (SELECT 1 FROM client_goals WHERE id = v_goal.id) THEN
    RAISE EXCEPTION 'exists: goal % is already there', v_goal.id;
  END IF;
  IF EXISTS (SELECT 1 FROM client_goals WHERE client_id = p_client_id AND starts_on = v_goal.starts_on) THEN
    RAISE EXCEPTION 'day_taken: another goal starts on %', v_goal.starts_on;
  END IF;

  BEGIN
    INSERT INTO client_goals SELECT (v_goal).*;
    INSERT INTO client_goal_deadlines
    SELECT * FROM jsonb_populate_recordset(NULL::client_goal_deadlines, COALESCE(p_copy->'deadlines', '[]'::jsonb))
     WHERE goal_id = v_goal.id;
  EXCEPTION
    WHEN check_violation OR not_null_violation THEN
      RAISE EXCEPTION 'invalid_args: %', SQLERRM;
  END;

  RETURN v_goal.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_client_goal(UUID, DATE, DATE, TEXT, TEXT, TEXT, UUID, NUMERIC, NUMERIC, TEXT, DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_client_goal(UUID, DATE, DATE, TEXT, TEXT, TEXT, UUID, NUMERIC, NUMERIC, TEXT, DATE)
  TO service_role;
REVOKE EXECUTE ON FUNCTION public.edit_client_goal(UUID, UUID, DATE, TEXT, TEXT, DATE, UUID, NUMERIC, NUMERIC, TEXT, DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.edit_client_goal(UUID, UUID, DATE, TEXT, TEXT, DATE, UUID, NUMERIC, NUMERIC, TEXT, DATE)
  TO service_role;
REVOKE EXECUTE ON FUNCTION public.set_client_goal_deadline(UUID, UUID, DATE, UUID, DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_client_goal_deadline(UUID, UUID, DATE, UUID, DATE)
  TO service_role;
REVOKE EXECUTE ON FUNCTION public.rename_client_goal(UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rename_client_goal(UUID, UUID, TEXT, TEXT)
  TO service_role;
REVOKE EXECUTE ON FUNCTION public.delete_client_goal(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_client_goal(UUID, UUID)
  TO service_role;
REVOKE EXECUTE ON FUNCTION public.restore_client_goal(UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_client_goal(UUID, JSONB)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 5. The drops.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.client_goals_before_193;

ALTER TABLE public.clients
  DROP COLUMN IF EXISTS goal_weight,
  DROP COLUMN IF EXISTS goal_body_fat_percentage,
  DROP COLUMN IF EXISTS goal_deadline;
