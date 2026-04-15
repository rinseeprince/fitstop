-- Tracks events manually moved or duplicated by the coach via the calendar UI.
-- Regeneration warns before overwriting modified events.
ALTER TABLE training_events ADD COLUMN is_modified BOOLEAN NOT NULL DEFAULT false;
