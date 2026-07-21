-- Remove three over-permissive policies. All three resolve to deny-all, because
-- in every case the only real consumer is service_role, which bypasses RLS.
--
-- ---------------------------------------------------------------------------
-- (a) attention_dismissals -- 091_add_attention_dismissals.sql:12
-- (b) coach_client_views   -- 101_add_coach_client_views.sql:19
-- ---------------------------------------------------------------------------
-- Both are literally:
--   FOR ALL TO authenticated USING (true) WITH CHECK (true)
-- i.e. any authenticated account -- coach or client -- could read and write
-- every row. coach_client_views is the raw (coach_id, client_id) membership
-- graph, so one unfiltered GET enumerated every tenant's roster;
-- attention_dismissals leaks which clients are flagged for what and let any
-- account suppress or resurface another coach's risk alerts.
--
-- These are not theoretical: services/supabase-client.ts ships the anon key to
-- the browser and contexts/auth-context.tsx holds a live user JWT, so the pair
-- is reachable directly through PostgREST.
--
-- Both tables were created AFTER 105_drop_permissive_checkin_rls.sql had already
-- established why this shape is wrong. The reason is CONVENTIONS.md, which still
-- prescribes "authenticated-allow" policies for new tables -- corrected in the
-- docs commit that accompanies this work, or this bug recurs on the next table.
--
-- Deny-all rather than owner-scoped policies: all four code call sites for these
-- two tables use supabaseAdmin, and the only test touching them is fully mocked.
-- An owner-scoped policy would add a nested subquery that nothing reads. Same
-- posture and precedent as migration 122 and 108:37 (audit_logs).
--
-- ---------------------------------------------------------------------------
-- (c) storage.objects, content-library bucket -- 029_add_content_library.sql:333
-- ---------------------------------------------------------------------------
-- "Clients can view their coach's content" matched only
--   (storage.foldername(name))[1] = the client's coach_id
-- consulting neither is_library nor content_assignments, so a client could read
-- EVERY object under their coach's prefix -- including files assigned privately
-- to a different client.
--
-- Dropped rather than rewritten as a join. No legitimate flow traverses this
-- policy: an exhaustive repo audit finds zero non-admin .storage calls anywhere
-- in app/, components/, hooks/, lib/, services/ or contexts/. Both buckets are
-- reached only through services/content-storage-service.ts:14,32,44 and
-- services/storage-service.ts:17,46,66,100,113,124,135, all on supabaseAdmin.
-- Clients download via a server-generated signed URL
-- (app/api/content/download/[contentId]/route.ts:79 -> getContentFileSignedUrl),
-- and that route already enforces coach-match plus is_library-or-assignment at
-- :49-69; its session client is used only for supabase.auth.getUser().
--
-- The rejected alternative was a policy joining
-- content_items.storage_path = storage.objects.name. It was rejected because it
-- is untestable (vitest mocks supabaseAdmin, so a wrong join stays invisible
-- until a coach reports broken downloads), because it fails silently in BOTH
-- directions on any byte mismatch in the path -- the exact "looks protective but
-- isn't" class this audit kept finding -- and because it puts a cross-schema
-- join on every storage operation.
--
-- NOT touched: the three coach storage policies (029:297-331). They are unused by
-- the same evidence, but removing them is out of scope here.
--
-- Re-runnable via IF EXISTS.

DROP POLICY IF EXISTS "Authenticated users can access attention_dismissals" ON public.attention_dismissals;
DROP POLICY IF EXISTS "Authenticated users can access coach_client_views" ON public.coach_client_views;
DROP POLICY IF EXISTS "Clients can view their coach's content" ON storage.objects;

COMMENT ON TABLE public.attention_dismissals IS
  'Coach-dismissed attention alerts. RLS enabled with no policies (deny-all): all access is via service_role.';
COMMENT ON TABLE public.coach_client_views IS
  'Coach last-viewed-client state. RLS enabled with no policies (deny-all): all access is via service_role.';
