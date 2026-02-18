-- Allow NULL values for nutrition_adherence in daily_logs
-- This enables clients to log wellness data without entering calories

ALTER TABLE public.daily_logs ALTER COLUMN nutrition_adherence DROP NOT NULL;