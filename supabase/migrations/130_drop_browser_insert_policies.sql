-- Drop the two INSERT policies that existed solely for the browser-side
-- profile/coach creation fallbacks deleted in the auth bootstrap refactor
-- (commit 7888667: contexts/auth-context.tsx no longer performs any PostgREST
-- calls; creation is server-side only — the mig-107 signup trigger plus the
-- supabaseAdmin self-heal in services/auth-profile-service.ts, both of which
-- bypass RLS).
--
-- The profiles policy is also a live security hole: its WITH CHECK constrains
-- user_id but NOT role, so any authenticated JWT could mint itself a 'trainer'
-- profile directly via PostgREST (TECHNICAL-DEBT → Known RLS Gaps).
--
-- INSERT only. The SELECT policies (and the role-pinned UPDATE on profiles)
-- are load-bearing — middleware reads profiles.role and getAuthenticatedCoachId
-- reads coaches through session-scoped clients; dropping those bricks login.
--
-- Names verified against a fresh `db dump --linked` immediately before writing
-- this file (drift precedent: a renamed policy makes IF EXISTS a silent no-op —
-- verify the policies are GONE in a fresh dump after pushing, not just push
-- exit 0).

DROP POLICY IF EXISTS "Authenticated users can create profile" ON public.profiles;

DROP POLICY IF EXISTS "Authenticated users can create their own coach profile" ON public.coaches;
