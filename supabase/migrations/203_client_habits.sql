-- =============================================================================
-- 203_client_habits.sql -- the habit engine: five tables, their write functions
-- and the read behind reuse (docs/HABITS-REBUILD-PLAN.md §6 commit 1; owner
-- decisions 2026-09-30).
--
-- A client's habit is its identity: a name, a how-to shown to the client, how
-- it is measured -- a tick, or a number with a unit that is at least or at most
-- its target -- and its place in the list. How it is measured never changes.
-- Its prescription is its VERSIONS: runs of days, each with its target and its
-- days (chosen weekdays, every day being all seven, or N times a week). The
-- versions of one habit never overlap and may leave gaps, and a version is
-- never edited once its first day has passed -- every change starts today or
-- later -- so every entry is judged against the target its day had, forever.
-- A one-date edit takes one day of a set-days habit off, puts it on, or sets
-- that day's target, today onward. The client makes one entry per habit per
-- day -- done or not, or a number -- with an optional note, on any day a
-- version covers. Met is worked out when asked, never stored.
--
-- 1. The five tables. RLS on, no policies; the server role may READ the four
--    prescription tables only -- every write of them is a function in 2 -- and
--    writes the entries itself, one upsert per entry.
-- 2. The eight write functions, SECURITY DEFINER and executable by service_role
--    alone, one transaction each, serialised per client, judged against the
--    client's today (p_today), and writing nothing when nothing changed.
--    Refusals are "code: message" -- a contract the habits service maps to
--    typed errors (services/client-habit-writes-service.ts).
-- 3. The read behind reuse: every habit the coach has given any client, one
--    row per name and way of measuring, less the ones this client has running.
--
-- Nothing is moved: the old daily_habits and daily_habit_logs stay exactly as
-- they are until the switch (commit 2), and nothing reads these tables yet but
-- the new routes.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The five tables.
-- ---------------------------------------------------------------------------
CREATE TABLE public.client_habits (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  how_to      TEXT CHECK (char_length(how_to) <= 500),
  measure     TEXT NOT NULL CHECK (measure IN ('tick', 'number')),
  unit        TEXT CHECK (char_length(btrim(unit)) BETWEEN 1 AND 20),
  direction   TEXT CHECK (direction IN ('at_least', 'at_most')),
  position    INTEGER NOT NULL DEFAULT 0,
  created_by  UUID REFERENCES public.coaches(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT client_habits_measure_shape CHECK (
    (measure = 'tick' AND unit IS NULL AND direction IS NULL) OR
    (measure = 'number' AND direction IS NOT NULL)
  )
);

CREATE INDEX client_habits_client_position_idx
  ON public.client_habits (client_id, position);
CREATE INDEX client_habits_created_by_idx
  ON public.client_habits (created_by) WHERE created_by IS NOT NULL;

COMMENT ON TABLE public.client_habits IS
  'A client''s habit: what it is. Its prescription is its versions. Written only by the habit functions; deleted only while it has no entries.';
COMMENT ON COLUMN public.client_habits.how_to IS
  'Shown to the client. A label, changed any time.';
COMMENT ON COLUMN public.client_habits.measure IS
  'tick, or number. Never changes: measuring something else is a new habit.';
COMMENT ON COLUMN public.client_habits.unit IS
  'A number habit''s unit, the coach''s word, shown as typed and never converted.';
COMMENT ON COLUMN public.client_habits.direction IS
  'A number habit''s: at_least (water, steps, sleep) or at_most (drinks, screen time).';
COMMENT ON COLUMN public.client_habits.position IS
  'Its place in the client''s list; order_client_habits rewrites the whole list.';

CREATE TABLE public.client_habit_versions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_habit_id  UUID NOT NULL REFERENCES public.client_habits(id) ON DELETE CASCADE,
  starts_on        DATE NOT NULL,
  ends_on          DATE,
  target           NUMERIC(10,2) CHECK (target >= 0),
  times_per_week   SMALLINT CHECK (times_per_week BETWEEN 1 AND 7),
  created_by       UUID REFERENCES public.coaches(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT client_habit_versions_dates CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT client_habit_versions_no_overlap EXCLUDE USING gist (
    client_habit_id WITH =,
    daterange(starts_on, ends_on, '[]') WITH &&
  )
);

CREATE INDEX client_habit_versions_habit_starts_idx
  ON public.client_habit_versions (client_habit_id, starts_on);
CREATE INDEX client_habit_versions_created_by_idx
  ON public.client_habit_versions (created_by) WHERE created_by IS NOT NULL;

COMMENT ON TABLE public.client_habit_versions IS
  'A habit''s prescription: a run of days with its target and its days. A habit''s versions never overlap and may leave gaps; a version is never edited once its first day has passed.';
COMMENT ON COLUMN public.client_habit_versions.ends_on IS
  'Its last day. NULL: it runs on.';
COMMENT ON COLUMN public.client_habit_versions.target IS
  'A number habit''s target, in its unit, judged in its direction. NULL on a tick habit.';
COMMENT ON COLUMN public.client_habit_versions.times_per_week IS
  'N times a week, on any days. NULL: its weekdays in client_habit_version_days.';

CREATE TABLE public.client_habit_version_days (
  version_id  UUID NOT NULL REFERENCES public.client_habit_versions(id) ON DELETE CASCADE,
  weekday     TEXT NOT NULL CHECK (weekday IN ('monday', 'tuesday', 'wednesday', 'thursday',
                                               'friday', 'saturday', 'sunday')),
  PRIMARY KEY (version_id, weekday)
);

COMMENT ON TABLE public.client_habit_version_days IS
  'The weekdays a set-days version is planned on; every day is all seven. No timestamps: a row is written and removed with its version and never updated.';

CREATE TABLE public.client_habit_day_edits (
  client_habit_id  UUID NOT NULL REFERENCES public.client_habits(id) ON DELETE CASCADE,
  date             DATE NOT NULL,
  planned          BOOLEAN NOT NULL,
  target           NUMERIC(10,2) CHECK (target >= 0),
  coach_id         UUID REFERENCES public.coaches(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_habit_id, date),
  CONSTRAINT client_habit_day_edits_target_when_planned CHECK (planned OR target IS NULL)
);

CREATE INDEX client_habit_day_edits_coach_idx
  ON public.client_habit_day_edits (coach_id) WHERE coach_id IS NOT NULL;

COMMENT ON TABLE public.client_habit_day_edits IS
  'The coach''s change to one date of a set-days habit, today onward: planned or not, and that day''s target. Lives only on a day a set-days version covers.';
COMMENT ON COLUMN public.client_habit_day_edits.target IS
  'That day''s target. NULL: the version''s.';

CREATE TABLE public.client_habit_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_habit_id  UUID NOT NULL REFERENCES public.client_habits(id) ON DELETE NO ACTION,
  client_id        UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  date             DATE NOT NULL,
  done             BOOLEAN,
  value            NUMERIC(10,2) CHECK (value >= 0),
  note             TEXT CHECK (char_length(note) <= 500),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT client_habit_logs_one_per_day UNIQUE (client_habit_id, date),
  CONSTRAINT client_habit_logs_one_answer CHECK ((done IS NULL) <> (value IS NULL))
);

