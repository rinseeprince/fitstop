-- =============================================================================
-- coaches.unit_preference — the coach's own viewer unit system.
--
-- WHY: a unit preference belongs to the person LOOKING at a number, not to the
-- record being looked at. Today the only preference column lives on `clients`
-- (migration 011) and does double duty as both the client's display choice and
-- the unit their stored values are assumed to be in — so a coach has no
-- preference of their own, and flipping a client's silently relabels history.
-- A metric coach and an imperial client must be able to work on the same data
-- and each see their own unit. Full model: docs/UNITS-CANONICALIZATION-PLAN.md.
--
-- WHY THE DEFAULT IS METRIC, unlike clients.unit_preference (DEFAULT 'imperial',
-- migration 011:4) and clients.weight_unit (DEFAULT 'lbs', migration 009): those
-- defaults are backwards for this platform's actual users, so every new account
-- starts in the wrong system. The evidence is recorded in the plan doc rather
-- than restated here — a row count baked into the schema is stale the day after
-- it ships. New preference columns default to metric.
--
-- The CHECK is inline on ADD COLUMN IF NOT EXISTS (the shape migration 011 uses)
-- rather than a separate ADD CONSTRAINT, which has no IF NOT EXISTS: a partly
-- failed push stays re-runnable this way.
--
-- No GRANT or RLS clause: this is a new column on an existing table, which
-- carries the table's existing privileges and policies. The
-- ENABLE ROW LEVEL SECURITY + GRANT ... TO service_role pairing in CONVENTIONS
-- §8 governs new TABLES.
-- =============================================================================

ALTER TABLE public.coaches
  ADD COLUMN IF NOT EXISTS unit_preference TEXT NOT NULL DEFAULT 'metric'
    CHECK (unit_preference IN ('metric', 'imperial'));

COMMENT ON COLUMN public.coaches.unit_preference IS
  'The coach''s own display unit system: metric (kg, cm) or imperial (lbs, in). Applies to what THIS coach sees, never to what their clients see — each client has their own on clients.unit_preference. Storage stays canonical kg/cm regardless; this drives presentation only.';
