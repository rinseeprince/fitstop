-- =============================================================================
-- 206_client_habits_delete_any.sql -- any habit can be deleted, and nothing
-- the client logged is lost (docs/HABITS-REBUILD-PLAN.md section 6, commit 3;
-- decision D6 as revised by the owner, 2026-09-30).
--
-- delete_client_habit now takes the client's today. A habit the client never
-- made an entry for is removed with its versions and one-date edits, as
-- before. A habit with entries is stopped from today by the stop's own rules
-- -- stop_client_habit itself: the version running the day before ends then,
-- and the versions and one-date edits from today go -- and marked deleted
-- (client_habits.deleted_at). It is never erased: its past versions and its
-- entries stay, so every read of the past keeps it for the days it ran.
--
-- A deleted habit is no longer one of the client's habits to manage: the
-- order counts the client's habits without it, the choices offered for reuse
-- leave it out, and every write to it -- a change, a stop, another delete, a
-- rename, a one-date edit or its reset -- answers not_found. The client's
-- entry is the one write that still reaches it, on a day one of its versions
-- covers and the day rule leaves open.
--
-- 1. The mark, and the catalog comments that describe the delete.
-- 2. delete_client_habit(habit, client, today), in place of the two-argument
--    one; the other functions take the mark into account. Each keeps its
--    signature, so CREATE OR REPLACE keeps its grants; the new delete is
--    REVOKEd and GRANTed by full signature.
--
-- DEV facts at writing (aeaphsslctwcmebldrzx, 2026-09-30): 11 habits on 5
-- clients, 4 of them with entries (12 entries); one delete_client_habit. PROD
-- (etezzztgafcotyahgijk) holds none of migrations 185-205 yet; nothing here
-- moves a row. Pure ASCII.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The mark.
-- ---------------------------------------------------------------------------
ALTER TABLE public.client_habits ADD COLUMN deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN public.client_habits.deleted_at IS
  'When the coach deleted a habit the client has logged: it runs no day from its delete, it leaves the coach''s list, the order and the choices, and no write but the client''s entry reaches it. Its versions and entries stay. NULL: not deleted.';

COMMENT ON TABLE public.client_habits IS
  'A client''s habit: what it is. Its prescription is its versions. Written only by the habit functions; delete_client_habit removes a habit the client never logged and marks one they have (deleted_at), and a client''s removal takes their habits and entries together.';

COMMENT ON TABLE public.client_habit_logs IS
  'The client''s entry: one per habit per day, made on a day a version covers; a stop from today leaves an entry already made that day, counted in no figure. Carries no target -- met is worked out against the day''s target when asked. A habit with entries is never removed (NO ACTION): deleting it marks it, while a client''s removal takes both in one statement.';

-- ---------------------------------------------------------------------------
-- 2. The functions.
-- ---------------------------------------------------------------------------