CREATE INDEX client_habit_logs_client_date_idx
  ON public.client_habit_logs (client_id, date);

COMMENT ON TABLE public.client_habit_logs IS
  'The client''s entry: one per habit per day, on a day a version covers. Carries no target -- met is worked out against the day''s target when asked. A habit with entries cannot be deleted (NO ACTION), while a client''s teardown removes both in one statement.';
COMMENT ON COLUMN public.client_habit_logs.client_id IS
  'Denormalised from the habit, as on every client log: the day reads find a client''s entries by (client_id, date). Written by the entry service from the habit it has proved is the client''s.';
COMMENT ON COLUMN public.client_habit_logs.done IS
  'A tick habit''s answer: done, or not done. NULL on a number habit''s entry.';
COMMENT ON COLUMN public.client_habit_logs.value IS
  'A number habit''s answer, in its unit, as entered. NULL on a tick habit''s entry.';

CREATE TRIGGER update_client_habits_updated_at
  BEFORE UPDATE ON public.client_habits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_client_habit_versions_updated_at
  BEFORE UPDATE ON public.client_habit_versions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_client_habit_day_edits_updated_at
  BEFORE UPDATE ON public.client_habit_day_edits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_client_habit_logs_updated_at
  BEFORE UPDATE ON public.client_habit_logs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.client_habits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_habit_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_habit_version_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_habit_day_edits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_habit_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.client_habits, public.client_habit_versions, public.client_habit_version_days,
                    public.client_habit_day_edits, public.client_habit_logs
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.client_habits, public.client_habit_versions, public.client_habit_version_days,
                      public.client_habit_day_edits
  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.client_habit_logs TO service_role;

-- ---------------------------------------------------------------------------
-- 2. The write functions.
-- ---------------------------------------------------------------------------

