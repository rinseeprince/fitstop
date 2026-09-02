-- =============================================================================
-- 158_client_measurements.sql -- one log for every body measurement
-- (docs/MEASUREMENT-LOG-PLAN.md section 2; commit 2 of six).
--
-- One append-only table replaces three stores and two caches: the seven
-- measurement columns on check_ins, the body_metrics event log, the physique
-- rows of client_metric_entries, and clients.current_weight /
-- current_body_fat_percentage / starting_weight / starting_body_fat_percentage.
-- This migration CREATES the table, its views and its policy and copies the
-- readings across; the old stores stay in place, unwritten, until the next
-- migration drops them once every writer and reader has moved.
--
-- The rules of the shape, each one here to delete a rule that exists today:
--   1. Append-only. service_role holds SELECT and INSERT and nothing else. A
--      correction is a new row on the same day; history is never rewritten.
--   2. The value for a day is the latest row for that client, metric and day
--      by recorded_at. No source ranking, no tie-break table.
--   3. Writers append only on change (services/measurements-service.ts).
--   4. No cache. "Now" is the newest row, through client_current_measurements;
--      "since start" is the reading as of clients.start_date, through
--      client_baseline_measurements. Nothing is copied onto clients.
--   5. A check-in owns no measurement columns: its readings are rows with
--      source = 'check_in' and source_id = the check-in id.
--
-- measured_at is when the reading was TAKEN, distinct from recorded_at (when
-- it was written); null means the day is known and the time is not. There is
-- no updated_at: this is an immutable log (CONVENTIONS section 8's exception).
--
-- GRANTS ARE EXPLICIT because "auto-expose" being off does NOT leave a new
-- table without privileges here: both projects' default privileges hand ALL to
-- anon, authenticated and service_role the moment a table exists (probed on
-- client_phases, check_in_forms and nutrition_plan_notes, 2026-09-02). Rule 1
-- is therefore a REVOKE followed by two grants, never a GRANT alone.
--
-- THE ONE POLICY (D6): the client app reads its own readings through the
-- session client -- the anon key with the client's JWT -- so authenticated
-- holds SELECT and one policy scoped by CLIENT, never by source: a client sees
-- every reading about them. Coach reads go through service_role and need no
-- policy. Every view carries security_invoker so a JWT read meets the policy.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_measurements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  metric_key   TEXT NOT NULL CHECK (metric_key IN (
                 'weight','bodyFat','waist','hips','chest','arms','thighs'
               )),
  value        NUMERIC NOT NULL CHECK (value > 0),
  recorded_on  DATE NOT NULL,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  measured_at  TIMESTAMPTZ,
  source       TEXT NOT NULL CHECK (source IN (
                 'check_in','coach_entry','client_log','intake'
               )),
  source_id    UUID,
  note         TEXT,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.client_measurements IS
  'Every body measurement, one row per recorded value. Append-only: the app role holds SELECT and INSERT; the value for a day is the latest row by recorded_at. No updated_at by design.';
COMMENT ON COLUMN public.client_measurements.value IS
  'Canonical units: kilograms, centimetres or percent (CONVENTIONS section 20).';
COMMENT ON COLUMN public.client_measurements.recorded_on IS
  'The day the reading belongs to, on the CLIENT''s calendar.';
COMMENT ON COLUMN public.client_measurements.recorded_at IS
  'When the row was written. The day''s value is the latest of these.';
COMMENT ON COLUMN public.client_measurements.measured_at IS
  'When the reading was taken. Null = the day is known, the time is not.';
COMMENT ON COLUMN public.client_measurements.source_id IS
  'The check-in id for source = check_in, and for a later correction of that check-in''s reading; null otherwise.';
COMMENT ON COLUMN public.client_measurements.created_by IS
  'coaches.id for a coach entry -- the same id the audit log records as the actor; null otherwise.';

-- Serves every per-client read: the series, the day's value, the newest row,
-- and the baseline's as-of scan. The partial index serves the check-in fold
-- (rows with source_id IN (...)).
CREATE INDEX IF NOT EXISTS client_measurements_series_idx
  ON public.client_measurements (client_id, metric_key, recorded_on DESC, recorded_at DESC);
CREATE INDEX IF NOT EXISTS client_measurements_source_idx
  ON public.client_measurements (source_id) WHERE source_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. RLS, grants, the one policy
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.client_measurements ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.client_measurements FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.client_measurements TO service_role;
GRANT SELECT ON TABLE public.client_measurements TO authenticated;

DROP POLICY IF EXISTS clients_view_own_measurements ON public.client_measurements;
CREATE POLICY clients_view_own_measurements ON public.client_measurements
  FOR SELECT TO authenticated
  USING (
    client_id IN (SELECT id FROM public.clients WHERE user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 3. The views. Every reader reads client_measurements_live, never the table,
--    so the void filter of the correct/remove commit lands in ONE place.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.client_baseline_measurements;
DROP VIEW IF EXISTS public.client_current_measurements;
DROP VIEW IF EXISTS public.client_measurements_live;

CREATE VIEW public.client_measurements_live WITH (security_invoker = on) AS
  SELECT * FROM public.client_measurements;

-- Rule 2 at the top of the log: one row per client and metric, the newest day's
-- latest write. "Where are they now" for every reader, of any source.
CREATE VIEW public.client_current_measurements WITH (security_invoker = on) AS
  SELECT DISTINCT ON (m.client_id, m.metric_key)
    m.client_id,
    m.metric_key,
    m.value,
    m.recorded_on,
    m.recorded_at,
    m.measured_at,
    m.source,
    m.id AS measurement_id
  FROM public.client_measurements_live m
  ORDER BY m.client_id, m.metric_key, m.recorded_on DESC, m.recorded_at DESC;

-- The reading as of the client's start date, per metric: the latest live row
-- on or before start_date, else the earliest after it, each the day's value by
-- rule 2. Derived, never stored -- it cannot disagree with the series because
-- it IS a point of the series, and it cannot be edited into a number no
-- reading carried. A client with no start date has no baseline.
CREATE VIEW public.client_baseline_measurements WITH (security_invoker = on) AS
  SELECT DISTINCT ON (m.client_id, m.metric_key)
    m.client_id,
    m.metric_key,
    m.value,
    m.recorded_on,
    m.recorded_at,
    m.source,
    m.id AS measurement_id
  FROM public.client_measurements_live m
  JOIN public.clients c ON c.id = m.client_id
  WHERE c.start_date IS NOT NULL
  ORDER BY
    m.client_id,
    m.metric_key,
    (m.recorded_on <= c.start_date) DESC,
    CASE WHEN m.recorded_on <= c.start_date THEN m.recorded_on END DESC,
    CASE WHEN m.recorded_on >  c.start_date THEN m.recorded_on END ASC,
    m.recorded_at DESC;

REVOKE ALL ON TABLE
  public.client_measurements_live,
  public.client_current_measurements,
  public.client_baseline_measurements
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE
  public.client_measurements_live,
  public.client_current_measurements,
  public.client_baseline_measurements
  TO service_role, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Backfill -- the readings the app shows today, and nothing else: the
--    check-in columns, the coach's physique entries and the intake readings.
--    body_metrics' check_in and coach_entry events mirror those two stores
--    (the second carrying 141 duplicate rows from the phantom-write bug this
--    shape ends), its metrics_api events are the check-in sync's own second
--    write, and its nutrition_plan events have no reader (D5); none is copied.
--    The data on both projects is fixture data: this backfill exists so the
--    wire proofs compare the same readings through the two stores and the
--    screens stay populated for the smoke, not to preserve anything.
-- ---------------------------------------------------------------------------
INSERT INTO public.client_measurements
  (client_id, metric_key, value, recorded_on, recorded_at, measured_at, source, source_id)
SELECT
  c.client_id,
  k.metric_key,
  k.value,
  -- The client's calendar day, the same anchor the check-in's period uses.
  (c.created_at AT TIME ZONE cl.timezone)::date,
  c.created_at,
  c.created_at,
  'check_in',
  c.id
FROM public.check_ins c
JOIN public.clients cl ON cl.id = c.client_id
CROSS JOIN LATERAL (VALUES
  ('weight',  c.weight),
  ('bodyFat', c.body_fat_percentage),
  ('waist',   c.waist),
  ('hips',    c.hips),
  ('chest',   c.chest),
  ('arms',    c.arms),
  ('thighs',  c.thighs)
) AS k(metric_key, value)
WHERE c.created_at IS NOT NULL
  AND k.value IS NOT NULL
  AND k.value > 0;

INSERT INTO public.client_measurements
  (client_id, metric_key, value, recorded_on, recorded_at, measured_at, source, source_id, note, created_by)
SELECT
  e.client_id,
  e.metric_key,
  e.value,
  e.entry_date,
  e.updated_at,
  NULL,
  'coach_entry',
  NULL,
  e.note,
  e.created_by
FROM public.client_metric_entries e
WHERE e.metric_key IN ('weight','bodyFat','waist','hips','chest','arms','thighs')
  AND e.value > 0;

INSERT INTO public.client_measurements
  (client_id, metric_key, value, recorded_on, recorded_at, measured_at, source)
SELECT
  b.client_id,
  k.metric_key,
  k.value,
  (b.recorded_at AT TIME ZONE cl.timezone)::date,
  b.recorded_at,
  NULL,
  'intake'
FROM public.body_metrics b
JOIN public.clients cl ON cl.id = b.client_id
CROSS JOIN LATERAL (VALUES
  ('weight',  b.weight),
  ('bodyFat', b.body_fat_percentage)
) AS k(metric_key, value)
WHERE b.source = 'intake_sync'
  AND k.value IS NOT NULL
  AND k.value > 0;

ANALYZE public.client_measurements;
