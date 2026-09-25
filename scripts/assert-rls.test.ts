import { describe, it, expect } from "vitest";
import {
  createdTables,
  rlsEnabled,
  permissivePolicies,
  anonReachablePolicies,
  viewsWithoutInvoker,
  policies,
  publicRoleGrants,
  serviceRoleGrants,
} from "./assert-rls";

/**
 * Every fixture below is in the shape of a real `supabase db dump` of this
 * project — the pre-fix dump for the violation cases, the post-fix dump for the
 * clean ones. A gate that cannot detect the bugs it was written for is worse
 * than no gate, so each clause is tested against the actual shape that shipped.
 * The grant lines are pg_dump's own spelling (`--quote-all-identifiers`: one
 * statement per grantee, PUBLIC unquoted); the gate's sanity clause fails the
 * live run if that spelling ever drifts.
 */

const PRE_FIX_PUBLIC = `
CREATE TABLE IF NOT EXISTS "public"."training_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."clients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL
);

ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE VIEW "public"."daily_logs_full" AS
 SELECT "dl"."id"
   FROM "public"."daily_logs" "dl";

CREATE POLICY "Authenticated users can access attention_dismissals" ON "public"."attention_dismissals" TO "authenticated" USING (true) WITH CHECK (true);

CREATE POLICY "Coaches can read their own clients" ON "public"."clients" FOR SELECT USING (("coach_id" IN ( SELECT "coaches"."id"
   FROM "public"."coaches"
  WHERE ("coaches"."user_id" = "auth"."uid"()))));
`;

const POST_FIX_PUBLIC = `
CREATE TABLE IF NOT EXISTS "public"."training_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL
);

ALTER TABLE "public"."training_events" ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE VIEW "public"."daily_logs_full" WITH ("security_invoker"='on') AS
 SELECT "dl"."id"
   FROM "public"."daily_logs" "dl";
`;

// The progress-photos hole: no TO clause, so the policy applies to PUBLIC.
const PRE_FIX_STORAGE = `
CREATE POLICY "Allow read access" ON "storage"."objects" FOR SELECT USING (("bucket_id" = 'progress-photos'::"text"));

CREATE POLICY "Coaches can upload content" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'content-library'::"text") AND (("storage"."foldername"("name"))[1] IN ( SELECT ("coaches"."id")::"text" AS "id"
   FROM "public"."coaches"
  WHERE ("coaches"."user_id" = "auth"."uid"())))));
`;

// The shape before migration 201: the sign-in rule migration 137 labelled, the
// stock GRANT ALL on a table and a view, migration 158's authenticated SELECT,
// a sequence, a column grant, a grant to PUBLIC, and postgres's defaults —
// beside the grants that are fine: service_role, postgres, the auth trigger's
// role, a function, and supabase_admin's own defaults.
const PRE_LOCK_PUBLIC = `
CREATE POLICY "Users can view own profile" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "user_id"));

GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";
GRANT ALL ON TABLE "public"."profiles" TO "supabase_auth_admin";
GRANT ALL ON TABLE "public"."daily_logs_full" TO "anon";
GRANT SELECT ON TABLE "public"."client_measurements" TO "authenticated";
GRANT SELECT,INSERT ON TABLE "public"."client_measurements" TO "service_role";
GRANT ALL ON SEQUENCE "public"."things_id_seq" TO "anon";
GRANT SELECT("email") ON TABLE "public"."coaches" TO "authenticated";
GRANT SELECT ON TABLE "public"."waitlist_signups" TO PUBLIC;
GRANT ALL ON TABLE "public"."waitlist_signups" TO "postgres";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
`;

// After migration 201: no policy; service_role, postgres and the auth trigger's
// role keep theirs; postgres's defaults hand a new table to service_role alone.
const POST_LOCK_PUBLIC = `
CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL
);

ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."profiles" TO "postgres";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";
GRANT ALL ON TABLE "public"."profiles" TO "supabase_auth_admin";
GRANT SELECT,INSERT ON TABLE "public"."client_measurements" TO "service_role";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
`;

