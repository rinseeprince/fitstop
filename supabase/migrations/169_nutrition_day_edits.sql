-- =============================================================================
-- 169: nutrition_day_edits -- the coach's per-day override, as its own table.
--
-- WHY (owner decision 2026-09-10): a nutrition day's target is COMPUTED, never
-- stored. The stored nutrition facts are the plan rows (window + weekday grid),
-- this table, the plan-save notes (nutrition_plan_notes) and the client's
-- food-log snapshot; "what is the target on this date" is resolved when asked
-- from the version covering the date, its grid row for the weekday, the
-- session on that date and the edit here. The dense nutrition_events table is
-- read by nothing after this commit and is dropped once its writers are gone.
--
-- THE DATA-MODEL DECISION (CONVENTIONS section 8): an edit is addressed by
-- date, re-edited in place, owned per client and removed on its own -- so it
-- is a TABLE with its own id and foreign keys. The alternative considered and
-- rejected was keeping is_modified rows in the day table; the day table goes.
--
-- SHAPE:
--   - one row per (client_id, date): the coach's numbers stand for that day,
--     take no training surplus, and are re-edited by an upsert on the pair;
--   - note: the client-visible per-day note, part of the edit, cleared with it;
--   - coach_id: the coach who last edited the day -- the audit actor, the same
--     posture as client_measurements.created_by. NULL for a backfilled row;
--   - updated_at: when the edit was last written (rule: updated_at on every
--     mutable table).
--
-- PRIVILEGES: RLS enabled, no policy. Every read and write goes through the
-- service layer under service_role, so a policy would grant access nothing
-- needs. The REVOKE comes first because both projects' default privileges hand
-- ALL to anon, authenticated and service_role the moment a table exists
-- (probed 2026-09-02; 158_client_measurements.sql is the shape).
--
-- BACKFILL: the day table's edited rows (is_modified) become edit rows, so a
-- coach's existing overrides survive the switch. DEV holds three such rows and
-- none carries a note (probed 2026-09-10); PROD holds no day rows at all and
-- is probed again before its push. The macro columns on the day table are
-- NUMERIC while an edit stores integers (every writer rounded), so the copy
-- rounds explicitly.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.nutrition_day_edits (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  calories    INTEGER NOT NULL CHECK (calories >= 0),
  protein_g   INTEGER NOT NULL CHECK (protein_g >= 0),
  carb_g      INTEGER NOT NULL CHECK (carb_g >= 0),
  fat_g       INTEGER NOT NULL CHECK (fat_g >= 0),
  note        TEXT,
  coach_id    UUID REFERENCES public.coaches(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT nutrition_day_edits_client_date_key UNIQUE (client_id, date)
);

COMMENT ON TABLE public.nutrition_day_edits IS
  'The coach''s per-day nutrition override: one row per (client, date). A computed day takes these numbers verbatim and no training surplus; an unedited day has no row. Re-edited by upsert on (client_id, date), removed by delete. Read and written through service_role only.';
COMMENT ON COLUMN public.nutrition_day_edits.note IS
  'The client-visible per-day coach note. Part of the edit: set or cleared with it, and gone when the edit is removed.';
COMMENT ON COLUMN public.nutrition_day_edits.coach_id IS
  'coaches.id of the coach who last wrote the edit -- the audit actor. NULL for a row copied from the retired day table.';

-- The unique constraint's index serves every per-client range read
-- (client_id, date). The FK index serves ON DELETE SET NULL when a coach row
-- goes (CONVENTIONS section 8: indexes on foreign keys); partial because a
-- backfilled row has no coach.
CREATE INDEX IF NOT EXISTS nutrition_day_edits_coach_idx
  ON public.nutrition_day_edits (coach_id) WHERE coach_id IS NOT NULL;

ALTER TABLE IF EXISTS public.nutrition_day_edits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.nutrition_day_edits FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.nutrition_day_edits TO service_role;

-- Backfill: every edited day becomes an edit row, stamps preserved.
INSERT INTO public.nutrition_day_edits
  (client_id, date, calories, protein_g, carb_g, fat_g, note, created_at, updated_at)
SELECT
  e.client_id,
  e.date,
  GREATEST(e.baseline_calories, 0),
  GREATEST(ROUND(e.protein_g)::integer, 0),
  GREATEST(ROUND(e.carb_g)::integer, 0),
  GREATEST(ROUND(e.fat_g)::integer, 0),
  e.note,
  e.created_at,
  e.updated_at
FROM public.nutrition_events e
WHERE e.is_modified
ON CONFLICT (client_id, date) DO NOTHING;

ANALYZE public.nutrition_day_edits;
