-- =============================================================================
-- Migration 112: drop the server-UTC CURRENT_DATE default on
-- attention_dismissals.dismissed_at.
--
-- The lone writer (POST /api/dashboard/attention-feed/dismiss) now stamps the
-- coach-local today explicitly (Session 7.85). With NOT NULL retained, any
-- future writer that forgets to supply the date fails loudly instead of
-- silently stamping the server's UTC day - the skew that let a dismissed
-- alert pop straight back for an ahead-of-UTC coach.
-- =============================================================================

ALTER TABLE attention_dismissals ALTER COLUMN dismissed_at DROP DEFAULT;