-- A habit's target and days from a day, today or later: the version running
-- the day before ends then, a version starting on that day is replaced, and a
-- version queued after it stands. The new prescription runs to the end of the
-- span it falls in -- the running version's own end, a stop dated ahead
-- standing -- or, from a day no version covers (starting a stopped habit
-- again), until the day before the next version, else on. Where the version
-- before it or after it, day to day, carries the same target and days, that
-- version is extended rather than copied. A change to N times a week removes
-- the one-date edits in the days it now covers: those are for set days alone.
-- A deleted habit is not found. Returns whether anything changed.
CREATE OR REPLACE FUNCTION public.change_client_habit(
  p_habit_id UUID,
  p_client_id UUID,
  p_today DATE,
  p_starts_on DATE,
  p_created_by UUID DEFAULT NULL,
  p_target NUMERIC DEFAULT NULL,
  p_times_per_week INTEGER DEFAULT NULL,
  p_weekdays TEXT[] DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_habit client_habits%ROWTYPE;
  v_target NUMERIC(10,2);
  v_weekdays TEXT[];
  v_covering client_habit_versions%ROWTYPE;
  v_prev client_habit_versions%ROWTYPE;
  v_next client_habit_versions%ROWTYPE;
  v_end DATE;
  v_prev_same BOOLEAN := false;
  v_next_same BOOLEAN := false;
  v_version_id UUID;
BEGIN
  IF p_habit_id IS NULL OR p_client_id IS NULL OR p_today IS NULL OR p_starts_on IS NULL THEN
    RAISE EXCEPTION 'invalid_args: a habit, a client, today and a start day are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('client_habits:' || p_client_id::text, 0));

  SELECT * INTO v_habit FROM client_habits
   WHERE id = p_habit_id AND client_id = p_client_id AND deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: habit % is not this client''s', p_habit_id;
  END IF;
  IF p_starts_on < p_today THEN
    RAISE EXCEPTION 'starts_in_past: a change starts today or later';
  END IF;
  IF v_habit.measure = 'number' AND p_target IS NULL THEN
    RAISE EXCEPTION 'target_required: a number habit has a target';
  END IF;
  IF v_habit.measure = 'tick' AND p_target IS NOT NULL THEN
    RAISE EXCEPTION 'target_not_allowed: a tick habit has no target';
  END IF;

  v_weekdays := ARRAY(SELECT DISTINCT d FROM unnest(COALESCE(p_weekdays, '{}'::TEXT[])) AS d ORDER BY d);
  IF (p_times_per_week IS NULL) = (cardinality(v_weekdays) = 0) THEN
    RAISE EXCEPTION 'invalid_args: a habit runs on chosen weekdays or a number of times a week';
  END IF;
  IF p_times_per_week NOT BETWEEN 1 AND 7
     OR p_target < 0
     OR EXISTS (
       SELECT 1 FROM unnest(v_weekdays) AS d
        WHERE d IS NULL OR d NOT IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')
     ) THEN
    RAISE EXCEPTION 'invalid_args: a target is zero or more, a week holds one to seven times, and a weekday is named';
  END IF;
  BEGIN
    v_target := p_target;
  EXCEPTION WHEN data_exception THEN
    RAISE EXCEPTION 'invalid_args: %', SQLERRM;
  END;

  SELECT * INTO v_covering FROM client_habit_versions
   WHERE client_habit_id = p_habit_id
     AND starts_on <= p_starts_on
     AND (ends_on IS NULL OR ends_on >= p_starts_on);

  IF v_covering.id IS NOT NULL
     AND v_covering.target IS NOT DISTINCT FROM v_target
     AND v_covering.times_per_week IS NOT DISTINCT FROM p_times_per_week
     AND ARRAY(SELECT weekday FROM client_habit_version_days WHERE version_id = v_covering.id ORDER BY weekday)
         = v_weekdays THEN
    RETURN false;
  END IF;

  IF v_covering.id IS NOT NULL THEN
    v_end := v_covering.ends_on;
    IF v_covering.starts_on = p_starts_on THEN
      DELETE FROM client_habit_versions WHERE id = v_covering.id;
    ELSE
      UPDATE client_habit_versions SET ends_on = p_starts_on - 1 WHERE id = v_covering.id;
    END IF;
  ELSE
    SELECT starts_on - 1 INTO v_end
      FROM client_habit_versions
     WHERE client_habit_id = p_habit_id AND starts_on > p_starts_on
     ORDER BY starts_on
     LIMIT 1;
  END IF;

  SELECT * INTO v_prev FROM client_habit_versions
   WHERE client_habit_id = p_habit_id AND ends_on = p_starts_on - 1;
  IF v_end IS NOT NULL THEN
    SELECT * INTO v_next FROM client_habit_versions
     WHERE client_habit_id = p_habit_id AND starts_on = v_end + 1;
  END IF;
  v_prev_same := v_prev.id IS NOT NULL
    AND v_prev.target IS NOT DISTINCT FROM v_target
    AND v_prev.times_per_week IS NOT DISTINCT FROM p_times_per_week
    AND ARRAY(SELECT weekday FROM client_habit_version_days WHERE version_id = v_prev.id ORDER BY weekday) = v_weekdays;
  v_next_same := v_next.id IS NOT NULL
    AND v_next.target IS NOT DISTINCT FROM v_target
    AND v_next.times_per_week IS NOT DISTINCT FROM p_times_per_week
    AND ARRAY(SELECT weekday FROM client_habit_version_days WHERE version_id = v_next.id ORDER BY weekday) = v_weekdays;

  BEGIN
    IF v_prev_same AND v_next_same THEN
      DELETE FROM client_habit_versions WHERE id = v_next.id;
      UPDATE client_habit_versions SET ends_on = v_next.ends_on WHERE id = v_prev.id;
    ELSIF v_prev_same THEN
      UPDATE client_habit_versions SET ends_on = v_end WHERE id = v_prev.id;
    ELSIF v_next_same THEN
      UPDATE client_habit_versions SET starts_on = p_starts_on WHERE id = v_next.id;
    ELSE
      INSERT INTO client_habit_versions (client_habit_id, starts_on, ends_on, target, times_per_week, created_by)
      VALUES (p_habit_id, p_starts_on, v_end, v_target, p_times_per_week, p_created_by)
      RETURNING id INTO v_version_id;
      INSERT INTO client_habit_version_days (version_id, weekday)
      SELECT v_version_id, d FROM unnest(v_weekdays) AS d;
    END IF;
  EXCEPTION
    WHEN check_violation OR not_null_violation THEN
      RAISE EXCEPTION 'invalid_args: %', SQLERRM;
  END;

  IF p_times_per_week IS NOT NULL THEN
    DELETE FROM client_habit_day_edits
     WHERE client_habit_id = p_habit_id
       AND date >= p_starts_on
       AND (v_end IS NULL OR date <= v_end);
  END IF;

  RETURN true;
END;
$$;

-- A habit stopped from a day, today or later: the version running the day
-- before ends then, and every version and one-date edit from that day on is
-- removed. The habit and its past stay; starting it again is a change after
-- the gap. A deleted habit is not found. Returns whether anything changed.
CREATE OR REPLACE FUNCTION public.stop_client_habit(
  p_habit_id UUID,
  p_client_id UUID,
  p_today DATE,
  p_stops_on DATE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_habit_id IS NULL OR p_client_id IS NULL OR p_today IS NULL OR p_stops_on IS NULL THEN
    RAISE EXCEPTION 'invalid_args: a habit, a client, today and a stop day are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('client_habits:' || p_client_id::text, 0));

  PERFORM 1 FROM client_habits
   WHERE id = p_habit_id AND client_id = p_client_id AND deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: habit % is not this client''s', p_habit_id;
  END IF;
  IF p_stops_on < p_today THEN
    RAISE EXCEPTION 'stops_in_past: a habit stops today or later';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM client_habit_versions
     WHERE client_habit_id = p_habit_id AND (ends_on IS NULL OR ends_on >= p_stops_on)
  ) THEN
    RETURN false;
  END IF;

  DELETE FROM client_habit_versions
   WHERE client_habit_id = p_habit_id AND starts_on >= p_stops_on;
  UPDATE client_habit_versions
     SET ends_on = p_stops_on - 1
   WHERE client_habit_id = p_habit_id
     AND starts_on < p_stops_on
     AND (ends_on IS NULL OR ends_on >= p_stops_on);
  DELETE FROM client_habit_day_edits
   WHERE client_habit_id = p_habit_id AND date >= p_stops_on;

  RETURN true;
END;
$$;

-- Any habit, deleted from the client's today. One the client never made an
-- entry for is removed with its versions and one-date edits. One with entries
-- is stopped from today by stop_client_habit and marked deleted: never
-- erased, its past versions and its entries stay. A habit already deleted is
-- not found.
DROP FUNCTION public.delete_client_habit(UUID, UUID);

CREATE FUNCTION public.delete_client_habit(
  p_habit_id UUID,
  p_client_id UUID,
  p_today DATE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_habit_id IS NULL OR p_client_id IS NULL OR p_today IS NULL THEN
    RAISE EXCEPTION 'invalid_args: a habit, a client and today are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('client_habits:' || p_client_id::text, 0));

  -- The row lock also holds off an entry being written for the habit: an
  -- entry's foreign key takes a key-share lock on it, so the check below sees
  -- every entry that exists.
  PERFORM 1 FROM client_habits
   WHERE id = p_habit_id AND client_id = p_client_id AND deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: habit % is not this client''s', p_habit_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM client_habit_logs WHERE client_habit_id = p_habit_id) THEN
    DELETE FROM client_habits WHERE id = p_habit_id AND client_id = p_client_id;
    RETURN;
  END IF;

  PERFORM stop_client_habit(p_habit_id, p_client_id, p_today, p_today);
  UPDATE client_habits SET deleted_at = NOW() WHERE id = p_habit_id AND client_id = p_client_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_client_habit(UUID, UUID, DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_client_habit(UUID, UUID, DATE)
  TO service_role;

-- A habit's labels: its name and how-to, on any habit but a deleted one.
-- Returns whether anything changed.
CREATE OR REPLACE FUNCTION public.rename_client_habit(
  p_habit_id UUID,
  p_client_id UUID,
  p_name TEXT,
  p_how_to TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_habit client_habits%ROWTYPE;
BEGIN
  IF p_habit_id IS NULL OR p_client_id IS NULL OR p_name IS NULL THEN
    RAISE EXCEPTION 'invalid_args: a habit, a client and a name are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('client_habits:' || p_client_id::text, 0));

  SELECT * INTO v_habit FROM client_habits
   WHERE id = p_habit_id AND client_id = p_client_id AND deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: habit % is not this client''s', p_habit_id;
  END IF;
  IF v_habit.name = btrim(p_name)
     AND v_habit.how_to IS NOT DISTINCT FROM NULLIF(btrim(p_how_to), '') THEN
    RETURN false;
  END IF;

  BEGIN
    UPDATE client_habits
       SET name = btrim(p_name),
           how_to = NULLIF(btrim(p_how_to), '')
     WHERE id = p_habit_id;
  EXCEPTION
    WHEN check_violation THEN
      RAISE EXCEPTION 'invalid_args: %', SQLERRM;
  END;

  RETURN true;
END;
$$;

-- The client's habits in their new order. The list names every one of the
-- client's habits, stopped ones included and deleted ones not, each once.
-- Returns whether the order changed.
CREATE OR REPLACE FUNCTION public.order_client_habits(
  p_client_id UUID,
  p_habit_ids UUID[]
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current UUID[];
BEGIN
  IF p_client_id IS NULL OR p_habit_ids IS NULL THEN
    RAISE EXCEPTION 'invalid_args: a client and the habits in order are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('client_habits:' || p_client_id::text, 0));

  v_current := ARRAY(
    SELECT id FROM client_habits
     WHERE client_id = p_client_id AND deleted_at IS NULL
     ORDER BY position, created_at, id
  );
  IF cardinality(p_habit_ids) <> cardinality(v_current)
     OR (SELECT count(DISTINCT h) FROM unnest(p_habit_ids) AS h) <> cardinality(p_habit_ids)
     OR EXISTS (SELECT 1 FROM unnest(p_habit_ids) AS h WHERE h IS NULL OR NOT (h = ANY (v_current))) THEN
    RAISE EXCEPTION 'order_mismatch: the order names every one of the client''s habits, once';
  END IF;
  IF v_current = p_habit_ids THEN
    RETURN false;
  END IF;

  UPDATE client_habits AS h
     SET position = o.n
    FROM unnest(p_habit_ids) WITH ORDINALITY AS o(id, n)
   WHERE h.id = o.id
     AND h.client_id = p_client_id
     AND h.position IS DISTINCT FROM o.n;

  RETURN true;
END;
$$;

-- One date of a set-days habit, today or later: planned or not, and -- a
-- number habit, planned -- that day's target (NULL: the version's). A day set
-- back to what its version has removes the edit rather than keeping a copy.
-- Refused on a day no version covers and on a version done N times a week,
-- which plans no particular day. A deleted habit is not found. Returns
-- whether anything changed.
CREATE OR REPLACE FUNCTION public.set_client_habit_day(
  p_habit_id UUID,
  p_client_id UUID,
  p_today DATE,
  p_date DATE,
  p_planned BOOLEAN,
  p_coach_id UUID DEFAULT NULL,
  p_target NUMERIC DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_habit client_habits%ROWTYPE;
  v_version client_habit_versions%ROWTYPE;
  v_edit client_habit_day_edits%ROWTYPE;
  v_target NUMERIC(10,2);
  v_default_planned BOOLEAN;
BEGIN
  IF p_habit_id IS NULL OR p_client_id IS NULL OR p_today IS NULL OR p_date IS NULL OR p_planned IS NULL THEN
    RAISE EXCEPTION 'invalid_args: a habit, a client, today, a date and whether it is planned are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('client_habits:' || p_client_id::text, 0));

  SELECT * INTO v_habit FROM client_habits
   WHERE id = p_habit_id AND client_id = p_client_id AND deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: habit % is not this client''s', p_habit_id;
  END IF;
  IF p_date < p_today THEN
    RAISE EXCEPTION 'day_in_past: a day before today keeps what it had';
  END IF;

  SELECT * INTO v_version FROM client_habit_versions
   WHERE client_habit_id = p_habit_id
     AND starts_on <= p_date
     AND (ends_on IS NULL OR ends_on >= p_date);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_running: the habit is not running on %', p_date;
  END IF;
  IF v_version.times_per_week IS NOT NULL THEN
    RAISE EXCEPTION 'weekly_version: a habit done a number of times a week plans no particular day';
  END IF;
  IF v_habit.measure = 'tick' AND p_target IS NOT NULL THEN
    RAISE EXCEPTION 'target_not_allowed: a tick habit has no target';
  END IF;
  IF NOT p_planned AND p_target IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_args: a day off has no target';
  END IF;
  IF p_target < 0 THEN
    RAISE EXCEPTION 'invalid_args: a target is zero or more';
  END IF;

  BEGIN
    v_target := p_target;
  EXCEPTION WHEN data_exception THEN
    RAISE EXCEPTION 'invalid_args: %', SQLERRM;
  END;
  IF v_target IS NOT DISTINCT FROM v_version.target THEN
    v_target := NULL;
  END IF;
  v_default_planned := EXISTS (
    SELECT 1 FROM client_habit_version_days
     WHERE version_id = v_version.id AND weekday = to_char(p_date, 'FMday')
  );

  IF p_planned = v_default_planned AND v_target IS NULL THEN
    DELETE FROM client_habit_day_edits WHERE client_habit_id = p_habit_id AND date = p_date;
    RETURN FOUND;
  END IF;

  SELECT * INTO v_edit FROM client_habit_day_edits
   WHERE client_habit_id = p_habit_id AND date = p_date;
  IF FOUND AND v_edit.planned = p_planned AND v_edit.target IS NOT DISTINCT FROM v_target THEN
    RETURN false;
  END IF;

  INSERT INTO client_habit_day_edits (client_habit_id, date, planned, target, coach_id)
  VALUES (p_habit_id, p_date, p_planned, v_target, p_coach_id)
  ON CONFLICT (client_habit_id, date)
  DO UPDATE SET planned = EXCLUDED.planned, target = EXCLUDED.target, coach_id = EXCLUDED.coach_id;

  RETURN true;
END;
$$;

-- A one-date edit removed, today or later: the day is its version's again. A
-- deleted habit is not found. Returns whether there was one.
CREATE OR REPLACE FUNCTION public.reset_client_habit_day(
  p_habit_id UUID,
  p_client_id UUID,
  p_today DATE,
  p_date DATE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_habit_id IS NULL OR p_client_id IS NULL OR p_today IS NULL OR p_date IS NULL THEN
    RAISE EXCEPTION 'invalid_args: a habit, a client, today and a date are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('client_habits:' || p_client_id::text, 0));

  PERFORM 1 FROM client_habits
   WHERE id = p_habit_id AND client_id = p_client_id AND deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: habit % is not this client''s', p_habit_id;
  END IF;
  IF p_date < p_today THEN
    RAISE EXCEPTION 'day_in_past: a day before today keeps what it had';
  END IF;

  DELETE FROM client_habit_day_edits WHERE client_habit_id = p_habit_id AND date = p_date;
  RETURN FOUND;
END;
$$;

-- Every habit the coach has given any of their clients and not deleted, one
-- row per name and way of measuring (names and units compared without case),
-- each with the how-to, target and days of its most recently written version
-- -- less the ones this client has running or planned on or after p_today,
-- the client's today. Nothing is stored: a habit leaves the list only when no
-- client has it any more. A client that is not this coach's reads nothing.
CREATE OR REPLACE FUNCTION public.coach_habit_choices(
  p_coach_id UUID,
  p_client_id UUID,
  p_today DATE
)
RETURNS TABLE (
  name TEXT,
  how_to TEXT,
  measure TEXT,
  unit TEXT,
  direction TEXT,
  target NUMERIC,
  times_per_week SMALLINT,
  weekdays TEXT[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF p_coach_id IS NULL OR p_client_id IS NULL OR p_today IS NULL THEN
    RAISE EXCEPTION 'invalid_args: a coach, a client and today are required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM clients AS c WHERE c.id = p_client_id AND c.coach_id = p_coach_id) THEN
    RAISE EXCEPTION 'not_found: client % is not this coach''s', p_client_id;
  END IF;

  RETURN QUERY
  WITH given AS (
    SELECT h.name, h.how_to, h.measure, h.unit, h.direction,
           v.id AS version_id, v.target, v.times_per_week, v.created_at AS written_at,
           lower(btrim(h.name)) AS name_key, lower(COALESCE(btrim(h.unit), '')) AS unit_key
      FROM clients AS c
      JOIN client_habits AS h ON h.client_id = c.id
      JOIN client_habit_versions AS v ON v.client_habit_id = h.id
     WHERE c.coach_id = p_coach_id
       AND h.deleted_at IS NULL
  ),
  latest AS (
    SELECT DISTINCT ON (g.name_key, g.measure, g.unit_key, g.direction) g.*
      FROM given AS g
     ORDER BY g.name_key, g.measure, g.unit_key, g.direction, g.written_at DESC, g.version_id DESC
  )
  SELECT l.name, l.how_to, l.measure, l.unit, l.direction, l.target, l.times_per_week,
         ARRAY(
           SELECT d.weekday FROM client_habit_version_days AS d
            WHERE d.version_id = l.version_id
            ORDER BY array_position(
              ARRAY['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'], d.weekday)
         )
    FROM latest AS l
   WHERE NOT EXISTS (
     SELECT 1
       FROM client_habits AS own
       JOIN client_habit_versions AS ov ON ov.client_habit_id = own.id
      WHERE own.client_id = p_client_id
        AND lower(btrim(own.name)) = l.name_key
        AND own.measure = l.measure
        AND lower(COALESCE(btrim(own.unit), '')) = l.unit_key
        AND own.direction IS NOT DISTINCT FROM l.direction
        AND (ov.ends_on IS NULL OR ov.ends_on >= p_today)
   )
   ORDER BY l.name_key, l.measure, l.unit_key, l.direction;
END;
$$;
