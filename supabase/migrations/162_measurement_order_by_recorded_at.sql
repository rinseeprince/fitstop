-- =============================================================================
-- 162_measurement_order_by_recorded_at.sql -- recorded_at decides, updated_at
-- records (docs/MEASUREMENT-LOG-PLAN.md commit 8; owner revision 2026-09-03).
--
-- An edit changes a reading's value and nothing else: it never moves the
-- reading within its day and never makes it the day's value. The day's value
-- is the reading WRITTEN last, by recorded_at -- set once at insert and never
-- touched, so no code path can reorder a day by editing. A coach who wants a
-- different number to stand for a day logs a new reading. updated_at
-- (migration 161) stays as the record of when a value was last edited and
-- orders nothing.
--
-- Migration 161 had put the two derived views and the series index on
-- updated_at; this puts them back on recorded_at. The views are recreated
-- verbatim but for the ordering (a DROP loses their grants, so the grant
-- block is repeated). update_measurement is untouched: it judges the row's
-- standing through client_current_measurements after the write, so the
-- energy pair still recomputes only when the edited row is the client's
-- current reading.
-- =============================================================================

COMMENT ON TABLE public.client_measurements IS
  'Every body measurement, one row per reading. Edited in place (update_measurement), removed by a mark (void_measurement / restore_measurement), never deleted; the app role holds SELECT and INSERT. The value for a day is the reading written last, by recorded_at; an edit changes a value and nothing else.';
COMMENT ON COLUMN public.client_measurements.recorded_at IS
  'When the row was written. Set once; the day''s value is the latest of these.';
COMMENT ON COLUMN public.client_measurements.updated_at IS
  'When the value was last written or edited. Records the edit; orders nothing.';

-- ---------------------------------------------------------------------------
-- 1. The series index, back on recorded_at.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS public.client_measurements_series_idx;
CREATE INDEX client_measurements_series_idx
  ON public.client_measurements (client_id, metric_key, recorded_on DESC, recorded_at DESC);

-- ---------------------------------------------------------------------------
-- 2. The views. Dependents first; the live view unchanged; the two derived
--    views order by recorded_at.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.client_baseline_measurements;
DROP VIEW IF EXISTS public.client_current_measurements;
DROP VIEW IF EXISTS public.client_measurements_live;

CREATE VIEW public.client_measurements_live WITH (security_invoker = on) AS
  SELECT * FROM public.client_measurements
   WHERE voided_at IS NULL;

CREATE VIEW public.client_current_measurements WITH (security_invoker = on) AS
  SELECT DISTINCT ON (m.client_id, m.metric_key)
    m.client_id,
    m.metric_key,
    m.value,
    m.recorded_on,
    m.recorded_at,
    m.updated_at,
    m.measured_at,
    m.source,
    m.id AS measurement_id
  FROM public.client_measurements_live m
  ORDER BY m.client_id, m.metric_key, m.recorded_on DESC, m.recorded_at DESC;

CREATE VIEW public.client_baseline_measurements WITH (security_invoker = on) AS
  SELECT DISTINCT ON (m.client_id, m.metric_key)
    m.client_id,
    m.metric_key,
    m.value,
    m.recorded_on,
    m.recorded_at,
    m.updated_at,
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
