-- Migration 164: a block owns its own window.
--
-- Blocks used to be a contiguous chain — the coach supplied each END date and
-- every start was derived as the previous end + 1, which made overlaps AND gaps
-- unexpressible. A block is now the time-bound program a coach sells, and both
-- of its dates are chosen: a gap between two blocks is a real state (the client
-- is between programs and nothing is planned), while an overlap never is —
-- two blocks claiming one day would make "the block covering this date", which
-- now decides the training placement window and the nutrition horizon, answer
-- arbitrarily.
--
-- Enforced here rather than only in the service, for the same reason
-- `nutrition_plans_active_window_overlap` is: the windows decide what gets
-- generated onto a client's calendar, and a bug in the route layer must not be
-- able to produce a shape the readers cannot resolve. Inclusive range on both
-- ends, matching `[starts_on, ends_on]` everywhere else in the product.
--
-- Archived blocks are INCLUDED: archiving is curation, not deletion — the block
-- still describes the days it covered, so nothing may be laid over it.
--
-- btree_gist supplies the `uuid WITH =` operator class; it is already installed
-- (the nutrition twin depends on it).

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.client_phases
  DROP CONSTRAINT IF EXISTS client_phases_window_overlap;

ALTER TABLE public.client_phases
  ADD CONSTRAINT client_phases_window_overlap
  EXCLUDE USING gist (
    client_id WITH =,
    daterange(starts_on, ends_on, '[]') WITH &&
  );

COMMENT ON CONSTRAINT client_phases_window_overlap ON public.client_phases IS
  'A client''s blocks never overlap. Gaps between them are allowed and mean nothing is planned (migration 164).';
