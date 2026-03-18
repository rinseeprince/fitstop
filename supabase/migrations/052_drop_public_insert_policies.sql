-- Drop overly permissive public INSERT policies on check-in sub-tables.
-- These were added in migration 017 for magic-link check-in submissions,
-- but the submission flow uses supabaseAdmin (service role) which bypasses RLS.
-- The public INSERT policies allowed ANY user (including anon) to insert rows.

DROP POLICY IF EXISTS "session_completions_public_insert" ON check_in_session_completions;
DROP POLICY IF EXISTS "exercise_highlights_public_insert" ON check_in_exercise_highlights;
DROP POLICY IF EXISTS "external_activities_public_insert" ON check_in_external_activities;
