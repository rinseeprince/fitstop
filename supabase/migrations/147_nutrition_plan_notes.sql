-- =============================================================================
-- nutrition_plan_notes: the coach's "why am I adjusting this plan?" note, kept
-- where it survives and where the client can read it.
--
-- ANSWERING MIGRATION 139'S HEADER. That migration is a pre-written rejection
-- of plan-level note columns: it dropped nutrition_plans.coach_notes for being
-- invisible, self-destructing and write-only. This table is the opposite on all
-- three counts, and it has to be, or it is the same mistake with a new name.
--
--   1. INVISIBLE -> READ BY TWO SURFACES. 139's column had ZERO read sites
--      anywhere in the app. This table ships with both of its readers in the
--      same session: the coach's per-block "What happened" timeline on the
--      Journey tab, and the client's Program tab.
--
--   2. SELF-DESTRUCTING -> APPEND-ONLY. 139's column was re-stamped by the plan
--      RPC's always-update bucket, so every regenerate nulled the note before
--      it. Rows here are INSERT-only: no UPDATE path, no DELETE path, and
--      deliberately NO unique constraint on (client_id, effective_on). Two
--      saves sharing an effective date leave TWO rows -- that history is the
--      entire point, and it is why the index below carries created_at: "oldest
--      first" needs a tiebreak once a date can hold more than one note.
--
--   3. WRITE-ONLY (coach-private) -> CLIENT-VISIBLE. The note explains a change
--      the client is living through, so the client is its audience. See the
--      corrected nutrition_events.coach_note comment at the bottom of this file
--      for what that does to the per-day column, which is still written in
--      parallel and now carries the same text.
--
-- WHY A CLIENT-SCOPED TABLE, and not a column on something that already exists:
--   - nutrition_events is swept by deleteFutureNutritionEventsForClient
--     (services/nutrition-event-service.ts), which spares NOTHING by design --
--     not is_modified, not coach_note. Anything parked there dies with the plan.
--   - nutrition_plans rows are themselves closed, absorbed, and (when a queued
--     version was never effective) hard-deleted by create_nutrition_plan_atomic
--     (migration 144).
--   A client-scoped row with ON DELETE SET NULL on the plan FK outlives both.
--   Same posture as the events-as-SOT rule that event->plan FKs are SET NULL
--   (migration 113): deleting a plan must never destroy the record of what was
--   said about it. The note keeps its date, so it still reads correctly once
--   the plan it referenced is gone.
--
-- There is no plan-version history table to hang this off instead:
-- nutrition_plan_history was dropped at migration 045 and never replaced.
--
-- create_nutrition_plan_atomic is NOT touched. Verified against the live
-- catalog at authoring time: pronargs = 24, one overload. The note is a
-- separate INSERT after the RPC succeeds, so no signature moves and migration
-- 106's arity-sensitive grant lockdown stays valid.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.nutrition_plan_notes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  coach_id          UUID REFERENCES public.coaches(id) ON DELETE SET NULL,
  nutrition_plan_id UUID REFERENCES public.nutrition_plans(id) ON DELETE SET NULL,
  effective_on      DATE NOT NULL,
  body              TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- No updated_at, deliberately: this is an immutable event table, the
  -- documented exception in CONVENTIONS.md section 8 (precedent: body_metrics).
  -- An updated_at would imply an edit path, and the append-only property in
  -- point 2 above is the whole reason this table exists.
);

COMMENT ON TABLE public.nutrition_plan_notes IS
  'Append-only log of the coach note attached to each nutrition plan save. Client-visible: read by the coach Journey timeline and the client Program tab. Client-scoped with a SET NULL plan FK so a plan delete never destroys it. Never UPDATEd, never DELETEd -- two notes on one effective_on is correct, not a duplicate.';

-- Serves both readers: "this client's notes inside [start, end], oldest first".
-- created_at is in the index because effective_on is NOT unique per client (the
-- append-only property), so the ordering needs a tiebreak to be deterministic.
CREATE INDEX IF NOT EXISTS idx_nutrition_plan_notes_client_date
  ON public.nutrition_plan_notes (client_id, effective_on DESC, created_at DESC);

-- The plan FK is indexed because it carries real DELETE traffic, not just for
-- the sake of the "index foreign keys" rule: nutrition_plans rows are hard-
-- deleted on two live paths -- queued versions when a coach deletes the plan
-- chain, and fully-replaced never-effective queued versions inside
-- create_nutrition_plan_atomic's absorb branch (migration 144). Each of those
-- makes Postgres find the referencing rows to NULL them, and without this index
-- that is a sequential scan of every note in the table.
-- coach_id is deliberately NOT indexed: nothing queries by it and coaches are
-- not deleted in normal operation (same call as client_notes, migration 134).
CREATE INDEX IF NOT EXISTS idx_nutrition_plan_notes_plan
  ON public.nutrition_plan_notes (nutrition_plan_id);

-- CONVENTIONS.md section 8: deny-all RLS (no policies -- every app read and
-- write goes through supabaseAdmin, which bypasses RLS) plus an explicit grant,
-- because "automatically expose new tables" is OFF and PostgREST cannot see the
-- table without one. service_role only; anon and authenticated need nothing.
ALTER TABLE IF EXISTS public.nutrition_plan_notes ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.nutrition_plan_notes TO service_role;

-- ---------------------------------------------------------------------------
-- Correct migration 139's column comment.
--
-- The literal claim it made is still TRUE -- the client reads the note through
-- nutrition_plan_notes, never through this column, so this column is still not
-- returned by /api/client/**. What is no longer true is the PRIVACY the comment
-- implied, because the same text now reaches the client by the other route.
-- The comment says "no longer a private channel" rather than "shown to the
-- client": the first is unconditionally true, the second is not (the client
-- sees a note only while the journey block containing it is current).
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.nutrition_events.coach_note IS
  'The plan-save note, stamped on the date the change takes effect. Still never returned by /api/client/** -- but since migration 147 the same text is ALSO inserted into nutrition_plan_notes, which IS client-visible, so this is NO LONGER A PRIVATE CHANNEL. Rows written before 147 were private. Distinct from `note`, the per-day range-edit note, which is shown to the client directly.';
