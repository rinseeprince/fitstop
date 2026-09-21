-- =============================================================================
-- Migration 191: race-distance PRs and every exercise's bests
-- (training upgrade, commit 16b; docs/TRAINING-UPGRADE-EXECUTION-PLAN.md
-- section 4.4, owner 2026-09-21)
--
-- An Endurance exercise's best times are kept at the race distances - 400 m,
-- 800 m, 1 km, 1600 m, 1 mile, 5 km, 10 km, half marathon, marathon, 50 km and
-- 100 km - and an Erg exercise's at the erg distances - 500 m, 1 km, 2 km,
-- 5 km, 6 km, 10 km, half marathon and marathon. A set counts for a race
-- distance when it is within half a percent of it, and for the nearer of two
-- where both are that close (1600 m and the mile are 9 m apart). A set at no
-- race distance earns no best time: no time is estimated. Every other type
-- keeps its best times, and every type its heaviest carries, per exact logged
-- distance. A set's time is its typed time, else its pace or its split over
-- its distance - the rule the Sessions table reads a set's time by
-- (utils/exercise-session-markers.ts). utils/race-distances.ts is the one table
-- of the races, and utils/race-distances.test.ts holds this file to it.
--
-- One exercise, one set of logs. Which exercise a logged exercise belongs to
-- is exercise_log_identity: the catalog exercise done, else the one
-- prescribed, else the name typed - get_client_exercise_list's rule since 094.
-- The progression window and the PRs matched a catalog id on the exercise done
-- OR the one prescribed, so a swapped exercise's sets counted for both, and a
-- name on any log that typed it, so a freehand name's view counted the catalog
-- logs of that name. Every function below reads the identity, so an exercise's
-- chart, its Sessions table, its PRs and its row of every exercise's bests all
-- read the logs the exercise list counts for it.
--
-- client_exercises is the exercises a client has logged, one row each - the
-- list's rows with their identity and their sessions; get_client_exercise_list
-- is those rows as before. exercise_records is the one statement of the
-- records: the five kinds on migration 190's set rules, a set's time and the
-- race buckets, for every exercise of the client or for one, each record with
-- the session that set it. get_exercise_prs is one exercise's records; its
-- rows gain race and session_log_id, a new return shape, so it is dropped and
-- created. get_client_exercise_bests is new: one row per exercise the client
-- has logged with its records summarised, in one round trip bounded by the
-- exercises logged. get_client_exercise_list and get_exercise_progression_window
-- keep their signatures and shapes, so CREATE OR REPLACE keeps their grants;
-- the lockdown is restated for every function so this file says it.
--
-- Nothing is stored. LANGUAGE sql / SECURITY INVOKER / SET search_path = public
-- as 094 to 190; service_role alone may execute any of them. Pure ASCII.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- exercise_log_identity: which exercise a logged exercise belongs to
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION exercise_log_identity(
  p_exercise_id UUID,
  p_prescribed_exercise_id UUID,
  p_performed_name TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(
    p_exercise_id::TEXT,
    p_prescribed_exercise_id::TEXT,
    LOWER(p_performed_name),
    'unknown'
  );
$$;

-- -----------------------------------------------------------------------------
-- client_exercises: the exercises a client has logged, one row each
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION client_exercises(
  p_client_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
  identity_key TEXT,
  exercise_id UUID,
  name TEXT,
  exercise_type TEXT,
  log_count INT,
  session_count INT,
  last_logged_date TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH resolved AS (
    SELECT
      sl.id AS session_log_id,
      sl.completed_at,
      el.id AS exercise_log_id,
      COALESCE(el.exercise_id, te.exercise_id) AS resolved_exercise_id,
      el.performed_name,
      exercise_log_identity(el.exercise_id, te.exercise_id, el.performed_name) AS identity_key
    FROM exercise_logs el
    JOIN session_logs sl ON sl.id = el.session_log_id
    LEFT JOIN training_exercises te ON te.id = el.training_exercise_id
    WHERE sl.client_id = p_client_id
      AND (p_start_date IS NULL OR sl.completed_at >= p_start_date)
      AND (p_end_date   IS NULL OR sl.completed_at <  (p_end_date + INTERVAL '1 day'))
  ),
  grouped AS (
    SELECT
      r.identity_key,
      (ARRAY_AGG(r.resolved_exercise_id ORDER BY r.completed_at DESC, r.exercise_log_id DESC)
        FILTER (WHERE r.resolved_exercise_id IS NOT NULL))[1] AS exercise_id,
      COALESCE(
        (ARRAY_AGG(r.performed_name ORDER BY r.completed_at DESC NULLS LAST, r.exercise_log_id DESC))[1],
        'Unknown exercise'
      ) AS name,
      COUNT(*)::INT AS log_count,
      COUNT(DISTINCT r.session_log_id)::INT AS session_count,
      MAX(r.completed_at) AS last_logged_date
    FROM resolved r
    GROUP BY r.identity_key
  )
  SELECT
    g.identity_key,
    g.exercise_id,
    g.name,
    ex.exercise_type,
    g.log_count,
    g.session_count,
    g.last_logged_date
  FROM grouped g
  LEFT JOIN exercises ex ON ex.id = g.exercise_id;
$$;

-- -----------------------------------------------------------------------------
-- get_client_exercise_list: the exercise picker's rows, as before
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_client_exercise_list(
  p_client_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
  exercise_id UUID,
  name TEXT,
  log_count INT,
  last_logged_date TIMESTAMPTZ,
  exercise_type TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT c.exercise_id, c.name, c.log_count, c.last_logged_date, c.exercise_type
  FROM client_exercises(p_client_id, p_start_date, p_end_date) c
  ORDER BY c.log_count DESC, c.name ASC;
$$;

-- -----------------------------------------------------------------------------
-- get_exercise_progression_window: one exercise's logs by the identity
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_exercise_progression_window(
  p_client_id UUID,
  p_exercise_id UUID DEFAULT NULL,
  p_exercise_name TEXT DEFAULT NULL,
  p_session_count INT DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
  session_log_id UUID,
  completed_at TIMESTAMPTZ,
  exercise_log_id UUID,
  prescribed_exercise_snapshot JSONB,
  set_id UUID,
  set_number INT,
  set_type TEXT,
  reps INT,
  weight NUMERIC,
  rpe NUMERIC,
  rir NUMERIC,
  distance_meters NUMERIC,
  duration_seconds NUMERIC,
  pace_seconds_per_km INT,
  split_seconds_per_500m NUMERIC,
  calories INT,
  cadence INT,
  stroke_rate INT,
  resistance NUMERIC,
  heart_rate_zone INT,
  heart_rate INT,
  power INT,
  ftp_percent NUMERIC,
  rest_seconds INT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH matching AS (
    SELECT
      el.id AS exercise_log_id,
      el.session_log_id,
      sl.completed_at,
      el.prescribed_exercise_snapshot
    FROM exercise_logs el
    JOIN session_logs sl ON sl.id = el.session_log_id
    LEFT JOIN training_exercises te ON te.id = el.training_exercise_id
    WHERE sl.client_id = p_client_id
      AND exercise_log_identity(el.exercise_id, te.exercise_id, el.performed_name)
        = COALESCE(p_exercise_id::TEXT, LOWER(p_exercise_name))
      AND (p_start_date IS NULL OR sl.completed_at >= p_start_date)
      AND (p_end_date   IS NULL OR sl.completed_at <  (p_end_date + INTERVAL '1 day'))
  ),
  windowed_sessions AS (
    SELECT m.session_log_id, MIN(m.completed_at) AS completed_at
    FROM matching m
    GROUP BY m.session_log_id
    ORDER BY MIN(m.completed_at) DESC, m.session_log_id DESC
    LIMIT COALESCE(
      p_session_count,
      CASE WHEN p_start_date IS NULL AND p_end_date IS NULL THEN 12 END
    )
  )
  SELECT
    m.session_log_id,
    m.completed_at,
    m.exercise_log_id,
    m.prescribed_exercise_snapshot,
    sl.id AS set_id,
    sl.set_number,
    sl.set_type,
    sl.reps,
    sl.weight,
    sl.rpe,
    sl.rir,
    sl.distance_meters,
    sl.duration_seconds,
    sl.pace_seconds_per_km,
    sl.split_seconds_per_500m,
    sl.calories,
    sl.cadence,
    sl.stroke_rate,
    sl.resistance,
    sl.heart_rate_zone,
    sl.heart_rate,
    sl.power,
    sl.ftp_percent,
    sl.rest_seconds
  FROM matching m
  JOIN windowed_sessions ws ON ws.session_log_id = m.session_log_id
  LEFT JOIN set_logs sl ON sl.exercise_log_id = m.exercise_log_id
  ORDER BY m.completed_at ASC, m.session_log_id ASC, m.exercise_log_id ASC, sl.set_number ASC NULLS LAST;
$$;

-- -----------------------------------------------------------------------------
-- exercise_records: the one statement of the records
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION exercise_records(
  p_client_id UUID,
  p_identity_key TEXT DEFAULT NULL,
  p_exclude_dates DATE[] DEFAULT NULL
)
RETURNS TABLE (
  identity_key TEXT,
  kind TEXT,
  reps INT,
  weight NUMERIC,
  distance_meters NUMERIC,
  duration_seconds NUMERIC,
  race TEXT,
  date TIMESTAMPTZ,
  session_log_id UUID
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH logs AS (
    -- The client's logged exercises - every exercise, or the one asked for -
    -- each with its type: the catalog row's, Strength for a name typed.
    -- p_exclude_dates leaves out the sessions attributed to those days, so the
    -- records come back as they stood before them (the Overview's PR feed).
    SELECT
      exercise_log_identity(el.exercise_id, te.exercise_id, el.performed_name) AS identity_key,
      COALESCE(ex.exercise_type, 'strength') AS exercise_type,
      el.id AS exercise_log_id,
      slg.id AS session_log_id,
      slg.completed_at,
      slg.created_at
    FROM exercise_logs el
    JOIN session_logs slg ON slg.id = el.session_log_id
    LEFT JOIN training_exercises te ON te.id = el.training_exercise_id
    LEFT JOIN exercises ex ON ex.id = COALESCE(el.exercise_id, te.exercise_id)
    WHERE slg.client_id = p_client_id
      AND (
        p_identity_key IS NULL
        OR exercise_log_identity(el.exercise_id, te.exercise_id, el.performed_name) = p_identity_key
      )
      AND (
        p_exclude_dates IS NULL
        OR NOT ((slg.completed_at AT TIME ZONE 'UTC')::DATE = ANY (p_exclude_dates))
      )
  ),
  sets AS (
    -- Every working set: warm-ups count toward nothing. A set's time is its
    -- typed time, else its pace or split over its distance.
    SELECT
      l.identity_key,
      l.exercise_type,
      l.session_log_id,
      l.completed_at,
      l.created_at,
      s.reps,
      s.weight,
      s.distance_meters,
      s.duration_seconds,
      COALESCE(
        s.duration_seconds,
        s.pace_seconds_per_km * s.distance_meters / 1000,
        s.split_seconds_per_500m * s.distance_meters / 500
      ) AS time_seconds
    FROM logs l
    JOIN set_logs s ON s.exercise_log_id = l.exercise_log_id
    WHERE s.set_type <> 'warmup'
  ),
  races (exercise_type, race, meters) AS (
    -- utils/race-distances.ts, row for row
    VALUES
      ('endurance', '400m', 400::NUMERIC),
      ('endurance', '800m', 800),
      ('endurance', '1k', 1000),
      ('endurance', '1600m', 1600),
      ('endurance', 'mile', 1609.344),
      ('endurance', '5k', 5000),
      ('endurance', '10k', 10000),
      ('endurance', 'half_marathon', 21097.5),
      ('endurance', 'marathon', 42195),
      ('endurance', '50k', 50000),
      ('endurance', '100k', 100000),
      ('erg', '500m', 500),
      ('erg', '1k', 1000),
      ('erg', '2k', 2000),
      ('erg', '5k', 5000),
      ('erg', '6k', 6000),
      ('erg', '10k', 10000),
      ('erg', 'half_marathon', 21097.5),
      ('erg', 'marathon', 42195)
  ),
  timed AS (
    -- Every set with a distance and a time, at its distance: for a type with
    -- race distances, the race it is within half a percent of - the nearer
    -- where two are - and none at all when it matches none; else the distance
    -- as logged.
    SELECT
      s.identity_key,
      s.session_log_id,
      s.completed_at,
      s.created_at,
      s.time_seconds,
      bucket.race,
      COALESCE(bucket.meters, s.distance_meters) AS distance_meters
    FROM sets s
    LEFT JOIN LATERAL (
      SELECT r.race, r.meters
      FROM races r
      WHERE r.exercise_type = s.exercise_type
        AND ABS(s.distance_meters - r.meters) <= r.meters * 0.005
      ORDER BY ABS(s.distance_meters - r.meters) ASC, r.meters ASC
      LIMIT 1
    ) bucket ON TRUE
    WHERE s.distance_meters IS NOT NULL
      AND s.time_seconds IS NOT NULL
      AND (
        bucket.race IS NOT NULL
        OR NOT EXISTS (SELECT 1 FROM races r WHERE r.exercise_type = s.exercise_type)
      )
  ),
  rep_max AS (
    -- The heaviest weight per rep count, over lifts: a load with reps and
    -- neither a distance nor a time (reps on a distance or a time are repeats)
    SELECT DISTINCT ON (s.identity_key, s.reps)
      s.identity_key,
      'rep_max'::TEXT AS kind,
      s.reps,
      s.weight,
      NULL::NUMERIC AS distance_meters,
      NULL::NUMERIC AS duration_seconds,
      NULL::TEXT AS race,
      s.completed_at,
      s.session_log_id
    FROM sets s
    WHERE s.reps IS NOT NULL AND s.weight IS NOT NULL AND s.weight > 0
      AND s.distance_meters IS NULL AND s.duration_seconds IS NULL
    ORDER BY s.identity_key, s.reps ASC, s.weight DESC,
      s.completed_at ASC, s.created_at ASC, s.session_log_id ASC
  ),
  best_reps AS (
    -- The most reps in a set logged with no load, and neither a distance nor a time
    SELECT DISTINCT ON (s.identity_key)
      s.identity_key,
      'best_reps'::TEXT AS kind,
      s.reps,
      NULL::NUMERIC AS weight,
      NULL::NUMERIC AS distance_meters,
      NULL::NUMERIC AS duration_seconds,
      NULL::TEXT AS race,
      s.completed_at,
      s.session_log_id
    FROM sets s
    WHERE s.reps IS NOT NULL AND (s.weight IS NULL OR s.weight <= 0)
      AND s.distance_meters IS NULL AND s.duration_seconds IS NULL
    ORDER BY s.identity_key, s.reps DESC,
      s.completed_at ASC, s.created_at ASC, s.session_log_id ASC
  ),
  best_time AS (
    -- The fastest time at each distance of an exercise, its 50 shortest
    SELECT
      b.identity_key,
      'best_time'::TEXT AS kind,
      NULL::INT AS reps,
      NULL::NUMERIC AS weight,
      b.distance_meters,
      b.time_seconds AS duration_seconds,
      b.race,
      b.completed_at,
      b.session_log_id
    FROM (
      SELECT
        f.*,
        ROW_NUMBER() OVER (PARTITION BY f.identity_key ORDER BY f.distance_meters ASC) AS place
      FROM (
        SELECT DISTINCT ON (t.identity_key, t.distance_meters) t.*
        FROM timed t
        ORDER BY t.identity_key, t.distance_meters ASC, t.time_seconds ASC,
          t.completed_at ASC, t.created_at ASC, t.session_log_id ASC
      ) f
    ) b
    WHERE b.place <= 50
  ),
  heaviest_carry AS (
    -- The heaviest load carried at each distance as logged, its 50 shortest
    SELECT
      b.identity_key,
      'heaviest_carry'::TEXT AS kind,
      NULL::INT AS reps,
      b.weight,
      b.distance_meters,
      NULL::NUMERIC AS duration_seconds,
      NULL::TEXT AS race,
      b.completed_at,
      b.session_log_id
    FROM (
      SELECT
        f.*,
        ROW_NUMBER() OVER (PARTITION BY f.identity_key ORDER BY f.distance_meters ASC) AS place
      FROM (
        SELECT DISTINCT ON (s.identity_key, s.distance_meters) s.*
        FROM sets s
        WHERE s.distance_meters IS NOT NULL AND s.weight IS NOT NULL AND s.weight > 0
        ORDER BY s.identity_key, s.distance_meters ASC, s.weight DESC,
          s.completed_at ASC, s.created_at ASC, s.session_log_id ASC
      ) f
    ) b
    WHERE b.place <= 50
  ),
  longest_hold AS (
    -- The longest set logged with a time and no distance
    SELECT DISTINCT ON (s.identity_key)
      s.identity_key,
      'longest_hold'::TEXT AS kind,
      NULL::INT AS reps,
      NULL::NUMERIC AS weight,
      NULL::NUMERIC AS distance_meters,
      s.duration_seconds,
      NULL::TEXT AS race,
      s.completed_at,
      s.session_log_id
    FROM sets s
    WHERE s.duration_seconds IS NOT NULL AND s.distance_meters IS NULL
    ORDER BY s.identity_key, s.duration_seconds DESC,
      s.completed_at ASC, s.created_at ASC, s.session_log_id ASC
  )
  SELECT * FROM rep_max
  UNION ALL SELECT * FROM best_reps
  UNION ALL SELECT * FROM best_time
  UNION ALL SELECT * FROM heaviest_carry
  UNION ALL SELECT * FROM longest_hold;
$$;

-- -----------------------------------------------------------------------------
-- get_exercise_prs: one exercise's records (+ race, + session_log_id)
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS get_exercise_prs(UUID, UUID, TEXT, DATE[]);
-- a plain DROP, NO CASCADE -- called only from the service via PostgREST, no
-- DB dependents. If it errors on a dependency, STOP and investigate.

CREATE OR REPLACE FUNCTION get_exercise_prs(
  p_client_id UUID,
  p_exercise_id UUID DEFAULT NULL,
  p_exercise_name TEXT DEFAULT NULL,
  p_exclude_dates DATE[] DEFAULT NULL
)
RETURNS TABLE (
  kind TEXT,
  reps INT,
  weight NUMERIC,
  distance_meters NUMERIC,
  duration_seconds NUMERIC,
  race TEXT,
  date TIMESTAMPTZ,
  session_log_id UUID
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT r.kind, r.reps, r.weight, r.distance_meters, r.duration_seconds, r.race, r.date, r.session_log_id
  FROM exercise_records(
    p_client_id,
    COALESCE(p_exercise_id::TEXT, LOWER(p_exercise_name)),
    p_exclude_dates
  ) r
  -- Neither an id nor a name asks for no exercise, never for every one
  WHERE COALESCE(p_exercise_id::TEXT, LOWER(p_exercise_name)) IS NOT NULL
  ORDER BY r.kind ASC, r.reps ASC NULLS LAST, r.distance_meters ASC NULLS LAST;
$$;

-- -----------------------------------------------------------------------------
-- get_client_exercise_bests: every exercise the client has logged, its bests
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_client_exercise_bests(
  p_client_id UUID
)
RETURNS TABLE (
  exercise_id UUID,
  name TEXT,
  exercise_type TEXT,
  session_count INT,
  last_logged_date TIMESTAMPTZ,
  heaviest_load NUMERIC,
  best_e1rm_weight NUMERIC,
  best_e1rm_reps INT,
  best_reps INT,
  best_time_race TEXT,
  best_time_seconds NUMERIC,
  heaviest_carry_weight NUMERIC,
  heaviest_carry_distance_meters NUMERIC,
  longest_hold_seconds NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH records AS MATERIALIZED (
    SELECT * FROM exercise_records(p_client_id)
  ),
  lifts AS (
    -- The heaviest of its rep maxes
    SELECT r.identity_key, MAX(r.weight) AS heaviest_load
    FROM records r
    WHERE r.kind = 'rep_max'
    GROUP BY r.identity_key
  ),
  estimate AS (
    -- The rep max that gives the best Epley estimate (utils/exercise-analytics-helpers.ts:
    -- the weight itself for a single, none past 30 reps); the service computes it
    SELECT DISTINCT ON (r.identity_key) r.identity_key, r.weight, r.reps
    FROM records r
    WHERE r.kind = 'rep_max' AND r.reps <= 30
    ORDER BY r.identity_key,
      CASE WHEN r.reps = 1 THEN r.weight ELSE r.weight * (30 + r.reps) / 30 END DESC,
      r.date ASC
  ),
  race_time AS (
    -- Its record at the longest race distance it holds one at
    SELECT DISTINCT ON (r.identity_key) r.identity_key, r.race, r.duration_seconds
    FROM records r
    WHERE r.kind = 'best_time' AND r.race IS NOT NULL
    ORDER BY r.identity_key, r.distance_meters DESC
  ),
  carry AS (
    -- The heaviest load carried, at the longer distance on a tie
    SELECT DISTINCT ON (r.identity_key) r.identity_key, r.weight, r.distance_meters
    FROM records r
    WHERE r.kind = 'heaviest_carry'
    ORDER BY r.identity_key, r.weight DESC, r.distance_meters DESC
  ),
  singles AS (
    -- The one best set and the one longest hold each exercise has
    SELECT
      r.identity_key,
      MAX(r.reps) FILTER (WHERE r.kind = 'best_reps') AS best_reps,
      MAX(r.duration_seconds) FILTER (WHERE r.kind = 'longest_hold') AS longest_hold_seconds
    FROM records r
    GROUP BY r.identity_key
  )
  SELECT
    c.exercise_id,
    c.name,
    c.exercise_type,
    c.session_count,
    c.last_logged_date,
    l.heaviest_load,
    e.weight AS best_e1rm_weight,
    e.reps AS best_e1rm_reps,
    s.best_reps,
    t.race AS best_time_race,
    t.duration_seconds AS best_time_seconds,
    k.weight AS heaviest_carry_weight,
    k.distance_meters AS heaviest_carry_distance_meters,
    s.longest_hold_seconds
  FROM client_exercises(p_client_id) c
  LEFT JOIN lifts l ON l.identity_key = c.identity_key
  LEFT JOIN estimate e ON e.identity_key = c.identity_key
  LEFT JOIN race_time t ON t.identity_key = c.identity_key
  LEFT JOIN carry k ON k.identity_key = c.identity_key
  LEFT JOIN singles s ON s.identity_key = c.identity_key
  ORDER BY c.session_count DESC, c.name ASC;
$$;

-- -----------------------------------------------------------------------------
-- The grant lockdown: service_role alone may execute any of them
-- -----------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION exercise_log_identity(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION exercise_log_identity(UUID, UUID, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION client_exercises(UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION client_exercises(UUID, DATE, DATE) TO service_role;

REVOKE EXECUTE ON FUNCTION get_client_exercise_list(UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION get_client_exercise_list(UUID, DATE, DATE) TO service_role;

REVOKE EXECUTE ON FUNCTION get_exercise_progression_window(UUID, UUID, TEXT, INT, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION get_exercise_progression_window(UUID, UUID, TEXT, INT, DATE, DATE) TO service_role;

REVOKE EXECUTE ON FUNCTION exercise_records(UUID, TEXT, DATE[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION exercise_records(UUID, TEXT, DATE[]) TO service_role;

REVOKE EXECUTE ON FUNCTION get_exercise_prs(UUID, UUID, TEXT, DATE[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION get_exercise_prs(UUID, UUID, TEXT, DATE[]) TO service_role;

REVOKE EXECUTE ON FUNCTION get_client_exercise_bests(UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION get_client_exercise_bests(UUID) TO service_role;
