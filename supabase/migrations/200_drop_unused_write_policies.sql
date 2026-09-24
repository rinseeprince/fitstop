-- The Data API's write side door closes: the 55 write rules nothing uses are
-- dropped (docs/DATA-ACCESS-LOCKDOWN-PLAN.md §6 commit 2).
--
-- Every write the app makes goes through a route and the service role, which
-- bypasses RLS. Yet 56 write rules on 23 tables let a signed-in user write rows
-- straight through the Data API (/rest/v1) with the browser's public key and
-- their own token, skipping every rule the routes enforce: a client could
-- rewrite a closed week's wellness, food and habit logs, add or delete workout
-- logs and sets, and post a check-in; a coach could hard-delete a client (the
-- cascade takes their whole history, with no archive and no audit entry) and
-- create or edit check-ins, invitations, reminders, intake, habits and content.
--
-- Probed 2026-09-24 on DEV and PROD: the same 56 rules on both, all PERMISSIVE
-- (so each drop narrows access, never widens it), all keyed on auth.uid().
-- Only one has a user: activation's UPDATE of the client row, made under the
-- coach's own session (app/api/clients/[id]/activate/route.ts). It stays until
-- that write moves onto the server; the comment below names it. No other code
-- writes through a session client, and neither database's pg_stat_statements
-- holds a user-role write that one of these 55 rules governs.
--
-- The three ALL rules (client_intake, daily_habits, daily_habit_logs) also
-- grant a read. Nothing reads those tables through a session client, so they
-- go whole. The nine training_* rules compare a coaches.id with auth.uid() and
-- could never pass. DEV carries a `TO authenticated` on two daily_logs rules
-- that PROD does not (dashboard drift); the drop is by name, so both go.
--
-- The closing check raises unless exactly one write rule remains in public and
-- it is activation's: a name the dashboard drifted would otherwise skip
-- silently, as it did to migration 125. No grant changes (CONVENTIONS §8).

-- check_in_exercise_highlights
DROP POLICY IF EXISTS "clients_insert_exercise_highlights" ON public.check_in_exercise_highlights;
DROP POLICY IF EXISTS "exercise_highlights_delete" ON public.check_in_exercise_highlights;
DROP POLICY IF EXISTS "exercise_highlights_insert" ON public.check_in_exercise_highlights;
DROP POLICY IF EXISTS "exercise_highlights_update" ON public.check_in_exercise_highlights;

-- check_in_reminders
DROP POLICY IF EXISTS "Coaches can create reminders for their clients" ON public.check_in_reminders;
DROP POLICY IF EXISTS "Coaches can update reminders for their clients" ON public.check_in_reminders;

-- check_ins
DROP POLICY IF EXISTS "Coaches can create check-ins for their clients" ON public.check_ins;
DROP POLICY IF EXISTS "Coaches can update their clients check-ins" ON public.check_ins;
DROP POLICY IF EXISTS "clients_insert_own_check_ins" ON public.check_ins;

-- client_intake
DROP POLICY IF EXISTS "coaches_manage_client_intake" ON public.client_intake;

-- client_invitations
DROP POLICY IF EXISTS "Coaches can create client invitations" ON public.client_invitations;
DROP POLICY IF EXISTS "Coaches can update client invitations" ON public.client_invitations;

