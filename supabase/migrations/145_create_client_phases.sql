-- Journey blocks (Feature A, CLIENT-GOALS-PHASES-EXECUTION-PLAN Session 2).
-- A block is a NAME, a DATE RANGE, an optional focus SENTENCE and an optional
-- target WEIGHT — nothing else. No phase_id/block_id on any other table (ever);
-- current/past/future derive from today vs [starts_on, ends_on] at read time,
-- never from a status column. The service computes the date chain from
-- durations (starts_on + weeks), so overlaps and gaps are unexpressible
-- through the API. No duration_weeks (derivable), no position (order by
-- starts_on), no status, no daily_targets, no rate.
-- Deleting the block a client is currently inside TRUNCATES it at yesterday
-- (the lived days stay attributed); only never-started blocks are removed.
-- updated_at is managed in app code (no trigger — matches migrations >= 100).

CREATE TABLE IF NOT EXISTS public.client_phases (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  focus         TEXT,
  target_weight NUMERIC,          -- kilograms, always (CONVENTIONS §20)
  starts_on     DATE NOT NULL,
  ends_on       DATE NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Single-row backstop that must never fire (the migration-144 posture): the
  -- one write that could invert a window is the current-block truncate on its
  -- own first day, and app code special-cases it. Cross-row contiguity stays
  -- service-computed by design — the workstream's invariant 3 forbids overlap
  -- validation (durations in, dates out).
  CONSTRAINT client_phases_window_valid CHECK (ends_on >= starts_on)
);

-- Serves every read: the chain in order for one client.
CREATE INDEX IF NOT EXISTS idx_client_phases_client_start
  ON public.client_phases (client_id, starts_on);

-- CONVENTIONS §8: deny-all RLS (no policies — every app read/write goes
-- through service_role, which bypasses RLS) + explicit grant because
-- auto-expose is off.
ALTER TABLE IF EXISTS public.client_phases ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.client_phases TO service_role;

COMMENT ON TABLE public.client_phases IS
  'Journey blocks. The TABLE name is client_phases; the coach-facing noun in routes, types and UI is "block" — deliberate divergence, do not consistency-rename either half.';
COMMENT ON COLUMN public.client_phases.target_weight IS 'Kilograms, always';
