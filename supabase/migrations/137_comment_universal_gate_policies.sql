-- Warning labels on the three RLS policies that are universal auth gates.
--
-- No schema change. This migration only attaches COMMENT ON POLICY text, so the
-- warning lives IN THE DATABASE — visible in `\d+`, in the Studio policy list,
-- and in `pg_dump` output. That is deliberate: a cleanup pass deletes a policy
-- from one of those surfaces, not from a markdown file, so the warning has to be
-- where the delete happens.
--
-- WHY THESE THREE:
-- CONVENTIONS §8 says RLS is a safety net because service_role bypasses it. That
-- is true for ~all of the app, but NOT here. A 2026-07-30 read-path trace (every
-- Supabase client factory enumerated, every .from() receiver resolved) found a
-- second, smaller anon-key + RLS path where RLS *is* the enforcing control. Four
-- reads on that path are load-bearing for the entire product, and they are
-- governed by the three policies below:
--
--   middleware.ts:105        -> profiles  ("Users can view own profile")
--   lib/auth-helpers.ts:82   -> coaches   ("Coaches can read their own data")
--   lib/auth-helpers.ts:135  -> clients   ("Clients can view own profile")
--   lib/auth-helpers.ts:195  -> clients   (same policy, second read site)
--
-- Drop any one of them and the product does not degrade — it stops. middleware
-- hard-redirects every non-exempt route to /login?error=profile_unavailable;
-- getAuthenticatedCoachId returns null so every coach API 401s;
-- getAuthenticatedClientId returns null so every client-portal route 401s.
--
-- All three are PERMISSIVE (verified 2026-07-30: all 114 live policies are, and
-- zero are RESTRICTIVE), so dropping one narrows access rather than widening it.
-- Each qual is `auth.uid() = user_id`, which fails closed without a JWT.
--
-- Defined originally in 021:15 (profiles), 004:59 (coaches), 023:9 (clients).
-- Those files are history and are not edited; this is the next number instead.
--
-- COMMENT ON POLICY errors if the policy name does not exist, so this migration
-- fails loudly rather than silently no-opping if a name has drifted — which has
-- happened on this project before (migration 125's DROP POLICY hit a Studio-
-- renamed policy and did nothing while still exiting 0).

COMMENT ON POLICY "Users can view own profile" ON public.profiles IS
  'UNIVERSAL AUTH GATE — do not drop. Read by middleware.ts:105 for every non-exempt route; without it middleware fail-closes and hard-redirects the whole product to /login?error=profile_unavailable. Removal is total lockout, not a degraded feature.';

COMMENT ON POLICY "Coaches can read their own data" ON public.coaches IS
  'UNIVERSAL AUTH GATE — do not drop. Read by getAuthenticatedCoachId (lib/auth-helpers.ts:82), the step-2 auth check of every coach route (imported by 67 non-test files). Removal 401s every coach API. Not a degraded feature.';

COMMENT ON POLICY "Clients can view own profile" ON public.clients IS
  'UNIVERSAL AUTH GATE — do not drop. Read by getAuthenticatedClientId (lib/auth-helpers.ts:135) and getAuthenticatedClientWithCheckInDay (:195), reached via lib/require-client-auth.ts by every client-portal route. Removal 401s the entire client portal. Not a degraded feature.';
