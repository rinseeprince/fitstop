-- Migration 165: record how long one pass of a placed program was.
--
-- Since migration 164 the BLOCK decides a placement's window, so a program
-- shorter than its block is repeated to fill it and the placed rows are the
-- authored program laid down N times. Stretching that block later means
-- continuing the repetition — and nothing recorded where one pass ends.
-- `saved_plan_id` cannot answer it: apply-with-edits places NULL, so the source
-- template is unrecoverable for exactly the plans a coach fiddled with.
--
-- With this, the authored program is the placed plan's first `authored_slot_count`
-- slots in date-walk order (expansion emits `authored[i % A]` at position i), so
-- an extension resumes at `existingSlots % authored_slot_count` instead of
-- jumping back to week 1 on any block that was not a whole number of passes.
--
-- NOT the migration-128 `cycle_length` returning. That column was part of the
-- training-cycles scheduling model, which is sunset and must stay sunset; this
-- records one fact about how a program was placed, and nothing schedules from it.
--
-- Nullable with no default and no backfill: rows placed before this cannot know
-- their own pass length, and the extend path tells the coach to place a program
-- rather than guessing one.

ALTER TABLE public.training_plans
  ADD COLUMN IF NOT EXISTS authored_slot_count INTEGER;

COMMENT ON COLUMN public.training_plans.authored_slot_count IS
  'Day-slots in ONE pass of the authored program this plan was placed from. The placed rows repeat that pass to fill the block (migration 164), so an extension resumes mid-pass instead of restarting. NULL on rows placed before migration 165. Not the sunset cycle_length (migration 128).';
