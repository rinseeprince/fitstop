# Migrations

This folder is an append-only ledger. Every schema change lands here as the next free number and is never edited once `npx supabase db push` has applied it (CONVENTIONS §8 → "Migration workflow"). Read it as history, not as a description of the database.

The shape of the database is described in `docs/ARCHITECTURE.md` and held by `npm run check:rls`, which reads the live catalog: RLS is enabled on every table with no policies, `anon` and `authenticated` hold no privilege on any table, view or sequence in `public`, and every SECURITY DEFINER function is executable by `service_role` alone. Earlier files here create policies and public-role grants; migrations 200 and 201 dropped every one of them. Do not copy those patterns.

A new table follows CONVENTIONS §8: enable RLS, write no policy, `REVOKE ALL` then `GRANT` exactly what the service layer needs to `service_role`. A new database function the app calls is SECURITY DEFINER, with `REVOKE … FROM PUBLIC, anon, authenticated` then `GRANT EXECUTE … TO service_role`.

Both projects have drifted from this tree before, in both directions. A claim about the live database is checked against the live catalog (`npx supabase db query --linked`), never inferred from the files here.
