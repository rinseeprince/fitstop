-- ============================================================
-- Migration 036: Security hardening for client_intake
-- ============================================================
-- Adds missing CHECK constraints, gender enum, and splits
-- the client RLS policy to prevent unintended DELETE access.
-- ============================================================

-- -------------------------------------------------------
-- Part 1: Add CHECK constraints for numeric/integer fields
-- -------------------------------------------------------

ALTER TABLE public.client_intake
  ADD CONSTRAINT client_intake_days_per_week_check
  CHECK (days_per_week BETWEEN 1 AND 7);

ALTER TABLE public.client_intake
  ADD CONSTRAINT client_intake_session_duration_check
  CHECK (session_duration_minutes BETWEEN 15 AND 180);

ALTER TABLE public.client_intake
  ADD CONSTRAINT client_intake_body_fat_check
  CHECK (body_fat_percentage BETWEEN 3 AND 60);

ALTER TABLE public.client_intake
  ADD CONSTRAINT client_intake_target_weight_check
  CHECK (target_weight BETWEEN 30 AND 300);

ALTER TABLE public.client_intake
  ADD CONSTRAINT client_intake_meals_per_day_check
  CHECK (meals_per_day BETWEEN 1 AND 8);

ALTER TABLE public.client_intake
  ADD CONSTRAINT client_intake_height_check
  CHECK (height BETWEEN 100 AND 250);

ALTER TABLE public.client_intake
  ADD CONSTRAINT client_intake_current_weight_check
  CHECK (current_weight BETWEEN 30 AND 300);

-- -------------------------------------------------------
-- Part 2: Add CHECK constraints for text enum fields
-- -------------------------------------------------------

ALTER TABLE public.client_intake
  ADD CONSTRAINT client_intake_gender_check
  CHECK (gender IN ('male', 'female', 'other', 'prefer_not_to_say'));

ALTER TABLE public.client_intake
  ADD CONSTRAINT client_intake_height_unit_check
  CHECK (height_unit IN ('cm', 'in'));

ALTER TABLE public.client_intake
  ADD CONSTRAINT client_intake_weight_unit_check
  CHECK (weight_unit IN ('kg', 'lb'));

-- -------------------------------------------------------
-- Part 3: Replace client FOR ALL policy with granular policies
-- -------------------------------------------------------

-- Drop the overly permissive FOR ALL policy
DROP POLICY IF EXISTS "clients_manage_own_intake" ON public.client_intake;

-- Clients can view their own intake
CREATE POLICY "clients_select_own_intake"
  ON public.client_intake
  FOR SELECT
  TO authenticated
  USING (
    client_id IN (
      SELECT id FROM public.clients WHERE user_id = auth.uid()
    )
  );

-- Clients can insert their own intake
CREATE POLICY "clients_insert_own_intake"
  ON public.client_intake
  FOR INSERT
  TO authenticated
  WITH CHECK (
    client_id IN (
      SELECT id FROM public.clients WHERE user_id = auth.uid()
    )
  );

-- Clients can update their own intake
CREATE POLICY "clients_update_own_intake"
  ON public.client_intake
  FOR UPDATE
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

-- No DELETE policy for clients — intakes cannot be deleted by clients
