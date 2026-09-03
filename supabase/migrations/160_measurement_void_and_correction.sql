-- =============================================================================
-- 160_measurement_void_and_correction.sql -- a reading can be corrected or
-- removed, never deleted (docs/MEASUREMENT-LOG-PLAN.md D9; commit 4 of nine).
--
-- Three columns mark a reading as REMOVED: voided_at, voided_by, void_reason.
-- A removed row is invisible to every calculation and to the client and stays
-- in the history; the coach's measurement list still shows it, muted, with who
-- removed it and when, and one click brings it back.
--
-- The mark is the ONE UPDATE the table ever sees, and it happens here, in the
-- RPC pair below, never through the app role: service_role keeps SELECT and
-- INSERT (migration 158's grant is untouched), the functions are SECURITY
-- DEFINER and execute only for service_role. Each sets or clears the three
-- columns and nothing else, refuses a row already in the target state, and
-- refuses a row outside p_client_id -- the scope belt in SQL, because the
-- route proves the coach owns the CLIENT and cannot prove the row does.
--
-- A wrong VALUE is corrected, not removed: the app appends a new row carrying
-- the original's metric, day and stamp (an INSERT, no function needed), and
-- rule 2 makes it the day's value. A void is for a reading that should never
-- have existed.
--
-- The filter lives in ONE place: client_measurements_live gains
-- `WHERE voided_at IS NULL`, and every reader -- the series, the check-in
-- fold, the client's progress read, the two derived views -- reads it, so a
-- removed row leaves every surface at once. The views are recreated verbatim
-- from migration 158 (a DROP loses their grants, so the grant block is
-- repeated).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The mark. voided_by is the coach (coaches.id, the same id the audit log
--    records) -- a real foreign key, so the list can name them through an
--    embed and a bogus actor fails rather than being stored.
-- ---------------------------------------------------------------------------
ALTER TABLE public.client_measurements
  ADD COLUMN IF NOT EXISTS voided_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by   UUID REFERENCES public.coaches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS void_reason TEXT;

COMMENT ON COLUMN public.client_measurements.voided_at IS
  'Set when the reading was REMOVED: hidden from every calculation and from the client, kept in the history. The only mutation a row ever sees, through void_measurement / restore_measurement.';
COMMENT ON COLUMN public.client_measurements.voided_by IS
  'coaches.id of who removed it; null while live.';
COMMENT ON COLUMN public.client_measurements.void_reason IS
  'Optional, free text; null while live.';

CREATE INDEX IF NOT EXISTS client_measurements_voided_by_idx
  ON public.client_measurements (voided_by) WHERE voided_by IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. The views. Dependents first; the live view gains its filter; the other
--    two are unchanged in text and now see live rows only by construction.
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
-- 3. The RPC pair. Message prefixes are a contract the service maps to typed
--    errors: not_found, already_voided, not_voided, last_weight.
--
--    Each returns the row's metric and whether the row is (void: was, before
--    the mark) or becomes (restore: after it) the client's newest live reading
--    of that metric -- the caller recomputes the energy pair on that, the same
--    trigger appending a newest reading fires.
--
--    Drops first so a failed push is re-runnable.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.void_measurement(UUID, UUID, UUID, TEXT);

CREATE FUNCTION public.void_measurement(
  p_id        UUID,
  p_client_id UUID,
  p_actor     UUID,
  p_reason    TEXT DEFAULT NULL
)
RETURNS TABLE (metric TEXT, affects_current BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     client_measurements%ROWTYPE;
  v_affects BOOLEAN;
BEGIN
  IF p_id IS NULL OR p_client_id IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION 'invalid_args: p_id, p_client_id and p_actor are required';
  END IF;

  -- Scoped by client: a foreign row reads as not found, never as someone
  -- else's. FOR UPDATE serialises two clicks on one row.
  SELECT * INTO v_row
    FROM client_measurements
   WHERE id = p_id AND client_id = p_client_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: reading % is not this client''s', p_id;
  END IF;
  IF v_row.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'already_voided: reading % is already removed', p_id;
  END IF;

  -- An activated client has a weight reading (activation refuses without one)
  -- and the energy pair cannot compute without one; the last live weight is
  -- corrected, never removed. Body fat may go to none -- the formula switches.
  IF v_row.metric_key = 'weight' AND NOT EXISTS (
    SELECT 1
      FROM client_measurements_live l
     WHERE l.client_id = p_client_id
       AND l.metric_key = 'weight'
       AND l.id <> p_id
  ) THEN
    RAISE EXCEPTION 'last_weight: the only weight reading cannot be removed';
  END IF;

  -- Judged BEFORE the mark: once removed the row is no longer live and the
  -- current view has already moved on to the next reading.
  SELECT EXISTS (
    SELECT 1
      FROM client_current_measurements c
     WHERE c.client_id = p_client_id
       AND c.metric_key = v_row.metric_key
       AND c.measurement_id = p_id
  ) INTO v_affects;

  UPDATE client_measurements
     SET voided_at   = NOW(),
         voided_by   = p_actor,
         void_reason = p_reason
   WHERE id = p_id;

  RETURN QUERY SELECT v_row.metric_key, v_affects;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.void_measurement(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.void_measurement(UUID, UUID, UUID, TEXT)
  TO service_role;

DROP FUNCTION IF EXISTS public.restore_measurement(UUID, UUID);

CREATE FUNCTION public.restore_measurement(
  p_id        UUID,
  p_client_id UUID
)
RETURNS TABLE (metric TEXT, affects_current BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     client_measurements%ROWTYPE;
  v_affects BOOLEAN;
BEGIN
  IF p_id IS NULL OR p_client_id IS NULL THEN
    RAISE EXCEPTION 'invalid_args: p_id and p_client_id are required';
  END IF;

  SELECT * INTO v_row
    FROM client_measurements
   WHERE id = p_id AND client_id = p_client_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: reading % is not this client''s', p_id;
  END IF;
  IF v_row.voided_at IS NULL THEN
    RAISE EXCEPTION 'not_voided: reading % is live', p_id;
  END IF;

  UPDATE client_measurements
     SET voided_at   = NULL,
         voided_by   = NULL,
         void_reason = NULL
   WHERE id = p_id;

  -- Judged AFTER the mark is cleared: the row is live again and may be the
  -- client's newest reading of its metric.
  SELECT EXISTS (
    SELECT 1
      FROM client_current_measurements c
     WHERE c.client_id = p_client_id
       AND c.metric_key = v_row.metric_key
       AND c.measurement_id = p_id
  ) INTO v_affects;

  RETURN QUERY SELECT v_row.metric_key, v_affects;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.restore_measurement(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_measurement(UUID, UUID)
  TO service_role;
