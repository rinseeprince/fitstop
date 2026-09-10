-- Migration 171: a block is never extended (owner decision 2026-09-10).
--
-- A block's end moves earlier or the block is deleted; more time is a new
-- block after it, with its own program and targets. Nothing continues a placed
-- program's repetition past its window, so the pass length migration 165
-- recorded for that continuation has no reader. The placed rows describe the
-- program on their own (migration 164); the date-walk needs nothing else.
--
-- Probed before the drop: PROD holds no training_plans rows; DEV's 161 values
-- sit on test clients and are read by no code path after this commit.

ALTER TABLE public.training_plans
  DROP COLUMN IF EXISTS authored_slot_count;
