-- Security: drop legacy permissive RLS policies on check_ins and check_in_tokens.
--
-- WHY: These three policies (created in migration 003) grant ANY authenticated
-- user blanket SELECT/UPDATE on every row, across all tenants. Their inline TODOs
-- ("filter by coach_id when the relationship table exists") were never resolved
-- and the policies were never dropped (verified via grep across migrations 001-104).
--
-- THREAT MODEL: Under "Shape B" the app always talks to the DB via service_role
-- (which bypasses RLS), so RLS is described as defense-in-depth. BUT the public
-- anon key ships in the browser and a logged-in user holds an `authenticated`
-- JWT, so anyone can call PostgREST directly:
--   GET  /rest/v1/check_ins?select=*           -> read EVERY client's health data
--   PATCH/rest/v1/check_ins?id=eq.<row>        -> overwrite any check-in
--   GET  /rest/v1/check_in_tokens?select=*     -> harvest other clients' magic-link tokens
-- For these objects RLS is the ONLY perimeter, not defense-in-depth. Dropping the
-- permissive policies closes the direct cross-tenant path. The app is unaffected
-- because every legitimate read/write goes through service_role.

-- check_ins: remove the all-tenant SELECT/UPDATE policies.
-- Remaining policies after this migration: the client-scoped
-- clients_view_own_check_ins / clients_insert_own_check_ins (migration 026).
-- Coaches continue to read/respond via service_role (route layer is the perimeter).
DROP POLICY IF EXISTS "Authenticated users can view check-ins" ON check_ins;
DROP POLICY IF EXISTS "Authenticated users can update check-ins" ON check_ins;

-- check_in_tokens: remove the all-tenant SELECT policy. This table is only ever
-- read/written by service_role (token generation + validation in API routes), so
-- after this drop it has no anon-reachable policy -> deny-all for non-service-role,
-- which is the correct posture for a credential table.
DROP POLICY IF EXISTS "Authenticated users can view tokens" ON check_in_tokens;