-- clients (activation's "Coaches can update their own clients" stays)
DROP POLICY IF EXISTS "Coaches can delete their own clients" ON public.clients;
DROP POLICY IF EXISTS "Coaches can insert their own clients" ON public.clients;

-- coaches
DROP POLICY IF EXISTS "Coaches can update their own data" ON public.coaches;

-- content_assignments
DROP POLICY IF EXISTS "Coaches can create assignments for their clients" ON public.content_assignments;
DROP POLICY IF EXISTS "Coaches can delete assignments for their clients" ON public.content_assignments;

-- content_folders
DROP POLICY IF EXISTS "Coaches can create their own folders" ON public.content_folders;
DROP POLICY IF EXISTS "Coaches can delete their own folders" ON public.content_folders;
DROP POLICY IF EXISTS "Coaches can update their own folders" ON public.content_folders;

-- content_items
DROP POLICY IF EXISTS "Coaches can create their own content" ON public.content_items;
DROP POLICY IF EXISTS "Coaches can delete their own content" ON public.content_items;
DROP POLICY IF EXISTS "Coaches can update their own content" ON public.content_items;

-- daily_habit_logs
DROP POLICY IF EXISTS "clients_manage_own_habit_logs" ON public.daily_habit_logs;

-- daily_habits
DROP POLICY IF EXISTS "coaches_manage_client_habits" ON public.daily_habits;

-- daily_logs
DROP POLICY IF EXISTS "clients_delete_daily_logs" ON public.daily_logs;
DROP POLICY IF EXISTS "clients_insert_daily_logs" ON public.daily_logs;
DROP POLICY IF EXISTS "clients_insert_own_daily_logs" ON public.daily_logs;
DROP POLICY IF EXISTS "clients_update_daily_logs" ON public.daily_logs;
DROP POLICY IF EXISTS "clients_update_own_daily_logs" ON public.daily_logs;

-- exercise_logs
DROP POLICY IF EXISTS "clients_delete_exercise_logs" ON public.exercise_logs;
DROP POLICY IF EXISTS "clients_insert_exercise_logs" ON public.exercise_logs;
DROP POLICY IF EXISTS "clients_update_exercise_logs" ON public.exercise_logs;

-- nutrition_logs
DROP POLICY IF EXISTS "clients_insert_own_nutrition_logs" ON public.nutrition_logs;
DROP POLICY IF EXISTS "clients_update_own_nutrition_logs" ON public.nutrition_logs;

-- profiles
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- session_logs
DROP POLICY IF EXISTS "clients_delete_session_logs" ON public.session_logs;
DROP POLICY IF EXISTS "clients_insert_session_logs" ON public.session_logs;
DROP POLICY IF EXISTS "clients_update_session_logs" ON public.session_logs;

-- set_logs
DROP POLICY IF EXISTS "clients_delete_set_logs" ON public.set_logs;
DROP POLICY IF EXISTS "clients_insert_set_logs" ON public.set_logs;
DROP POLICY IF EXISTS "clients_update_set_logs" ON public.set_logs;

-- training_exercises
DROP POLICY IF EXISTS "training_exercises_delete" ON public.training_exercises;
DROP POLICY IF EXISTS "training_exercises_insert" ON public.training_exercises;
DROP POLICY IF EXISTS "training_exercises_update" ON public.training_exercises;

-- training_logs
DROP POLICY IF EXISTS "clients_insert_own_training_logs" ON public.training_logs;
DROP POLICY IF EXISTS "clients_update_own_training_logs" ON public.training_logs;

-- training_plans
DROP POLICY IF EXISTS "training_plans_delete" ON public.training_plans;
DROP POLICY IF EXISTS "training_plans_insert" ON public.training_plans;
DROP POLICY IF EXISTS "training_plans_update" ON public.training_plans;

-- training_sessions
DROP POLICY IF EXISTS "training_sessions_delete" ON public.training_sessions;
DROP POLICY IF EXISTS "training_sessions_insert" ON public.training_sessions;
DROP POLICY IF EXISTS "training_sessions_update" ON public.training_sessions;

-- wellness_logs
DROP POLICY IF EXISTS "clients_insert_own_wellness_logs" ON public.wellness_logs;
DROP POLICY IF EXISTS "clients_update_own_wellness_logs" ON public.wellness_logs;

-- COMMENT ON POLICY errors on a name that does not exist, so a drifted name
-- fails here rather than skipping.
COMMENT ON POLICY "Coaches can update their own clients" ON public.clients IS
  'The one write rule in public. Its one user is activation (POST /api/clients/[id]/activate, app/api/clients/[id]/activate/route.ts), which updates the client row under the coach''s own session. Every other write goes through a route and the service role.';

DO $$
DECLARE
  write_rules TEXT;
BEGIN
  SELECT string_agg(format('%s on %s (%s)', policyname, tablename, cmd), '; ' ORDER BY tablename, policyname)
    INTO write_rules
    FROM pg_policies
   WHERE schemaname = 'public'
     AND cmd <> 'SELECT';

  IF write_rules IS DISTINCT FROM 'Coaches can update their own clients on clients (UPDATE)' THEN
    RAISE EXCEPTION 'Migration 200 expected exactly one write rule in public, activation''s UPDATE on clients; found: %',
      coalesce(write_rules, 'none');
  END IF;
END $$;
