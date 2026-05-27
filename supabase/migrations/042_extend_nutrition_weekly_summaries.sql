-- =============================================================================
-- CREATE BASE TABLES + FUNCTION (Reconstructed from Studio query history)
-- The original creation was run by hand in Studio before this migration existed;
-- this block restores it so the chain replays cleanly on a fresh database.
-- Note: nutrition_daily_goals is dropped later in migration 045 (dead code).
-- The function `generate_weekly_nutrition_goals` references columns that 045
-- drops from `clients`; it stays as an orphaned function on dev, so prod
-- mirrors that state.
-- =============================================================================

-- Daily goals table (will be dropped in 045)
CREATE TABLE IF NOT EXISTS public.nutrition_daily_goals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  day_of_week TEXT NOT NULL CHECK (day_of_week IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')),
  calorie_target INTEGER NOT NULL,
  protein_g INTEGER,
  carbs_g INTEGER,
  fat_g INTEGER,
  is_training_day BOOLEAN DEFAULT false,
  training_calorie_adjustment INTEGER DEFAULT 0,
  is_completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  completion_quality TEXT CHECK (completion_quality IN ('on_target', 'over', 'under', NULL)),
  actual_calories INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(client_id, week_start_date, day_of_week)
);

CREATE INDEX idx_nutrition_daily_goals_client_id ON public.nutrition_daily_goals(client_id);
CREATE INDEX idx_nutrition_daily_goals_week_start ON public.nutrition_daily_goals(week_start_date);
CREATE INDEX idx_nutrition_daily_goals_completed ON public.nutrition_daily_goals(is_completed);

