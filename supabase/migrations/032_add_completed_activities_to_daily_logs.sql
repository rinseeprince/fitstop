-- =============================================================================
-- ADD COMPLETED ACTIVITY IDS TO DAILY LOGS
-- =============================================================================
-- This migration adds a JSONB column to store completed activity IDs directly
-- on the daily_logs table, eliminating the need to cross-reference
-- client_session_completions for activity restoration.

ALTER TABLE daily_logs 
ADD COLUMN completed_activity_ids jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN daily_logs.completed_activity_ids IS 'Array of session IDs for completed planned activities';