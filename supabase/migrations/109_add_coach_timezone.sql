-- Add IANA timezone column to coaches for coach-local "today" computation.
-- Coach-side date windows (attention feed, current-week metrics, history
-- summaries) need the coach's local day, not the server's UTC day. Auto-synced
-- from the coach's device on dashboard load (Session 7.81); there is no manual
-- picker. Mirrors clients.timezone (migration 089). See docs/ARCHITECTURE.md
-- "Timezone model" for the locked model (whose calendar is the date on?).

ALTER TABLE coaches
  ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC'
    CHECK (timezone ~ '^[A-Za-z_+\-/]+$');

COMMENT ON COLUMN coaches.timezone IS 'IANA time zone (e.g. America/Los_Angeles), auto-synced from the coach''s device on app load (Session 7.81). Default UTC until first sync.';
