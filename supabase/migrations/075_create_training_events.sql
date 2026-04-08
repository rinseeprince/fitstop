-- Create training_events table for concrete calendar-based training schedule.
-- Replaces template day_of_week matching with one row per session per date.

CREATE TABLE training_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  training_plan_id UUID NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
  training_session_id UUID REFERENCES training_sessions(id) ON DELETE SET NULL,
  date DATE NOT NULL,
  session_name TEXT NOT NULL,
  session_focus TEXT,
  estimated_calories INTEGER,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'completed', 'partial', 'missed', 'skipped')),
  session_log_id UUID REFERENCES session_logs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial unique index: only enforces uniqueness when training_session_id is NOT NULL.
-- When ON DELETE SET NULL nullifies training_session_id, rows won't violate uniqueness.
CREATE UNIQUE INDEX idx_training_events_unique_session_date
  ON training_events(client_id, training_session_id, date)
  WHERE training_session_id IS NOT NULL;

CREATE INDEX idx_training_events_client_date ON training_events(client_id, date);
CREATE INDEX idx_training_events_plan ON training_events(training_plan_id);
