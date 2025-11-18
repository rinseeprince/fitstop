-- Fix RLS policies for coaches table to allow new coach signup
-- The issue: coaches can read/update their own data, but can't INSERT during signup

-- Add INSERT policy for coaches table
-- Allows authenticated users to create their own coach profile during signup
CREATE POLICY "Authenticated users can create their own coach profile"
  ON coaches
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Note: This policy ensures that:
-- 1. Only authenticated users can insert (they must be logged in)
-- 2. They can only insert a row where user_id matches their auth.uid()
-- 3. This allows the signup flow to create the coach profile after Supabase auth succeeds
