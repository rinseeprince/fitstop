-- Daily Check-in Feature Migration
-- Creates daily_logs (originally added in Studio, never captured in a migration file)
-- and adds nutrition tracking columns, plus new tables for habit tracking and external activities.

-- =============================================================================
-- CREATE DAILY_LOGS TABLE
-- (Reconstructed from Studio query history. The original CREATE was run by hand
-- before this migration existed; this block restores it to the chain so the
-- migrations replay cleanly on a fresh database.)
-- =============================================================================

CREATE TABLE IF NOT EXISTS daily_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date DATE NOT NULL,

  -- Subjective metrics (NOT NULL here; migration 031 relaxes nutrition_adherence to nullable)
  mood INTEGER NOT NULL CHECK (mood >= 1 AND mood <= 5),
  energy INTEGER NOT NULL CHECK (energy >= 1 AND energy <= 10),
  sleep INTEGER NOT NULL CHECK (sleep >= 1 AND sleep <= 10),
  stress INTEGER NOT NULL CHECK (stress >= 1 AND stress <= 10),

  -- Nutrition adherence (made nullable in 031; consumed/target columns added below)
  nutrition_adherence TEXT NOT NULL DEFAULT 'hit'
    CHECK (nutrition_adherence IN ('hit', 'partial', 'missed')),

  -- Training tracking (training_data column is added via ALTER in migration 056,
  -- matching the Studio history where it was added after the original CREATE)
  trained BOOLEAN NOT NULL DEFAULT false,
  training_session_id UUID REFERENCES training_sessions(id) ON DELETE SET NULL,

  -- Optional notes
  notes TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(client_id, date)
);

CREATE INDEX idx_daily_logs_client_date ON daily_logs(client_id, date DESC);
CREATE INDEX idx_daily_logs_client_date_asc ON daily_logs(client_id, date ASC);
CREATE INDEX idx_daily_logs_training_session ON daily_logs(training_session_id)
  WHERE training_session_id IS NOT NULL;

ALTER TABLE daily_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clients_view_own_daily_logs"
  ON daily_logs FOR SELECT
  USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

CREATE POLICY "clients_insert_daily_logs"
  ON daily_logs FOR INSERT
  WITH CHECK (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

CREATE POLICY "clients_update_daily_logs"
  ON daily_logs FOR UPDATE
  USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

CREATE POLICY "clients_delete_daily_logs"
  ON daily_logs FOR DELETE
  USING (client_id IN (SELECT id FROM clients WHERE user_id = auth.uid()));

CREATE POLICY "coaches_view_client_daily_logs"
  ON daily_logs FOR SELECT
  USING (
    client_id IN (
      SELECT id FROM clients WHERE coach_id IN (
        SELECT id FROM coaches WHERE user_id = auth.uid()
      )
    )
  );

CREATE TRIGGER daily_logs_updated_at
  BEFORE UPDATE ON daily_logs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- ALTER DAILY_LOGS TABLE: Add nutrition tracking columns
-- =============================================================================

ALTER TABLE public.daily_logs
ADD COLUMN IF NOT EXISTS calories_consumed INTEGER,
ADD COLUMN IF NOT EXISTS protein_g INTEGER,
ADD COLUMN IF NOT EXISTS carbs_g INTEGER,
ADD COLUMN IF NOT EXISTS fat_g INTEGER,
ADD COLUMN IF NOT EXISTS target_calories INTEGER,
ADD COLUMN IF NOT EXISTS target_protein_g INTEGER,
ADD COLUMN IF NOT EXISTS target_carbs_g INTEGER,
ADD COLUMN IF NOT EXISTS target_fat_g INTEGER,
ADD COLUMN IF NOT EXISTS calorie_surplus_deficit INTEGER;

-- =============================================================================
-- DAILY HABITS TABLE: Coach-defined habits for clients to track
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.daily_habits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  coach_id UUID NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  target_value NUMERIC,
  target_unit TEXT,
  is_boolean BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  
  -- Ensure habit names are unique per client
  UNIQUE(client_id, name)
);

-- Create indexes for efficient habit queries
CREATE INDEX idx_daily_habits_coach_id ON public.daily_habits(coach_id);
CREATE INDEX idx_daily_habits_client_id ON public.daily_habits(client_id);
CREATE INDEX idx_daily_habits_is_active ON public.daily_habits(is_active);

-- =============================================================================
-- DAILY HABIT LOGS TABLE: Tracks daily completion of habits
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.daily_habit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  daily_habit_id UUID NOT NULL REFERENCES public.daily_habits(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  value NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  
  -- Ensure one log per habit per day
  UNIQUE(daily_habit_id, date)
);

-- Create index for efficient querying by client and date
CREATE INDEX idx_daily_habit_logs_client_date ON public.daily_habit_logs(client_id, date);
CREATE INDEX idx_daily_habit_logs_habit_id ON public.daily_habit_logs(daily_habit_id);

