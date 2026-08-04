-- Private-beta waitlist signups for the public marketing site (atletafit.com).
--
-- WHY THIS TABLE LIVES IN THIS PROJECT:
-- The writer is a DIFFERENT codebase — the `atletafit-marketing` repo, its own
-- Vercel project — which POSTs here over PostgREST with its own dedicated secret
-- key. It does not share this repo's client factories, services, or types.
-- The alternative was a second (free-tier) Supabase project, which pauses after a
-- week of inactivity and would silently break the live form. So the table lands
-- here, and this repo owns the schema: created by migration, never by hand in the
-- dashboard, so that `supabase db reset` reproduces it instead of dropping it with
-- nothing in either repo explaining where it went.
--
-- THE THREE THINGS THAT LOOK IMPROVABLE AND ARE NOT:
--
--  1. The unique index is on lower(email), NOT on email. The marketing route
--     detects a repeat signup by catching Postgres error 23505 and rendering
--     "You're already on the list." Replacing this with an upsert, or dropping
--     it, removes the 23505 and silently degrades that path to a success page.
--
--  2. RLS is enabled with ZERO policies, deliberately. This project's publishable
--     key is public by design and ships in a browser bundle. No policies means no
--     browser-reachable path to this table, which keeps the honeypot + Turnstile
--     on the marketing form the only way in. Adding an `anon` insert policy would
--     open a direct write path that bypasses both. (service_role / secret keys
--     bypass RLS entirely, which is how the marketing route still writes.)
--
--  3. `updates` and `consented_at` are consent EVIDENCE, not preferences. UK GDPR
--     Art. 7(1) puts the burden on us to demonstrate what someone agreed to and
--     when, so `updates = false` has to be a stored "no" rather than an absent
--     row. Do not make either column nullable, and do not drop the default.
--
-- Column names are a contract with `app/api/waitlist/route.ts` in the marketing
-- repo. That repo is not rebuilt when this one deploys, so renaming a column here
-- breaks production silently.

CREATE TABLE IF NOT EXISTS public.waitlist_signups (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT        NOT NULL,
  email        TEXT        NOT NULL,
  updates      BOOLEAN     NOT NULL DEFAULT false,
  consented_at TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Case-insensitive: "Sam@x.com" and "sam@x.com" are one person. Violating this
-- raises 23505, which is the marketing route's duplicate-signup signal.
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_signups_email_key
  ON public.waitlist_signups (LOWER(email));

ALTER TABLE public.waitlist_signups ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.waitlist_signups IS
  'Written by the atletafit-marketing repo (app/api/waitlist/route.ts) over PostgREST, using its own secret key. Column names and the unique index are part of that contract: do not rename or drop without changing that repo first. RLS is intentionally enabled with no policies.';
