-- Journey blocks: coach-curated archive (Session 3.7, owner-directed).
-- archived_at is a VIEW PREFERENCE, not lifecycle: it hides an elapsed block
-- from the main Journey list. No derivation consults it — current/past/future
-- stay date-derived (workstream invariant 2), pace/week-of-total/chart
-- shading/facts all ignore it, and the chain PUT's upsert never writes it
-- (only the PATCH route does), so chain rewrites cannot clobber it. The
-- elapsed-only rule ("only completed blocks can be archived") is enforced in
-- the service, not here — a CHECK against "today" is impossible in a static
-- constraint and unwanted in a scheduler-less model.

ALTER TABLE IF EXISTS public.client_phases
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

COMMENT ON COLUMN public.client_phases.archived_at IS
  'Coach view preference: hides this (elapsed) block from the main Journey list. Never consulted by any derivation.';
