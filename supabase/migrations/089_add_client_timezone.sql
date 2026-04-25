-- Add IANA timezone column to clients for client-local "today" computation.
-- Required by the redesigned client portal: past-day edit lock, day summary, and
-- detail-page rules all need to know the client's local day, not the server's UTC day.
-- See docs/CLIENT-PORTAL-REDESIGN.md "Timezone handling" for the full rationale.

ALTER TABLE clients
  ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC'
    CHECK (timezone ~ '^[A-Za-z_+\-/]+$');

COMMENT ON COLUMN clients.timezone IS 'IANA time zone (e.g. America/Los_Angeles). Default UTC for pre-backfill rows; Settings UI in Session 2.6 lets clients pick theirs.';
