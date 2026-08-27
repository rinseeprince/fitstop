-- Drop two functions nothing calls. Found by the 2026-08-26 dead-code sweep, which
-- reported them rather than removing them: a function lives in the database, so
-- retiring it is a migration rather than a code edit.
--
-- clean_expired_tokens() is worse than unused — it is BROKEN. It DELETEs from
-- check_in_tokens, and migration 142 dropped that table when magic-link check-ins
-- were retired. The function survived the table it existed to clean, so any call
-- errors on a missing relation. It is only inert because nothing calls it:
-- `pg_cron` is not installed, so nothing in-database is scheduled, and no route,
-- service or script in the repo references it. A hand-run in the SQL editor is the
-- one way to hit it, which is exactly the trap a leftover leaves.
--
-- calculate_age(date) is the ordinary kind of dead: no caller in the repo, no
-- trigger, no default, no dependent object. Age is derived in TypeScript where it
-- is needed.
--
-- Verified on DEV before writing this: zero triggers bound to either function
-- (pg_trigger.tgfoid) and zero non-pin entries in pg_depend referencing them, so
-- neither is wired to a column default, another function, or a view. The same
-- probe was run against PROD before this was pushed — a DROP cannot be undone by a
-- follow-up migration, and dependency facts are per-database (CONVENTIONS §8).
--
-- IF EXISTS on both so a half-applied push stays re-runnable.

DROP FUNCTION IF EXISTS public.clean_expired_tokens();

DROP FUNCTION IF EXISTS public.calculate_age(date_of_birth date);
