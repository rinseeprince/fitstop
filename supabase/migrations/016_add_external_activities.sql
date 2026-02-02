-- Add session_type to distinguish training sessions from external activities
ALTER TABLE training_sessions
ADD COLUMN session_type TEXT NOT NULL DEFAULT 'training'
CHECK (session_type IN ('training', 'external_activity'));

-- Add activity-specific metadata (JSONB for flexibility)
ALTER TABLE training_sessions
ADD COLUMN activity_metadata JSONB;

-- Create index for querying external activities
CREATE INDEX idx_training_sessions_type ON training_sessions(plan_id, session_type);

-- Activity suggestions cache table (for AI autocomplete + MET values)
CREATE TABLE IF NOT EXISTS activity_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  default_met_low NUMERIC(4, 1) NOT NULL,
  default_met_moderate NUMERIC(4, 1) NOT NULL,
  default_met_vigorous NUMERIC(4, 1) NOT NULL,
  muscle_groups_impacted TEXT[],
  recovery_notes TEXT,
  popularity_score INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed common activities with MET values (from Compendium of Physical Activities)
INSERT INTO activity_suggestions (activity_name, category, default_met_low, default_met_moderate, default_met_vigorous, muscle_groups_impacted, recovery_notes) VALUES
('Basketball', 'team_sports', 4.5, 6.5, 8.0, ARRAY['legs', 'core', 'cardio'], 'High impact on knees and ankles. Consider recovery for lower body.'),
('Soccer', 'team_sports', 5.0, 7.0, 10.0, ARRAY['legs', 'core', 'cardio'], 'Significant leg fatigue. May impact squat/deadlift performance.'),
('Swimming', 'endurance', 4.0, 6.0, 9.0, ARRAY['shoulders', 'back', 'core', 'cardio'], 'Low joint impact. Good active recovery option.'),
('Cycling', 'endurance', 3.5, 6.0, 10.0, ARRAY['legs', 'cardio'], 'Quad-dominant. Consider when programming leg days.'),
('Running', 'endurance', 6.0, 8.0, 11.0, ARRAY['legs', 'cardio'], 'High impact. Allow 24-48hrs before heavy leg training.'),
('Tennis', 'racquet_sports', 4.0, 6.0, 8.0, ARRAY['shoulders', 'arms', 'legs', 'cardio'], 'Unilateral stress on dominant arm. Monitor shoulder health.'),
('Hiking', 'outdoor', 3.5, 5.5, 7.5, ARRAY['legs', 'core', 'cardio'], 'Lower body endurance. Good active recovery.'),
('Yoga', 'flexibility', 2.0, 3.0, 4.0, ARRAY['full_body', 'core'], 'Excellent for recovery. Can complement any training.'),
('Martial Arts', 'combat_sports', 5.0, 7.0, 10.0, ARRAY['full_body', 'cardio'], 'High CNS demand. Plan training accordingly.'),
('Rock Climbing', 'outdoor', 4.0, 6.0, 8.0, ARRAY['back', 'arms', 'core', 'grip'], 'Grip-intensive. May impact pulling exercises.'),
('Volleyball', 'team_sports', 3.0, 5.0, 8.0, ARRAY['legs', 'shoulders', 'cardio'], 'Jumping stress on knees. Watch leg day timing.'),
('Golf', 'recreational', 3.0, 4.0, 5.0, ARRAY['core', 'back'], 'Low intensity. Rotational stress on spine.'),
('Boxing', 'combat_sports', 5.0, 8.0, 12.0, ARRAY['shoulders', 'arms', 'core', 'cardio'], 'Very high intensity. High CNS demand.'),
('Dancing', 'recreational', 3.5, 5.0, 7.5, ARRAY['legs', 'core', 'cardio'], 'Good cardio option. Low impact on recovery.'),
('Rowing', 'endurance', 4.0, 7.0, 10.0, ARRAY['back', 'legs', 'arms', 'cardio'], 'Full body. May impact back training.'),
('Skiing', 'winter_sports', 4.0, 6.0, 8.0, ARRAY['legs', 'core', 'cardio'], 'High leg demand. Consider timing with leg days.'),
('Snowboarding', 'winter_sports', 4.0, 5.5, 7.5, ARRAY['legs', 'core'], 'Core and balance intensive.'),
('Surfing', 'water_sports', 3.0, 5.0, 7.0, ARRAY['shoulders', 'back', 'core'], 'Upper body paddling. Shoulder fatigue.'),
('CrossFit', 'fitness', 6.0, 9.0, 12.0, ARRAY['full_body', 'cardio'], 'Very high intensity. Plan recovery accordingly.'),
('Pilates', 'flexibility', 2.5, 3.5, 5.0, ARRAY['core', 'full_body'], 'Core focused. Good for active recovery.');

-- RLS policies for activity_suggestions (read-only for authenticated users)
ALTER TABLE activity_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activity_suggestions_select" ON activity_suggestions
  FOR SELECT TO authenticated USING (true);

-- Trigger for updated_at
CREATE TRIGGER activity_suggestions_updated_at
  BEFORE UPDATE ON activity_suggestions
  FOR EACH ROW
  EXECUTE FUNCTION update_training_plan_updated_at();

-- RPC function to increment activity popularity (for tracking usage)
CREATE OR REPLACE FUNCTION increment_activity_popularity(p_activity_name TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE activity_suggestions
  SET popularity_score = popularity_score + 1,
      updated_at = NOW()
  WHERE LOWER(activity_name) = LOWER(p_activity_name);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
