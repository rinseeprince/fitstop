import { describe, it, expect } from "vitest";
import {
  createdTables,
  rlsEnabled,
  permissivePolicies,
  anonReachablePolicies,
  viewsWithoutInvoker,
} from "./assert-rls";

/**
 * Every fixture below is copied VERBATIM from a real `supabase db dump` of this
 * project — the pre-fix dump for the violation cases, the post-fix dump for the
 * clean ones. A gate that cannot detect the bugs it was written for is worse
 * than no gate, so each clause is tested against the actual shape that shipped.
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
    // ~100 policies in this schema are this shape. auth.uid() is NULL without a
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
