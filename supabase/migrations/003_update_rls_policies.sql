-- Update RLS Policies for check_ins and check_in_tokens tables
-- This migration replaces the overly permissive policies with secure ones

-- ============================================================================
-- UPDATE check_ins TABLE POLICIES
-- ============================================================================

-- Drop the old insecure policy
DROP POLICY IF EXISTS "Enable all operations for authenticated users" ON check_ins;

-- Create new secure policies
-- Note: Service role (used by API routes) automatically bypasses RLS
-- These policies apply to authenticated coaches using the anon key

-- Allow authenticated users to read all check-ins
-- TODO: When coach-client relationship table is added, filter by: coach_id = auth.uid()
CREATE POLICY "Authenticated users can view check-ins" ON check_ins
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Allow authenticated users to update check-ins (for coach responses)
-- TODO: When coach-client relationship table is added, filter by: coach_id = auth.uid()
CREATE POLICY "Authenticated users can update check-ins" ON check_ins
  FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Block anonymous access (clients submit via API using service role)
-- INSERT operations are handled by API routes using service role, which bypasses RLS


-- ============================================================================
-- UPDATE check_in_tokens TABLE POLICIES
-- ============================================================================

-- Drop the old insecure policy
DROP POLICY IF EXISTS "Enable all operations for authenticated users" ON check_in_tokens;

-- Create new secure policies
-- Note: Service role (used by API routes) automatically bypasses RLS
-- These policies apply to authenticated coaches using the anon key

-- Allow authenticated users to read tokens
-- TODO: When coach-client relationship table is added, filter by: coach_id = auth.uid()
CREATE POLICY "Authenticated users can view tokens" ON check_in_tokens
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Allow authenticated users to create tokens (for generating check-in links)
-- TODO: When coach-client relationship table is added, ensure: coach owns the client
CREATE POLICY "Authenticated users can create tokens" ON check_in_tokens
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Block anonymous access
-- Token validation and marking as used are handled by API routes using service role
