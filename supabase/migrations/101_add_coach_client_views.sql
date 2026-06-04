-- Migration 101: coach_client_views
-- Tracks when a coach last opened a client's overview tab, powering the
-- "since your last visit" section of the pre-session brief (Session 7.6).
--
-- Single-timestamp upsert: last_viewed_at is overwritten on every view and
-- doubles as the row's update timestamp, so created_at/updated_at are
-- intentionally omitted (CONVENTIONS §8 timestamp exception, like body_metrics).

CREATE TABLE coach_client_views (
  coach_id UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  last_viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (coach_id, client_id)
);

COMMENT ON COLUMN coach_client_views.last_viewed_at IS 'When the coach last opened this client''s overview tab. Last-write-wins upsert; doubles as the row update timestamp, so created_at/updated_at are intentionally omitted.';

ALTER TABLE coach_client_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can access coach_client_views"
  ON coach_client_views FOR ALL TO authenticated USING (true) WITH CHECK (true);
