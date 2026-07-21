-- Remove the client-side policies on client_intake (audit H7).
--
-- WHY: the three client policies pin only client_id and impose no column
-- restriction, and RLS has no column granularity. client_intake carries
-- coach-only review columns -- status, reviewed_at, reviewed_by and
-- coach_review_notes -- so with an authenticated client JWT plus the
-- browser-shipped anon key, hitting PostgREST directly a client could:
--   * READ the coach's private coach_review_notes and the whole review state
--     (clients_select_own_intake), and
--   * OVERWRITE reviewed_by / reviewed_at / status / coach_review_notes
--     (clients_update_own_intake), forging or erasing coach review state.
-- Same partial-pin class as the clients UPDATE policy dropped in migration 124.
--
-- NON-BREAKING, verified: every client_intake access in the repo goes through
-- supabaseAdmin (service_role, bypasses RLS). All 7 call sites live in exactly
-- two services -- services/client-intake-service.ts (:60, :79, :157, :229, :265;
-- `const db = supabaseAdmin` at :8) which drives the CLIENT onboarding
-- read/step-save/submit routes under app/api/client/intake/**, and
-- services/intake-review-service.ts (:20, :60; `const db = supabaseAdmin` at
-- :10) which drives coach review. There is no browser or session-scoped client
-- query against this table anywhere. So these three policies are dead for the
-- app and are the only gate on a direct PostgREST call.
--
-- After this migration coaches_manage_client_intake remains as the sole policy.
-- It is coach-scoped (not a blanket USING (true)), so it is left alone -- same
-- scope discipline applied to the unused coach storage policies in 126.
--
-- Postgres DROP POLICY takes ONE policy per statement; these cannot be
-- comma-listed. Re-runnable via IF EXISTS.

DROP POLICY IF EXISTS "clients_select_own_intake" ON public.client_intake;
DROP POLICY IF EXISTS "clients_update_own_intake" ON public.client_intake;
DROP POLICY IF EXISTS "clients_insert_own_intake" ON public.client_intake;
