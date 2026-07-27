-- One scheduled training session per client per day.
--
-- Every same-day guard in the calendar keys on training_session_id — the
-- partial unique index from 075, the plain constraint from 076, and the
-- service-layer conflict checks. That was correct when a session row was a
-- recurring template. Since whole-program placement (migration 121) every
-- placed day is cloned into its OWN training_sessions row, so two events never
-- share a session id and every one of those guards is a silent no-op. Verified
-- on live data: 12 "Pull Day" events resolved to 12 distinct session ids.
--
-- The consequence was not theoretical. Three past dates on one client carried
-- two stacked sessions each, and because deleteEvent refuses past dates, no UI
-- could remove them. Those rows were cleared on 2026-07-27; this index is what
-- stops the state being reachable again, across all current write paths and any
-- added later.
--
-- WHY PARTIAL, on status='scheduled' only:
-- a client can log a session early, leaving a completed/partial row on a date
-- that the amendment rewrite deliberately skips — the date-walk may then
-- legitimately insert beside it. An all-status index would turn that into a
-- hard failure. Scoping to 'scheduled' puts the wall exactly where the damage
-- happens. The remaining visual case (a scheduled event landing on a day that
-- already holds a completed one) is covered by the status-agnostic
-- service-layer check in services/training-event-occupancy.ts.
--
-- DELIBERATELY TEMPORARY. Multi-session days are post-launch work; this is a
-- launch-scope constraint, not a domain invariant. When they ship, DROP this
-- index rather than working around it.
--
-- Precondition, verified before writing this file: zero (client_id, date)
-- collisions exist platform-wide, in any status.

CREATE UNIQUE INDEX IF NOT EXISTS idx_training_events_one_scheduled_per_day
  ON public.training_events (client_id, date)
  WHERE status = 'scheduled';

COMMENT ON INDEX public.idx_training_events_one_scheduled_per_day IS
  'Launch-scope: one scheduled session per client per day. Drop when multi-session days ship.';
