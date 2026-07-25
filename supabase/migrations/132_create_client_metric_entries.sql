-- Coach-logged measurement entries for the client Metrics page.
-- One row per (client, metric, calendar date); re-logging the same metric on the
-- same date REPLACES the earlier value (upsert) — rows are mutable and carry
-- updated_at (NOT the immutable-event exception of body_metrics). This table
-- does not replace body_metrics: weight/bodyFat entries additionally dual-write
-- a body_metrics event so the clients.current_weight cache and phase
-- comparisons stay coherent (see services/metric-entries-service.ts).
-- metric_key stores the coach metrics page's canonical metric ids VERBATIM
-- (METRIC_DEFINITIONS ids in components/clients/metrics/hooks/use-metrics-data.ts,
-- mirrored in lib/metrics/metric-entry-definitions.ts) — camelCase 'bodyFat' is
-- a stored value, not an identifier, so the read path needs no key mapping.
-- Values are stored in the client's display units (client.weight_unit for
-- weight, inches for girths) matching how the page renders check-in history;
-- no per-row unit snapshot (the read path ignores per-row units today; the
-- body_metrics dual-write keeps its own weight_unit snapshot).
-- updated_at is managed in app code (no trigger — matches migrations >= 100).

CREATE TABLE public.client_metric_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL CHECK (metric_key IN (
    'weight','bodyFat','waist','hips','chest','arms','thighs',
    'mood','energy','sleep','stress','soreness'
  )),
  value NUMERIC NOT NULL CHECK (value > 0),
  entry_date DATE NOT NULL,
  note TEXT,
  -- who logged it (coach-side only for now); SET NULL so deleting a coach
  -- never destroys a client's measurement history
  created_by UUID REFERENCES public.coaches(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT client_metric_entries_one_per_day
    UNIQUE (client_id, metric_key, entry_date)
);

-- Serves the page's single read ("all entries for this client, newest first");
-- the UNIQUE constraint's index additionally serves the upsert conflict target
-- and per-metric scans.
CREATE INDEX idx_client_metric_entries_client_date
  ON public.client_metric_entries (client_id, entry_date DESC);

-- CONVENTIONS §8: deny-all RLS (no policies — every app read/write goes through
-- service_role, which bypasses RLS) + explicit grant because auto-expose is off.
ALTER TABLE IF EXISTS public.client_metric_entries ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.client_metric_entries TO service_role;
