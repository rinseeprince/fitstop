-- Enable RLS on the five tables that shipped without it.
--
-- WHY: training_events, exercises and the three coach_saved_* tables were each
-- created with no ENABLE ROW LEVEL SECURITY and no policies (075:4, 083:5,
-- 084:6/27/46), and no later migration adds them. Supabase's stock default
-- privileges leave anon/authenticated with GRANT ALL, so RLS is the only filter
-- between the browser-shipped NEXT_PUBLIC_SUPABASE_ANON_KEY and PostgREST.
-- Measured against production before this migration: an unauthenticated GET with
-- the anon key returned training_events 540 rows, exercises 1597,
-- coach_saved_plans 28, coach_saved_sessions 164, coach_saved_exercises 275.
-- That is a cross-tenant read AND write of every coach's calendar and library.
--
-- DENY-ALL, NOT POLICIES: every read and write of all five goes through
-- supabaseAdmin (service_role, which bypasses RLS) -- 105+ call sites across 23
-- files, zero in components/hooks/contexts, zero Realtime subscriptions in the
-- repo, zero PostgREST embeds on a non-admin client. So no policy is needed for
-- the app to work, and enabling RLS with none is deny-by-default for anon and
-- authenticated. Precedent: 108_create_audit_logs.sql:37 does exactly this.
-- Related precedent for omitting write policies: 044:125, 077:46.
--
-- ON THE REMAINING `GRANT ALL ... TO anon`: it is intentionally left in place.
-- RLS covers SELECT/INSERT/UPDATE/DELETE, which is everything PostgREST exposes,
-- so the grant buys nothing through the REST surface. The genuine residual is
-- TRUNCATE -- to which RLS does NOT apply -- plus schema introspection, and
-- neither is reachable through PostgREST. A table-level REVOKE is a separate,
-- stronger lever, deliberately not taken here. This is not an oversight.
--
-- Re-runnable: ENABLE ROW LEVEL SECURITY is a no-op when already enabled.

ALTER TABLE IF EXISTS public.training_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.exercises              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.coach_saved_plans      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.coach_saved_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.coach_saved_exercises  ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.training_events IS
  'Events-as-SOT calendar. RLS enabled with no policies (deny-all): all access is via service_role.';
COMMENT ON TABLE public.exercises IS
  'Two-tier exercise catalog (coach_id NULL = global). RLS enabled with no policies (deny-all): all access is via service_role.';
COMMENT ON TABLE public.coach_saved_plans IS
  'Coach program library. RLS enabled with no policies (deny-all): all access is via service_role.';
COMMENT ON TABLE public.coach_saved_sessions IS
  'Coach session library. RLS enabled with no policies (deny-all): all access is via service_role.';
COMMENT ON TABLE public.coach_saved_exercises IS
  'Coach library exercise rows. RLS enabled with no policies (deny-all): all access is via service_role.';
