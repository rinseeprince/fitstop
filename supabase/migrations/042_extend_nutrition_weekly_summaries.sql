-- Extend nutrition_weekly_summaries with consumed totals, adherence, and day counts
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
ALTER TABLE nutrition_weekly_summaries
  ADD CONSTRAINT nutrition_weekly_summaries_client_week_unique
  UNIQUE (client_id, week_start_date);
