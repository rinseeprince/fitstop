-- Security: stop privilege escalation from client -> trainer.
--
-- WHY (three independent escalation paths today):
--   1. handle_new_user() (migration 025) derives role from CLIENT-SUPPLIED signup
--      metadata: COALESCE(NEW.raw_user_meta_data->>'role', 'trainer'). A signup can
--      send role:'trainer' and be created as a coach (the trigger then also inserts
--      the coaches row).
--   2. The profiles UPDATE policy (migration 021) has no role guard, so a user can
--      UPDATE their own profiles row and flip role to 'trainer' via the anon key.
--   3. The coaches INSERT policy (migration 006) lets any authenticated user insert
--      their own coaches row regardless of role.
-- Effect: a confined client can escape into the full coach surface (/dashboard,
-- /clients, /api/clients/**) — a trust-boundary break and abuse/cost vector.
--
-- FIX: derive role from SERVER state (does a pending invitation exist for this
-- email?), not from client metadata; pin profiles.role on UPDATE; require an
-- existing trainer profile to create a coaches row.
--
-- TEST-SAFE: an invited client always has a client_invitations row created (by the
-- coach) BEFORE they sign up via /invite/[token], so they still resolve to
-- role='client'. A self-signup with no invitation resolves to 'trainer' (the coach
-- onboarding path). This preserves the fake-email test-account onboarding flow.

-- 1. Rewrite the signup trigger to ignore client-supplied role.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_role TEXT;
  user_name TEXT;
BEGIN
  -- Role is derived from server state, NOT from raw_user_meta_data->>'role'.
  -- If this email was invited as a client (invitation row exists), they are a
  -- client; otherwise this is a coach self-signup.
  IF EXISTS (
    SELECT 1 FROM public.client_invitations ci
    WHERE lower(ci.email) = lower(NEW.email)
  ) THEN
    user_role := 'client';
  ELSE
    user_role := 'trainer';
  END IF;

  -- Name/avatar are non-security display fields; still sourced from metadata.
  user_name := COALESCE(
    NEW.raw_user_meta_data->>'name',
    NEW.raw_user_meta_data->>'full_name',
    split_part(NEW.email, '@', 1)
  );

  INSERT INTO public.profiles (user_id, role)
  VALUES (NEW.id, user_role)
  ON CONFLICT (user_id) DO NOTHING;

  IF user_role = 'trainer' THEN
    INSERT INTO public.coaches (user_id, name, email, avatar_url)
    VALUES (
      NEW.id,
      user_name,
      NEW.email,
      NEW.raw_user_meta_data->>'avatar_url'
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Pin profiles.role on UPDATE so an authenticated user cannot escalate their
--    own role via the anon key. The subquery reads the pre-update (committed) role
--    of the caller's row, so role must stay unchanged. service_role bypasses RLS
--    and can still change roles legitimately.
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND role = (SELECT p.role FROM public.profiles p WHERE p.user_id = auth.uid())
  );

-- 3. Only allow a coaches row to be created (via the anon/authenticated key) when
--    the caller already has a trainer profile. Legitimate coach rows are created by
--    the SECURITY DEFINER trigger above (which bypasses RLS), so this only blocks
--    direct self-promotion inserts.
DROP POLICY IF EXISTS "Authenticated users can create their own coach profile" ON public.coaches;
CREATE POLICY "Authenticated users can create their own coach profile"
  ON public.coaches FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid() AND p.role = 'trainer'
    )
  );