const POST_LOCK_STORAGE = `
CREATE TABLE IF NOT EXISTS "storage"."objects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL
);
`;

describe("clause 1 — RLS enabled on every public table", () => {
  it("finds the table that has no RLS", () => {
    const tables = createdTables(PRE_FIX_PUBLIC, "public");
    const enabled = rlsEnabled(PRE_FIX_PUBLIC, "public");
    const bare = [...tables].filter((t) => !enabled.has(t));

    expect(bare).toEqual(["training_events"]);
  });

  it("reports nothing once RLS is enabled", () => {
    const tables = createdTables(POST_FIX_PUBLIC, "public");
    const enabled = rlsEnabled(POST_FIX_PUBLIC, "public");

    expect([...tables].filter((t) => !enabled.has(t))).toEqual([]);
  });

  it("matches the ALTER TABLE ONLY spelling pg_dump also emits", () => {
    const sql = `ALTER TABLE ONLY "public"."exercises" ENABLE ROW LEVEL SECURITY;`;
    expect(rlsEnabled(sql, "public").has("exercises")).toBe(true);
  });
});

describe("clause 2 — no trivially-true policy for authenticated or PUBLIC", () => {
  it("catches the FOR ALL TO authenticated USING (true) shape", () => {
    expect(permissivePolicies(PRE_FIX_PUBLIC, "public")).toEqual([
      'public.attention_dismissals -> "Authenticated users can access attention_dismissals"',
    ]);
  });

  it("does NOT catch the progress-photos shape -- its qual is not trivially true", () => {
    // Documents the gap that clause 2b exists to close: USING (bucket_id = ...)
    // looks ordinary; the danger was the missing TO clause.
    expect(permissivePolicies(PRE_FIX_STORAGE, "storage")).toEqual([]);
  });

  it("does not flag a correctly scoped policy", () => {
    const hits = permissivePolicies(PRE_FIX_STORAGE, "storage");
    expect(hits).not.toContain('storage.objects -> "Coaches can upload content"');
  });

  it("does not flag a coach-scoped subquery policy that merely mentions no true literal", () => {
    expect(permissivePolicies(PRE_FIX_PUBLIC, "public")).not.toContain(
      'public.clients -> "Coaches can read their own clients"',
    );
  });
});

describe("clause 2b — nothing reachable by anon", () => {
  it("catches the progress-photos policy: no TO clause means PUBLIC, which includes anon", () => {
    expect(anonReachablePolicies(PRE_FIX_STORAGE, "storage")).toEqual([
      'storage.objects -> "Allow read access"',
    ]);
  });

  it("does not flag a policy explicitly scoped TO authenticated", () => {
    expect(anonReachablePolicies(PRE_FIX_STORAGE, "storage")).not.toContain(
      'storage.objects -> "Coaches can upload content"',
    );
  });

  it("does NOT flag a no-TO-clause policy whose qual keys on auth.uid() -- it fails closed for anon", () => {
    // ~100 policies in this schema were this shape. auth.uid() is NULL without a
    // JWT, so the predicate cannot match. Flagging them would bury the signal.
    const hits = anonReachablePolicies(PRE_FIX_PUBLIC, "public");
    expect(hits).not.toContain('public.clients -> "Coaches can read their own clients"');
  });

  it("flags only the policy whose qual never references the caller", () => {
    expect(anonReachablePolicies(PRE_FIX_PUBLIC, "public")).toEqual([]);
  });
});

describe("clause 3 — every view is security_invoker", () => {
  it("flags an owner-rights view", () => {
    expect(viewsWithoutInvoker(PRE_FIX_PUBLIC, "public")).toEqual([
      "public.daily_logs_full",
    ]);
  });

  it("accepts pg_dump's WITH (\"security_invoker\"='on') spelling", () => {
    // Regression: the first implementation expected security_invoker'=' and
    // reported a false violation against this exact line.
    expect(viewsWithoutInvoker(POST_FIX_PUBLIC, "public")).toEqual([]);
  });
});

