-- Goal blocks: named stretches of a client's calendar carrying a direction and a
-- speed ("Cut 1, 8 weeks, -0.6 kg/wk"). The client's long-term goal is the
-- destination; blocks are the legs of the journey. Coach-facing word is "block";
-- the schema keeps the workstream's "phase" naming.
--
-- Blocks change WHAT GETS WRITTEN into each nutrition_events row and nothing about
-- how anything reads them. A client with no blocks behaves exactly as today:
-- nutrition_plan_daily_targets stays the fallback grid, unchanged.
--
-- Deliberately absent, per the workstream invariants:
--   - no status column — "active" is derived from starts_on/ends_on at read time,
--     never a flag. Crossing a block boundary is a no-op: the right answer is
--     already written onto every day in advance (there is no scheduler in this
--     repo, so nothing fires on a transition).
--   - no phase_id on any other table — attribution is a date-range join.
--   - no duration_weeks (derivable from the dates) and no position (order by
--     starts_on; a second ordering source can disagree with the first).
--   - no stored target weight and no type enum — rate is the only stored truth.
--     Rate 0 IS maintenance, explicitly; the column is NOT NULL.
--   - no FK to nutrition_plans — blocks are client-scoped, survive a plan delete,
--     and are read by the charts and the check-in comparison.
--
-- No UNIQUE on (client_id, starts_on). Overlaps and gaps are structurally
-- impossible because the service computes the chain from a start date plus a list
-- of durations, so there is no overlap validation to write. A unique index would
-- actively break the delete-and-shift-back: a non-deferrable unique index is
-- checked PER ROW, not at statement end, so a multi-row UPDATE whose FINAL state
-- is unique still fails the moment one shifted row transiently collides with a
-- not-yet-shifted one — in an order Postgres does not define. Deferrability is a
-- property of a CONSTRAINT, and a partial or plain unique INDEX can never be
-- deferred, so there is no version of this that is safe here.
--
-- Value bounds (name non-empty, rate magnitude) live in zod at the route layer,
-- matching migration 131's rule: coach input is validated where the message can
-- reach the coach. Nothing in this repo translates SQLSTATE 23514 — a CHECK
-- violation would reach a coach as raw Postgres text. The two CHECKs below are
-- server-derived invariants that can only fire on a service bug, which is the
-- posture migration 132 takes.
--
-- daily_targets holds this block's 7-row weekday grid, written by nutrition plan
-- generation and NULL until then. Shape:
--   [{ day_of_week, calories, protein_g, carb_g, fat_g }] x 7
-- is_training_day is deliberately NOT stored. It is a per-DATE fact derived from
-- live training_events (services/nutrition-event-service.ts), and a weekday-keyed
-- field cannot represent it — Monday of week 1 may train while Monday of week 3
-- rests. The plan-level grid still carries the column for schema compatibility;
-- it has no production reader.
-- The cardinality CHECK buys EXACTLY THAT: seven array elements. It does NOT
-- guarantee seven DISTINCT weekdays, the right keys, or the right value types.
-- The service and its tests own the rest.
--
-- updated_at is managed in app code (no trigger — matches migrations >= 100).
-- Every UPDATE in the phase service must stamp it, or it stays frozen at insert
-- time: the exact defect migration 096 had to fix for exercises.

CREATE TABLE public.client_phases (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  starts_on        DATE NOT NULL,
  ends_on          DATE NOT NULL,
  rate_per_week_kg NUMERIC NOT NULL,
  daily_targets    JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT client_phases_dates_ordered CHECK (ends_on >= starts_on),
  CONSTRAINT client_phases_grid_cardinality CHECK (
    daily_targets IS NULL
    OR (jsonb_typeof(daily_targets) = 'array' AND jsonb_array_length(daily_targets) = 7)
  )
);

-- Serves both reads: the client's block chain in order, and getPhaseForDate's
-- covering lookup (the date-range predicate that mirrors coversDate).
CREATE INDEX idx_client_phases_client_starts
  ON public.client_phases (client_id, starts_on);

-- CONVENTIONS §8: deny-all RLS (no policies — every app read/write goes through
-- service_role, which bypasses RLS) + explicit grant because auto-expose is off.
ALTER TABLE IF EXISTS public.client_phases ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.client_phases TO service_role;
