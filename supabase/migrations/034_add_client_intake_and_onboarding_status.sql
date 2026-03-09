-- ============================================================
-- Migration 034: Add client_intake table and onboarding_status
-- ============================================================
-- Creates the client_intake table for storing intake questionnaire
-- responses, and adds onboarding_status column to clients table.
-- ============================================================

-- -------------------------------------------------------
-- Part 1: Create client_intake table
-- -------------------------------------------------------

CREATE TABLE public.client_intake (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),

  -- Goals & context
  primary_goal TEXT CHECK (primary_goal IN (
    'lose_fat', 'build_muscle', 'recomposition', 'improve_fitness',
    'sport_performance', 'maintain', 'other'
  )),
  goal_details TEXT,

  -- Body & lifestyle
  date_of_birth DATE,
  gender TEXT,
  height NUMERIC,
  height_unit TEXT DEFAULT 'cm',
  current_weight NUMERIC,
  weight_unit TEXT DEFAULT 'kg',
  work_activity_level TEXT CHECK (work_activity_level IN (
    'sedentary', 'lightly_active', 'moderately_active', 'very_active', 'extremely_active'
  )),

  -- Nutrition
  dietary_requirements TEXT[] DEFAULT '{}',
  cooking_frequency TEXT CHECK (cooking_frequency IN (
    'never', 'rarely', 'sometimes', 'often', 'daily'
  )),
  nutrition_notes TEXT,

  -- Training background
  training_experience_level TEXT CHECK (training_experience_level IN (
    'beginner', 'intermediate', 'advanced', 'elite'
  )),
  training_time_preference TEXT CHECK (training_time_preference IN (
    'morning', 'midday', 'afternoon', 'evening', 'no_preference'
  )),
  training_location TEXT CHECK (training_location IN (
    'gym', 'home', 'outdoor', 'mixed'
  )),
  available_equipment TEXT[] DEFAULT '{}',
  days_per_week INTEGER,
  session_duration_minutes INTEGER,

  -- Medical / injuries
  injuries_or_limitations TEXT,
  medical_notes TEXT,

  -- Metadata
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_client_intake_client_id ON public.client_intake(client_id);
CREATE INDEX idx_client_intake_status ON public.client_intake(status);

-- Updated_at trigger (reuses existing function from migration 004)
CREATE TRIGGER update_client_intake_updated_at
  BEFORE UPDATE ON public.client_intake
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- -------------------------------------------------------
-- Part 2: RLS for client_intake
-- -------------------------------------------------------

ALTER TABLE public.client_intake ENABLE ROW LEVEL SECURITY;

-- Clients can manage their own intake
CREATE POLICY "clients_manage_own_intake"
  ON public.client_intake
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

-- Coaches can manage their clients' intakes
CREATE POLICY "coaches_manage_client_intake"
  ON public.client_intake
  FOR ALL
  TO authenticated
  USING (
    client_id IN (
      SELECT id FROM public.clients
      WHERE coach_id IN (
        SELECT id FROM public.coaches WHERE user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    client_id IN (
      SELECT id FROM public.clients
      WHERE coach_id IN (
        SELECT id FROM public.coaches WHERE user_id = auth.uid()
      )
    )
  );

-- -------------------------------------------------------
-- Part 3: Add onboarding_status to clients table
-- -------------------------------------------------------

ALTER TABLE public.clients
  ADD COLUMN onboarding_status TEXT
    DEFAULT 'active'
    CHECK (onboarding_status IN (
      'pending_intake', 'intake_completed', 'setup_in_progress', 'active', 'paused'
    ));
