-- Enhanced Check-In Tracking
-- Adds session completion tracking, exercise highlights, external activities,
-- and nutrition adherence fields to align check-ins with training/nutrition plans

-- Session completion tracking (links check-ins to training sessions)
CREATE TABLE IF NOT EXISTS check_in_session_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_in_id UUID NOT NULL REFERENCES check_ins(id) ON DELETE CASCADE,
  training_session_id UUID NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  completed BOOLEAN NOT NULL DEFAULT false,
  completion_quality TEXT CHECK (completion_quality IN ('full', 'partial', 'skipped')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(check_in_id, training_session_id)
);

-- Exercise highlights (PRs, struggles, notes)
CREATE TABLE IF NOT EXISTS check_in_exercise_highlights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_in_id UUID NOT NULL REFERENCES check_ins(id) ON DELETE CASCADE,
  exercise_id UUID REFERENCES training_exercises(id) ON DELETE SET NULL,
  exercise_name TEXT NOT NULL,
  highlight_type TEXT NOT NULL CHECK (highlight_type IN ('pr', 'struggle', 'note')),
  details TEXT,
  weight_value NUMERIC(6,2),
  weight_unit TEXT CHECK (weight_unit IN ('lbs', 'kg')),
  reps INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- External activities during check-in period
CREATE TABLE IF NOT EXISTS check_in_external_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_in_id UUID NOT NULL REFERENCES check_ins(id) ON DELETE CASCADE,
  activity_name TEXT NOT NULL,
  intensity_level TEXT NOT NULL CHECK (intensity_level IN ('low', 'moderate', 'vigorous')),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0 AND duration_minutes <= 600),
  estimated_calories INTEGER CHECK (estimated_calories >= 0),
  day_performed TEXT CHECK (day_performed IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add nutrition tracking columns to check_ins table
ALTER TABLE check_ins
ADD COLUMN IF NOT EXISTS nutrition_days_on_target INTEGER CHECK (nutrition_days_on_target >= 0 AND nutrition_days_on_target <= 7),
ADD COLUMN IF NOT EXISTS nutrition_notes TEXT;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_session_completions_check_in ON check_in_session_completions(check_in_id);
CREATE INDEX IF NOT EXISTS idx_session_completions_session ON check_in_session_completions(training_session_id);
CREATE INDEX IF NOT EXISTS idx_exercise_highlights_check_in ON check_in_exercise_highlights(check_in_id);
CREATE INDEX IF NOT EXISTS idx_external_activities_check_in ON check_in_external_activities(check_in_id);

-- Enable RLS on new tables
ALTER TABLE check_in_session_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_in_exercise_highlights ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_in_external_activities ENABLE ROW LEVEL SECURITY;

-- RLS policies for check_in_session_completions
CREATE POLICY "session_completions_select" ON check_in_session_completions
  FOR SELECT USING (
    check_in_id IN (
      SELECT id FROM check_ins WHERE client_id IN (
        SELECT id FROM clients WHERE coach_id IN (
          SELECT id FROM coaches WHERE user_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY "session_completions_insert" ON check_in_session_completions
  FOR INSERT WITH CHECK (
    check_in_id IN (
      SELECT id FROM check_ins WHERE client_id IN (
        SELECT id FROM clients WHERE coach_id IN (
          SELECT id FROM coaches WHERE user_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY "session_completions_update" ON check_in_session_completions
  FOR UPDATE USING (
    check_in_id IN (
      SELECT id FROM check_ins WHERE client_id IN (
        SELECT id FROM clients WHERE coach_id IN (
          SELECT id FROM coaches WHERE user_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY "session_completions_delete" ON check_in_session_completions
  FOR DELETE USING (
    check_in_id IN (
      SELECT id FROM check_ins WHERE client_id IN (
        SELECT id FROM clients WHERE coach_id IN (
          SELECT id FROM coaches WHERE user_id = auth.uid()
        )
      )
    )
  );

-- RLS policies for check_in_exercise_highlights
CREATE POLICY "exercise_highlights_select" ON check_in_exercise_highlights
  FOR SELECT USING (
    check_in_id IN (
      SELECT id FROM check_ins WHERE client_id IN (
        SELECT id FROM clients WHERE coach_id IN (
          SELECT id FROM coaches WHERE user_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY "exercise_highlights_insert" ON check_in_exercise_highlights
  FOR INSERT WITH CHECK (
    check_in_id IN (
      SELECT id FROM check_ins WHERE client_id IN (
        SELECT id FROM clients WHERE coach_id IN (
          SELECT id FROM coaches WHERE user_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY "exercise_highlights_update" ON check_in_exercise_highlights
  FOR UPDATE USING (
    check_in_id IN (
      SELECT id FROM check_ins WHERE client_id IN (
        SELECT id FROM clients WHERE coach_id IN (
          SELECT id FROM coaches WHERE user_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY "exercise_highlights_delete" ON check_in_exercise_highlights
  FOR DELETE USING (
    check_in_id IN (
      SELECT id FROM check_ins WHERE client_id IN (
        SELECT id FROM clients WHERE coach_id IN (
          SELECT id FROM coaches WHERE user_id = auth.uid()
        )
      )
    )
  );

-- RLS policies for check_in_external_activities
CREATE POLICY "external_activities_select" ON check_in_external_activities
  FOR SELECT USING (
    check_in_id IN (
      SELECT id FROM check_ins WHERE client_id IN (
        SELECT id FROM clients WHERE coach_id IN (
          SELECT id FROM coaches WHERE user_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY "external_activities_insert" ON check_in_external_activities
  FOR INSERT WITH CHECK (
    check_in_id IN (
      SELECT id FROM check_ins WHERE client_id IN (
        SELECT id FROM clients WHERE coach_id IN (
          SELECT id FROM coaches WHERE user_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY "external_activities_update" ON check_in_external_activities
  FOR UPDATE USING (
    check_in_id IN (
      SELECT id FROM check_ins WHERE client_id IN (
        SELECT id FROM clients WHERE coach_id IN (
          SELECT id FROM coaches WHERE user_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY "external_activities_delete" ON check_in_external_activities
  FOR DELETE USING (
    check_in_id IN (
      SELECT id FROM check_ins WHERE client_id IN (
        SELECT id FROM clients WHERE coach_id IN (
          SELECT id FROM coaches WHERE user_id = auth.uid()
        )
      )
    )
  );

-- Allow public insert for check-in submissions (via magic link)
CREATE POLICY "session_completions_public_insert" ON check_in_session_completions
  FOR INSERT WITH CHECK (true);

CREATE POLICY "exercise_highlights_public_insert" ON check_in_exercise_highlights
  FOR INSERT WITH CHECK (true);

CREATE POLICY "external_activities_public_insert" ON check_in_external_activities
  FOR INSERT WITH CHECK (true);
