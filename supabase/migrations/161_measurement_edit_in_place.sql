-- =============================================================================
-- 161_measurement_edit_in_place.sql -- a reading is EDITED IN PLACE
-- (docs/MEASUREMENT-LOG-PLAN.md commit 8; owner decision 2026-09-03, D23).
--
-- Edit replaces the row's value; add adds a row; editing a check-in's reading
-- edits its own row -- same id, same day, same source, same stamp -- so the
-- check-in's report follows; delete deactivates with Restore (migration 160,
-- unchanged). The day's value is the reading written or edited LAST.
--
-- So the table gains `updated_at`: when the value was last written or edited.
-- It is BACKFILLED from `recorded_at` for every existing row -- never from
-- the default, or every old reading would read as touched today and every
-- day's value would shift -- and only then made NOT NULL DEFAULT now(). A
-- fresh row gets `updated_at = recorded_at` by construction: both defaults
-- evaluate to the same transaction time.
--
-- Every ordering that decided a day's value by `recorded_at` now decides it
-- by `updated_at`: the series index, `client_current_measurements` and
-- `client_baseline_measurements` (views are recreated, since a DROP loses
-- their grants the grant block is repeated; the live view is `SELECT *` and
-- must be recreated to carry the new column).
--
-- The table's grant stays SELECT, INSERT: every UPDATE the table sees is one
-- of three SECURITY DEFINER functions executable by service_role alone --
-- update_measurement (here), void_measurement and restore_measurement (160).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The column, backfilled BEFORE it is constrained.
-- ---------------------------------------------------------------------------
ALTER TABLE public.client_measurements
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

UPDATE public.client_measurements
   SET updated_at = recorded_at
 WHERE updated_at IS NULL;

ALTER TABLE public.client_measurements
  ALTER COLUMN updated_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT NOW();

COMMENT ON TABLE public.client_measurements IS
  'Every body measurement, one row per reading. Edited in place (update_measurement), removed by a mark (void_measurement / restore_measurement), never deleted; the app role holds SELECT and INSERT. The value for a day is the reading written or edited last, by updated_at.';
COMMENT ON COLUMN public.client_measurements.recorded_at IS
  'When the row was written.';
COMMENT ON COLUMN public.client_measurements.updated_at IS
  'When the value was last written or edited. The day''s value is the latest of these (D23).';
COMMENT ON COLUMN public.client_measurements.source_id IS
  'The check-in id for source = check_in; null otherwise. An edit keeps it, so a check-in''s report follows its row.';

-- ---------------------------------------------------------------------------
-- 2. The series index, re-cut on updated_at.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS public.client_measurements_series_idx;
CREATE INDEX client_measurements_series_idx
  ON public.client_measurements (client_id, metric_key, recorded_on DESC, updated_at DESC);

-- ---------------------------------------------------------------------------
-- 3. The views. Dependents first. The live view keeps migration 160's filter;
--    the two derived views carry updated_at and order by it.
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
  ORDER BY m.client_id, m.metric_key, m.recorded_on DESC, m.updated_at DESC;

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
    m.updated_at DESC;

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
-- 4. The edit. Message prefixes are a contract the service maps to typed
--    errors: invalid_args, not_found, voided. The shape of migration 160's
--    pair: scoped by client in SQL (the route proves the coach owns the
--    CLIENT and cannot prove the row does), FOR UPDATE against two clicks.
--
--    Sets `value` and `updated_at = now()` and nothing else. An unchanged
--    value writes nothing and says so (`changed = false`), so the caller
--    audits nothing. `affects_current` is judged AFTER the write: the current
--    view now orders by updated_at, so an edited row wins its day, and the
--    caller recomputes the energy pair on that for weight and body fat -- the
--    same trigger appending a newest reading fires.
--
--    Drops first so a failed push is re-runnable.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.update_measurement(UUID, UUID, NUMERIC);

CREATE FUNCTION public.update_measurement(
  p_id        UUID,
  p_client_id UUID,
  p_value     NUMERIC
)
RETURNS TABLE (metric TEXT, changed BOOLEAN, affects_current BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     client_measurements%ROWTYPE;
  v_affects BOOLEAN;
BEGIN
  IF p_id IS NULL OR p_client_id IS NULL OR p_value IS NULL OR p_value <= 0 THEN
    RAISE EXCEPTION 'invalid_args: p_id, p_client_id and a positive p_value are required';
  END IF;

  SELECT * INTO v_row
    FROM client_measurements
   WHERE id = p_id AND client_id = p_client_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: reading % is not this client''s', p_id;
  END IF;
  IF v_row.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'voided: reading % is removed', p_id;
  END IF;

  IF v_row.value = p_value THEN
    RETURN QUERY SELECT v_row.metric_key, FALSE, FALSE;
    RETURN;
  END IF;

  UPDATE client_measurements
     SET value      = p_value,
         updated_at = NOW()
   WHERE id = p_id;

  SELECT EXISTS (
    SELECT 1
      FROM client_current_measurements c
     WHERE c.client_id = p_client_id
       AND c.metric_key = v_row.metric_key
       AND c.measurement_id = p_id
  ) INTO v_affects;

  RETURN QUERY SELECT v_row.metric_key, TRUE, v_affects;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_measurement(UUID, UUID, NUMERIC)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_measurement(UUID, UUID, NUMERIC)
  TO service_role;
