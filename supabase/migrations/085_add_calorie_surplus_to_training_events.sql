-- Add calorie surplus percentage to training_events.
-- Copied from the training session at event generation time.
-- Used by the percentage-based nutrition surplus model (LIB-2).
ALTER TABLE training_events ADD COLUMN calorie_surplus_percentage NUMERIC;