-- One or more habits from a start day, today or later, appended to the
-- client's list in the order given. p_habits is a JSON array; each element:
-- name, how_to, measure ('tick' | 'number'), unit, direction ('at_least' |
-- 'at_most'), target, and either weekdays (a list; every day is all seven) or
-- times_per_week. A number habit has a target; a tick habit has none. Returns
-- the new habits' ids, in order.
CREATE FUNCTION public.add_client_habits(
  p_client_id UUID,
  p_today DATE,
  p_starts_on DATE,
  p_habits JSONB,
  p_created_by UUID DEFAULT NULL
)
RETURNS UUID[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_habit JSONB;
  v_position INTEGER;
  v_target NUMERIC(10,2);
  v_times SMALLINT;
  v_weekdays TEXT[];
  v_habit_id UUID;
  v_version_id UUID;
  v_ids UUID[] := '{}';
BEGIN
  IF p_client_id IS NULL OR p_today IS NULL OR p_starts_on IS NULL
     OR p_habits IS NULL OR jsonb_typeof(p_habits) <> 'array' OR jsonb_array_length(p_habits) = 0 THEN
    RAISE EXCEPTION 'invalid_args: a client, today, a start day and at least one habit are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('client_habits:' || p_client_id::text, 0));

  IF NOT EXISTS (SELECT 1 FROM clients WHERE id = p_client_id) THEN
    RAISE EXCEPTION 'not_found: client % does not exist', p_client_id;
  END IF;
  IF p_starts_on < p_today THEN
    RAISE EXCEPTION 'starts_in_past: a habit starts today or later';
  END IF;

  SELECT COALESCE(MAX(position), 0) INTO v_position FROM client_habits WHERE client_id = p_client_id;

  FOR v_habit IN
    SELECT e.value FROM jsonb_array_elements(p_habits) WITH ORDINALITY AS e(value, n) ORDER BY e.n
  LOOP
    IF jsonb_typeof(v_habit) <> 'object'
       OR jsonb_typeof(COALESCE(v_habit->'weekdays', 'null'::jsonb)) NOT IN ('array', 'null') THEN
      RAISE EXCEPTION 'invalid_args: each habit is an object, its weekdays a list';
    END IF;
    BEGIN
      v_target := (v_habit->>'target')::NUMERIC;
      v_times := (v_habit->>'times_per_week')::SMALLINT;
    EXCEPTION WHEN data_exception THEN
      RAISE EXCEPTION 'invalid_args: %', SQLERRM;
    END;
    v_weekdays := ARRAY(
      SELECT DISTINCT d
        FROM jsonb_array_elements_text(
               CASE WHEN jsonb_typeof(v_habit->'weekdays') = 'array' THEN v_habit->'weekdays' ELSE '[]'::jsonb END
             ) AS d
    );
    IF (v_times IS NULL) = (cardinality(v_weekdays) = 0) THEN
      RAISE EXCEPTION 'invalid_args: a habit runs on chosen weekdays or a number of times a week';
    END IF;
    IF v_habit->>'measure' = 'number' AND v_target IS NULL THEN
      RAISE EXCEPTION 'target_required: a number habit has a target';
    END IF;
    IF v_habit->>'measure' = 'tick' AND v_target IS NOT NULL THEN
      RAISE EXCEPTION 'target_not_allowed: a tick habit has no target';
    END IF;

    v_position := v_position + 1;
    BEGIN
      INSERT INTO client_habits (client_id, name, how_to, measure, unit, direction, position, created_by)
      VALUES (
        p_client_id, btrim(v_habit->>'name'), NULLIF(btrim(v_habit->>'how_to'), ''), v_habit->>'measure',
        NULLIF(btrim(v_habit->>'unit'), ''), v_habit->>'direction', v_position, p_created_by
      )
      RETURNING id INTO v_habit_id;

      INSERT INTO client_habit_versions (client_habit_id, starts_on, target, times_per_week, created_by)
      VALUES (v_habit_id, p_starts_on, v_target, v_times, p_created_by)
      RETURNING id INTO v_version_id;

      INSERT INTO client_habit_version_days (version_id, weekday)
      SELECT v_version_id, d FROM unnest(v_weekdays) AS d;
    EXCEPTION
      WHEN check_violation OR not_null_violation THEN
        RAISE EXCEPTION 'invalid_args: %', SQLERRM;
    END;

    v_ids := v_ids || v_habit_id;
  END LOOP;

  RETURN v_ids;
END;
$$;

-- A habit's target and days from a day, today or later: the version running
-- the day before ends then, a version starting on that day is replaced, and a
-- version queued after it stands. The new prescription runs to the end of the
-- span it falls in -- the running version's own end, a stop dated ahead
-- standing -- or, from a day no version covers (starting a stopped habit
-- again), until the day before the next version, else on. Where the version
-- before it or after it, day to day, carries the same target and days, that
-- version is extended rather than copied. A change to N times a week removes
-- the one-date edits in the days it now covers: those are for set days alone.
-- Returns whether anything changed.
CREATE FUNCTION public.change_client_habit(
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
   WHERE id = p_habit_id AND client_id = p_client_id
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
-- the gap. Returns whether anything changed.
CREATE FUNCTION public.stop_client_habit(
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
   WHERE id = p_habit_id AND client_id = p_client_id
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

-- A habit the client never made an entry for, deleted with its versions and
-- one-date edits. One with entries can only be stopped.
CREATE FUNCTION public.delete_client_habit(
  p_habit_id UUID,
  p_client_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_habit_id IS NULL OR p_client_id IS NULL THEN
    RAISE EXCEPTION 'invalid_args: a habit and a client are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('client_habits:' || p_client_id::text, 0));

  PERFORM 1 FROM client_habits
   WHERE id = p_habit_id AND client_id = p_client_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: habit % is not this client''s', p_habit_id;
  END IF;
  IF EXISTS (SELECT 1 FROM client_habit_logs WHERE client_habit_id = p_habit_id) THEN
    RAISE EXCEPTION 'has_entries: a habit with entries can only be stopped';
  END IF;

  DELETE FROM client_habits WHERE id = p_habit_id AND client_id = p_client_id;
END;
$$;

-- A habit's labels: its name and how-to, on any habit. Returns whether
-- anything changed.
CREATE FUNCTION public.rename_client_habit(
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
   WHERE id = p_habit_id AND client_id = p_client_id
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
-- client's habits, stopped ones included, each once. Returns whether the order
-- changed.
CREATE FUNCTION public.order_client_habits(
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
    SELECT id FROM client_habits WHERE client_id = p_client_id ORDER BY position, created_at, id
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
-- which plans no particular day. Returns whether anything changed.
CREATE FUNCTION public.set_client_habit_day(
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
   WHERE id = p_habit_id AND client_id = p_client_id
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

-- A one-date edit removed, today or later: the day is its version's again.
-- Returns whether there was one.
CREATE FUNCTION public.reset_client_habit_day(
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
   WHERE id = p_habit_id AND client_id = p_client_id
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

REVOKE ALL ON FUNCTION public.add_client_habits(UUID, DATE, DATE, JSONB, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_client_habits(UUID, DATE, DATE, JSONB, UUID)
  TO service_role;
REVOKE ALL ON FUNCTION public.change_client_habit(UUID, UUID, DATE, DATE, UUID, NUMERIC, INTEGER, TEXT[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_client_habit(UUID, UUID, DATE, DATE, UUID, NUMERIC, INTEGER, TEXT[])
  TO service_role;
REVOKE ALL ON FUNCTION public.stop_client_habit(UUID, UUID, DATE, DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stop_client_habit(UUID, UUID, DATE, DATE)
  TO service_role;
REVOKE ALL ON FUNCTION public.delete_client_habit(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_client_habit(UUID, UUID)
  TO service_role;
REVOKE ALL ON FUNCTION public.rename_client_habit(UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rename_client_habit(UUID, UUID, TEXT, TEXT)
  TO service_role;
REVOKE ALL ON FUNCTION public.order_client_habits(UUID, UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.order_client_habits(UUID, UUID[])
  TO service_role;
REVOKE ALL ON FUNCTION public.set_client_habit_day(UUID, UUID, DATE, DATE, BOOLEAN, UUID, NUMERIC)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_client_habit_day(UUID, UUID, DATE, DATE, BOOLEAN, UUID, NUMERIC)
  TO service_role;
REVOKE ALL ON FUNCTION public.reset_client_habit_day(UUID, UUID, DATE, DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_client_habit_day(UUID, UUID, DATE, DATE)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The read behind reuse.
-- ---------------------------------------------------------------------------

-- Every habit the coach has given any of their clients, one row per name and
-- way of measuring (names and units compared without case), each with the
-- how-to, target and days of its most recently written version -- less the
-- ones this client has running or planned on or after p_today, the client's
-- today. Nothing is stored: a habit leaves the list only when no client has
-- it any more. A client that is not this coach's reads nothing.
CREATE FUNCTION public.coach_habit_choices(
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

REVOKE ALL ON FUNCTION public.coach_habit_choices(UUID, UUID, DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coach_habit_choices(UUID, UUID, DATE)
  TO service_role;
