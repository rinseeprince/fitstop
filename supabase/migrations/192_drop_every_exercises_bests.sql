-- =============================================================================
-- Migration 192: the table of every exercise's bests goes
-- (training upgrade, commit 16b; docs/TRAINING-UPGRADE-EXECUTION-PLAN.md
-- section 4.4)
--
-- The owner, at 16b's smoke (2026-09-21): "I do not like the all exercises part
-- of the commit. I think we should remove/revert that. I think previous state
-- was better." The All exercises table is removed; with no exercise picked,
-- both views ask for one again. Its read, get_client_exercise_bests, goes, and
-- so do the two functions migration 191 split out for it to share:
-- exercise_records (the records of every exercise, or one) and client_exercises
-- (the exercise list's rows with their sessions). Their one other reader each
-- takes the body back:
--
-- get_exercise_prs is one exercise's records, as in migration 191 - the five
-- kinds on migration 190's set rules, a set's time (typed, else its pace or
-- split over its distance), the race buckets (utils/race-distances.ts, held to
-- this file by utils/race-distances.test.ts) and the session that set each
-- record. The logs it reads are the exercise's by exercise_log_identity
-- (migration 191): the catalog id asked for, else the name; neither asks for
-- none. The same signature and return shape, so every row it returns is the
-- row migration 191 returned.
--
-- get_client_exercise_list is the exercise picker's rows, keyed by
-- exercise_log_identity, as in migration 191. The same signature and shape.
--
-- Probed on DEV before this file was written (2026-09-21): the functions whose
-- bodies call the three dropped are get_exercise_prs, get_client_exercise_list
-- and get_client_exercise_bests itself, and nothing else - no view, trigger or
-- recorded dependency names them. So the two readers are replaced first, then
-- the three dropped with a plain DROP, no CASCADE; IF EXISTS keeps a
-- half-applied push re-runnable.
--
-- CREATE OR REPLACE keeps the grants; the lockdown is restated so this file
-- says it: service_role alone may execute either. LANGUAGE sql / STABLE /
-- SECURITY INVOKER / SET search_path = public as 094 to 191. Nothing is stored.
-- Pure ASCII.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- get_client_exercise_list: the exercise picker's rows
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
  WITH resolved AS (
    SELECT
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
      (ARRAY_AGG(r.resolved_exercise_id ORDER BY r.completed_at DESC, r.exercise_log_id DESC)
        FILTER (WHERE r.resolved_exercise_id IS NOT NULL))[1] AS exercise_id,
      COALESCE(
        (ARRAY_AGG(r.performed_name ORDER BY r.completed_at DESC NULLS LAST, r.exercise_log_id DESC))[1],
        'Unknown exercise'
      ) AS name,
      COUNT(*)::INT AS log_count,
      MAX(r.completed_at) AS last_logged_date
    FROM resolved r
    GROUP BY r.identity_key
  )
  SELECT
    g.exercise_id,
    g.name,
    g.log_count,
    g.last_logged_date,
    ex.exercise_type
  FROM grouped g
  LEFT JOIN exercises ex ON ex.id = g.exercise_id
  ORDER BY g.log_count DESC, g.name ASC;
$$;

-- -----------------------------------------------------------------------------
-- get_exercise_prs: one exercise's records
-- -----------------------------------------------------------------------------

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
  WITH sets AS (
    -- The exercise's working sets - its logs by the identity, the catalog id
    -- asked for, else the name - each with the exercise's type: the catalog
    -- row's, Strength for a name typed. Warm-ups count toward nothing, and
    -- p_exclude_dates leaves out the sessions attributed to those days, so the
    -- records come back as they stood before them (the Overview's PR feed). A
    -- set's time is its typed time, else its pace or split over its distance.
    SELECT
      COALESCE(ex.exercise_type, 'strength') AS exercise_type,
      slg.id AS session_log_id,
      slg.completed_at,
      slg.created_at,
      s.reps,
      s.weight,
      s.distance_meters,
      s.duration_seconds,
      COALESCE(
        s.duration_seconds,
        s.pace_seconds_per_km * s.distance_meters / 1000,
        s.split_seconds_per_500m * s.distance_meters / 500
      ) AS time_seconds
    FROM exercise_logs el
    JOIN session_logs slg ON slg.id = el.session_log_id
    LEFT JOIN training_exercises te ON te.id = el.training_exercise_id
    LEFT JOIN exercises ex ON ex.id = COALESCE(el.exercise_id, te.exercise_id)
    JOIN set_logs s ON s.exercise_log_id = el.id
    WHERE slg.client_id = p_client_id
      AND exercise_log_identity(el.exercise_id, te.exercise_id, el.performed_name)
        = COALESCE(p_exercise_id::TEXT, LOWER(p_exercise_name))
      AND s.set_type <> 'warmup'
      AND (
        p_exclude_dates IS NULL
        OR NOT ((slg.completed_at AT TIME ZONE 'UTC')::DATE = ANY (p_exclude_dates))
      )
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
    SELECT DISTINCT ON (s.reps)
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
    ORDER BY s.reps ASC, s.weight DESC,
      s.completed_at ASC, s.created_at ASC, s.session_log_id ASC
  ),
  best_reps AS (
    -- The most reps in a set logged with no load, and neither a distance nor a time
    SELECT
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
    ORDER BY s.reps DESC,
      s.completed_at ASC, s.created_at ASC, s.session_log_id ASC
    LIMIT 1
  ),
  best_time AS (
    -- The fastest time at each distance, its 50 shortest
    SELECT DISTINCT ON (t.distance_meters)
      'best_time'::TEXT AS kind,
      NULL::INT AS reps,
      NULL::NUMERIC AS weight,
      t.distance_meters,
      t.time_seconds AS duration_seconds,
      t.race,
      t.completed_at,
      t.session_log_id
    FROM timed t
    ORDER BY t.distance_meters ASC, t.time_seconds ASC,
      t.completed_at ASC, t.created_at ASC, t.session_log_id ASC
    LIMIT 50
  ),
  heaviest_carry AS (
    -- The heaviest load carried at each distance as logged, its 50 shortest
    SELECT DISTINCT ON (s.distance_meters)
      'heaviest_carry'::TEXT AS kind,
      NULL::INT AS reps,
      s.weight,
      s.distance_meters,
      NULL::NUMERIC AS duration_seconds,
      NULL::TEXT AS race,
      s.completed_at,
      s.session_log_id
    FROM sets s
    WHERE s.distance_meters IS NOT NULL AND s.weight IS NOT NULL AND s.weight > 0
    ORDER BY s.distance_meters ASC, s.weight DESC,
      s.completed_at ASC, s.created_at ASC, s.session_log_id ASC
    LIMIT 50
  ),
  longest_hold AS (
    -- The longest set logged with a time and no distance
    SELECT
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
    ORDER BY s.duration_seconds DESC,
      s.completed_at ASC, s.created_at ASC, s.session_log_id ASC
    LIMIT 1
  ),
  records AS (
    SELECT * FROM rep_max
    UNION ALL SELECT * FROM best_reps
    UNION ALL SELECT * FROM best_time
    UNION ALL SELECT * FROM heaviest_carry
    UNION ALL SELECT * FROM longest_hold
  )
  SELECT r.kind, r.reps, r.weight, r.distance_meters, r.duration_seconds, r.race, r.completed_at AS date, r.session_log_id
  FROM records r
  ORDER BY r.kind ASC, r.reps ASC NULLS LAST, r.distance_meters ASC NULLS LAST;
$$;

-- -----------------------------------------------------------------------------
-- The table of every exercise's bests, and the two functions it shared
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS get_client_exercise_bests(UUID);
DROP FUNCTION IF EXISTS exercise_records(UUID, TEXT, DATE[]);
DROP FUNCTION IF EXISTS client_exercises(UUID, DATE, DATE);

-- -----------------------------------------------------------------------------
-- The grant lockdown: service_role alone may execute either
-- -----------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION get_client_exercise_list(UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION get_client_exercise_list(UUID, DATE, DATE) TO service_role;

REVOKE EXECUTE ON FUNCTION get_exercise_prs(UUID, UUID, TEXT, DATE[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION get_exercise_prs(UUID, UUID, TEXT, DATE[]) TO service_role;