-- Weekly summaries table (base shape; this migration's ALTER extends it below)
CREATE TABLE IF NOT EXISTS public.nutrition_weekly_summaries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  weekly_calorie_target INTEGER NOT NULL,
  weekly_protein_target_g INTEGER,
  weekly_carbs_target_g INTEGER,
  weekly_fat_target_g INTEGER,
  training_days_per_week INTEGER DEFAULT 0,
  rest_days_per_week INTEGER DEFAULT 0,
  days_completed INTEGER DEFAULT 0,
  total_days INTEGER DEFAULT 7,
  completion_percentage DECIMAL(5,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(client_id, week_start_date)
);

CREATE INDEX idx_nutrition_weekly_summaries_client_id ON public.nutrition_weekly_summaries(client_id);
CREATE INDEX idx_nutrition_weekly_summaries_week_start ON public.nutrition_weekly_summaries(week_start_date);

-- Function used to populate weekly + daily goal rows for a client's week.
-- References columns that exist on clients at this point in the chain
-- (baseline_calories, calorie_target, custom_*_g, etc.) but get dropped in 045.
-- Function definition stays valid (plpgsql is late-bound).
CREATE OR REPLACE FUNCTION generate_weekly_nutrition_goals(
  p_client_id UUID,
  p_week_start_date DATE
) RETURNS void AS $$
DECLARE
  v_client_record RECORD;
  v_daily_calories INTEGER;
  v_daily_protein INTEGER;
  v_daily_carbs INTEGER;
  v_daily_fat INTEGER;
  v_training_days TEXT[] := ARRAY['monday', 'tuesday', 'wednesday', 'friday', 'saturday'];
  v_rest_days TEXT[] := ARRAY['thursday', 'sunday'];
  v_day TEXT;
  v_is_training BOOLEAN;
  v_calorie_adjustment INTEGER;
BEGIN
  SELECT
    COALESCE(
      CASE WHEN custom_macros_enabled AND custom_calories IS NOT NULL
           THEN custom_calories
           ELSE calorie_target
      END, baseline_calories, 2000
    ) as calories,
    COALESCE(
      CASE WHEN custom_macros_enabled AND custom_protein_g IS NOT NULL
           THEN custom_protein_g
           ELSE protein_target_g
      END, 150
    ) as protein,
    COALESCE(
      CASE WHEN custom_macros_enabled AND custom_carb_g IS NOT NULL
           THEN custom_carb_g
           ELSE carb_target_g
      END, 200
    ) as carbs,
    COALESCE(
      CASE WHEN custom_macros_enabled AND custom_fat_g IS NOT NULL
           THEN custom_fat_g
           ELSE fat_target_g
      END, 70
    ) as fat
  INTO v_client_record
  FROM clients
  WHERE id = p_client_id;

  v_daily_calories := v_client_record.calories;
  v_daily_protein := v_client_record.protein;
  v_daily_carbs := v_client_record.carbs;
  v_daily_fat := v_client_record.fat;

  FOREACH v_day IN ARRAY ARRAY['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  LOOP
    v_is_training := v_day = ANY(v_training_days);
    v_calorie_adjustment := CASE WHEN v_is_training THEN 400 ELSE 0 END;

    INSERT INTO nutrition_daily_goals (
      client_id, week_start_date, day_of_week,
      calorie_target, protein_g, carbs_g, fat_g,
      is_training_day, training_calorie_adjustment
    ) VALUES (
      p_client_id, p_week_start_date, v_day,
      v_daily_calories + v_calorie_adjustment,
      v_daily_protein,
      v_daily_carbs + (v_calorie_adjustment / 4),
      v_daily_fat,
      v_is_training,
      v_calorie_adjustment
    )
    ON CONFLICT (client_id, week_start_date, day_of_week)
    DO UPDATE SET
      calorie_target = EXCLUDED.calorie_target,
      protein_g = EXCLUDED.protein_g,
      carbs_g = EXCLUDED.carbs_g,
      fat_g = EXCLUDED.fat_g,
      is_training_day = EXCLUDED.is_training_day,
      training_calorie_adjustment = EXCLUDED.training_calorie_adjustment,
      updated_at = NOW();
  END LOOP;

  INSERT INTO nutrition_weekly_summaries (
    client_id, week_start_date,
    weekly_calorie_target, weekly_protein_target_g,
    weekly_carbs_target_g, weekly_fat_target_g,
    training_days_per_week, rest_days_per_week
  ) VALUES (
    p_client_id, p_week_start_date,
    (v_daily_calories * 7) + (400 * 5),
    v_daily_protein * 7,
    (v_daily_carbs * 7) + (100 * 5),
    v_daily_fat * 7,
    5, 2
  )
  ON CONFLICT (client_id, week_start_date)
  DO UPDATE SET
    weekly_calorie_target = EXCLUDED.weekly_calorie_target,
    weekly_protein_target_g = EXCLUDED.weekly_protein_target_g,
    weekly_carbs_target_g = EXCLUDED.weekly_carbs_target_g,
    weekly_fat_target_g = EXCLUDED.weekly_fat_target_g,
    training_days_per_week = EXCLUDED.training_days_per_week,
    rest_days_per_week = EXCLUDED.rest_days_per_week,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- RLS + policies (matches Studio history; migration 043 adds more SELECT policies later)
ALTER TABLE nutrition_daily_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE nutrition_weekly_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients can view their own daily goals"
  ON nutrition_daily_goals FOR SELECT
  USING (auth.uid() IN (
    SELECT user_id FROM clients WHERE id = nutrition_daily_goals.client_id
  ));

CREATE POLICY "Clients can update their own daily goals"
  ON nutrition_daily_goals FOR UPDATE
  USING (auth.uid() IN (
    SELECT user_id FROM clients WHERE id = nutrition_daily_goals.client_id
  ));

CREATE POLICY "Clients can view their own weekly summaries"
  ON nutrition_weekly_summaries FOR SELECT
  USING (auth.uid() IN (
    SELECT user_id FROM clients WHERE id = nutrition_weekly_summaries.client_id
  ));

CREATE POLICY "Coaches can manage client daily goals"
  ON nutrition_daily_goals FOR ALL
  USING (auth.uid() IN (
    SELECT coaches.user_id
    FROM coaches
    JOIN clients ON clients.coach_id = coaches.id
    WHERE clients.id = nutrition_daily_goals.client_id
  ));

CREATE POLICY "Coaches can manage client weekly summaries"
  ON nutrition_weekly_summaries FOR ALL
  USING (auth.uid() IN (
    SELECT coaches.user_id
    FROM coaches
    JOIN clients ON clients.coach_id = coaches.id
    WHERE clients.id = nutrition_weekly_summaries.client_id
  ));

CREATE TRIGGER update_nutrition_daily_goals_updated_at
  BEFORE UPDATE ON nutrition_daily_goals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_nutrition_weekly_summaries_updated_at
  BEFORE UPDATE ON nutrition_weekly_summaries
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- Extend nutrition_weekly_summaries with consumed totals, adherence, and day counts
-- =============================================================================
ALTER TABLE nutrition_weekly_summaries
  ADD COLUMN IF NOT EXISTS week_end_date DATE,
  ADD COLUMN IF NOT EXISTS total_calories_consumed NUMERIC(8,1),
  ADD COLUMN IF NOT EXISTS total_protein_consumed_g NUMERIC(7,2),
  ADD COLUMN IF NOT EXISTS total_carbs_consumed_g NUMERIC(7,2),
  ADD COLUMN IF NOT EXISTS total_fat_consumed_g NUMERIC(7,2),
  ADD COLUMN IF NOT EXISTS calorie_difference NUMERIC(8,1),
  ADD COLUMN IF NOT EXISTS adherence_percentage NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS weekly_adherence TEXT CHECK (weekly_adherence IN ('hit', 'partial', 'missed')),
  ADD COLUMN IF NOT EXISTS days_logged INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS days_on_target INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS days_over INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS days_under INT DEFAULT 0;

-- Unique constraint for upsert on (client_id, week_start_date)
-- Note: the base CREATE TABLE above already declared this as a UNIQUE column constraint
-- (`UNIQUE(client_id, week_start_date)`), which generates an implicit unique constraint
-- with an auto-named identity. The named constraint here exists for upsert-on-conflict
-- targeting by name; if the implicit one already covers it, this would conflict — guard.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'nutrition_weekly_summaries_client_week_unique'
  ) THEN
    ALTER TABLE nutrition_weekly_summaries
      ADD CONSTRAINT nutrition_weekly_summaries_client_week_unique
      UNIQUE (client_id, week_start_date);
  END IF;
END $$;