describe("clause 4 — no policy at all", () => {
  it("flags every policy in public, whatever its shape — the correctly scoped sign-in rule included", () => {
    expect(policies(PRE_FIX_PUBLIC, "public")).toEqual([
      'public.attention_dismissals -> "Authenticated users can access attention_dismissals"',
      'public.clients -> "Coaches can read their own clients"',
    ]);
    expect(policies(PRE_LOCK_PUBLIC, "public")).toEqual(['public.profiles -> "Users can view own profile"']);
  });

  it("flags every policy in storage, the coach-scoped TO authenticated ones included", () => {
    expect(policies(PRE_FIX_STORAGE, "storage")).toEqual([
      'storage.objects -> "Allow read access"',
      'storage.objects -> "Coaches can upload content"',
    ]);
  });

  it("reports nothing on the locked shape", () => {
    expect(policies(POST_LOCK_PUBLIC, "public")).toEqual([]);
    expect(policies(POST_LOCK_STORAGE, "storage")).toEqual([]);
  });

  it("skips a policy named in the allowlist and nothing else", () => {
    const allow = new Set(['public.clients -> "Coaches can read their own clients"']);
    expect(policies(PRE_FIX_PUBLIC, "public", allow)).toEqual([
      'public.attention_dismissals -> "Authenticated users can access attention_dismissals"',
    ]);
  });
});

describe("clause 5 — no anon, authenticated or PUBLIC privilege on a public relation", () => {
  it("flags every grant to a public role: a table, a view, a sequence, a column, PUBLIC, and postgres's defaults", () => {
    expect(publicRoleGrants(PRE_LOCK_PUBLIC, "public")).toEqual([
      "public.profiles -> anon: ALL",
      "public.profiles -> authenticated: ALL",
      "public.daily_logs_full -> anon: ALL",
      "public.client_measurements -> authenticated: SELECT",
      "public.things_id_seq -> anon: ALL",
      'public.coaches -> authenticated: SELECT("email")',
      "public.waitlist_signups -> PUBLIC: SELECT",
      "public default SEQUENCES -> authenticated: ALL",
      "public default TABLES -> anon: ALL",
    ]);
  });

  it("does not flag service_role, postgres or the auth trigger's role", () => {
    const hits = publicRoleGrants(PRE_LOCK_PUBLIC, "public");
    expect(hits.some((h) => /service_role|postgres|supabase_auth_admin/.test(h))).toBe(false);
  });

  it("does not judge functions, nor supabase_admin's defaults, which are not ours to change", () => {
    const hits = publicRoleGrants(PRE_LOCK_PUBLIC, "public");
    expect(hits.some((h) => /handle_new_user|FUNCTIONS|supabase_admin/.test(h))).toBe(false);
  });

  it("reports nothing on the locked shape", () => {
    expect(publicRoleGrants(POST_LOCK_PUBLIC, "public")).toEqual([]);
  });

  it("skips a grant named in the allowlist and nothing else", () => {
    const allow = new Set(["public.waitlist_signups -> PUBLIC: SELECT"]);
    expect(publicRoleGrants(PRE_LOCK_PUBLIC, "public", allow)).not.toContain("public.waitlist_signups -> PUBLIC: SELECT");
    expect(publicRoleGrants(PRE_LOCK_PUBLIC, "public", allow)).toHaveLength(8);
  });

  it("sanity: still sees the service role's grants in a locked dump, so a dump without privileges cannot pass silently", () => {
    expect(serviceRoleGrants(POST_LOCK_PUBLIC, "public")).toBe(2);
    expect(serviceRoleGrants(PRE_FIX_PUBLIC, "public")).toBe(0);
  });
});