-- =============================================================================
-- DAILY EXTERNAL ACTIVITIES TABLE: Non-training plan activities
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.daily_external_activities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  activity_name TEXT NOT NULL,
  intensity_level TEXT NOT NULL CHECK (intensity_level IN ('low', 'moderate', 'vigorous')),
  duration_minutes INTEGER NOT NULL,
  estimated_calories INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create index for efficient querying by client and date
CREATE INDEX idx_daily_external_activities_client_date ON public.daily_external_activities(client_id, date);

-- =============================================================================
-- ENABLE ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE public.daily_habits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_habit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_external_activities ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- RLS POLICIES: DAILY_HABITS
-- =============================================================================

-- Coaches can manage habits for their clients
CREATE POLICY "coaches_manage_client_habits"
  ON public.daily_habits
  FOR ALL
  TO authenticated
  USING (
    coach_id IN (
      SELECT id FROM public.coaches WHERE user_id = auth.uid()
    )
    AND client_id IN (
      SELECT id FROM public.clients 
      WHERE coach_id IN (
        SELECT id FROM public.coaches WHERE user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    coach_id IN (
      SELECT id FROM public.coaches WHERE user_id = auth.uid()
    )
    AND client_id IN (
      SELECT id FROM public.clients 
      WHERE coach_id IN (
        SELECT id FROM public.coaches WHERE user_id = auth.uid()
      )
    )
  );

-- Clients can view their own habits
CREATE POLICY "clients_view_own_habits"
  ON public.daily_habits
  FOR SELECT
  TO authenticated
  USING (
    client_id IN (
      SELECT id FROM public.clients WHERE user_id = auth.uid()
    )
  );

-- =============================================================================
-- RLS POLICIES: DAILY_HABIT_LOGS
-- =============================================================================

-- Clients can manage their own habit logs
CREATE POLICY "clients_manage_own_habit_logs"
  ON public.daily_habit_logs
  FOR ALL
  TO authenticated
  USING (
    client_id IN (
      SELECT id FROM public.clients WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    client_id IN (
      SELECT id FROM public.clients WHERE user_id = auth.uid()
    )
  );

-- Coaches can view habit logs for their clients
CREATE POLICY "coaches_view_client_habit_logs"
  ON public.daily_habit_logs
  FOR SELECT
  TO authenticated
  USING (
    client_id IN (
      SELECT id FROM public.clients 
      WHERE coach_id IN (
        SELECT id FROM public.coaches WHERE user_id = auth.uid()
      )
    )
  );

-- =============================================================================
-- RLS POLICIES: DAILY_EXTERNAL_ACTIVITIES
-- =============================================================================

-- Clients can manage their own external activities
CREATE POLICY "clients_manage_own_external_activities"
  ON public.daily_external_activities
  FOR ALL
  TO authenticated
  USING (
    client_id IN (
      SELECT id FROM public.clients WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    client_id IN (
      SELECT id FROM public.clients WHERE user_id = auth.uid()
    )
  );

-- Coaches can view external activities for their clients
CREATE POLICY "coaches_view_client_external_activities"
  ON public.daily_external_activities
  FOR SELECT
  TO authenticated
  USING (
    client_id IN (
      SELECT id FROM public.clients 
      WHERE coach_id IN (
        SELECT id FROM public.coaches WHERE user_id = auth.uid()
      )
    )
  );

-- =============================================================================
-- UPDATED_AT TRIGGERS
-- =============================================================================

-- Create triggers for updated_at timestamps
CREATE TRIGGER update_daily_habits_updated_at
  BEFORE UPDATE ON public.daily_habits
  FOR EACH ROW
  EXECUTE FUNCTION update_content_updated_at();

CREATE TRIGGER update_daily_habit_logs_updated_at
  BEFORE UPDATE ON public.daily_habit_logs
  FOR EACH ROW
  EXECUTE FUNCTION update_content_updated_at();

CREATE TRIGGER update_daily_external_activities_updated_at
  BEFORE UPDATE ON public.daily_external_activities
  FOR EACH ROW
  EXECUTE FUNCTION update_content_updated_at();

-- =============================================================================
-- COMMENTS FOR DOCUMENTATION
-- =============================================================================

COMMENT ON TABLE public.daily_habits IS 'Coach-defined habits for clients to track daily (e.g., water intake, steps, meditation)';
COMMENT ON TABLE public.daily_habit_logs IS 'Daily completion logs for client habits';
COMMENT ON TABLE public.daily_external_activities IS 'Client-recorded activities outside their training plan (e.g., sports, gym sessions)';

COMMENT ON COLUMN public.daily_habits.is_boolean IS 'True for yes/no habits, false for value-based habits';
COMMENT ON COLUMN public.daily_habits.target_value IS 'Target value for non-boolean habits (e.g., 8 for water glasses)';
COMMENT ON COLUMN public.daily_habits.target_unit IS 'Unit for target value (e.g., glasses, steps, minutes)';
COMMENT ON COLUMN public.daily_external_activities.intensity_level IS 'Activity intensity: low, moderate, or vigorous';