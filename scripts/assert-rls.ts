/**
 * Schema-security gate. Asserts five invariants against the LIVE database and
 * exits non-zero on any violation.
 *
 *   npx tsx scripts/assert-rls.ts          (or: npm run check:rls)
 *
 *   1. Every table in `public` has RLS enabled.
 *   2. No policy grants `authenticated` or PUBLIC a trivially-true qual, and
 *      none is reachable by `anon` without keying on the caller.
 *   3. Every view in `public` and `storage` is security_invoker.
 *   4. No policy exists in `public` or `storage` at all.
 *   5. `anon`, `authenticated` and PUBLIC hold no privilege on any table, view
 *      or sequence in `public`, and postgres's default privileges hand a new
 *      one nothing.
 *
 * WHY THIS EXISTS
 * Five core tables shipped with no RLS and stayed that way for 47 migrations
 * with nothing to signal it (SECURITY-REVIEW-1-DATABASE.md C1). Migration review
 * had already failed once, so the check must read the CATALOG, not the tree.
 *
 * WHY EACH CLAUSE
 * Clause 1 alone is not enough, and this repo proves both gaps:
 *   - the check_ins breach ran with rowsecurity = true the entire time
 *     (TECHNICAL-DEBT.md); a rowsecurity-only gate reports green on it. Hence
 *     clause 2.
 *   - daily_logs_full was owner-rights in source and had been silently fixed
 *     out-of-band in prod; nothing in the tree would ever have said so. Hence
 *     clause 3, which also catches the next view someone adds without it.
 * Clauses 4 and 5 hold the shape docs/DATA-ACCESS-LOCKDOWN-PLAN.md reached:
 * this app's entire data path is service_role — every query, function call
 * and storage call is `supabaseAdmin`'s, and a session client calls `auth.*`
 * alone (`lib/session-client-ownership.test.ts`) — so a policy or a public-
 * role grant governs no app read and is a door only the browser-shipped
 * public key can open. 55 unused write rules survived for months because the
 * gate judged each policy's shape and never asked whether it should exist
 * (clause 4); the stock GRANT ALL to `anon` and `authenticated` on 42 tables
 * left RLS as their only perimeter (clause 5). Both allowlists end empty and
 * are meant to stay so; a name added to one needs a caller other than the
 * service role, proven, beside it.
 *
 * WHY IT READS A DUMP
 * PostgREST exposes `public` only and cannot reach pg_catalog, so a REST query
 * is impossible without adding an RPC (more attack surface for a dev tool). No
 * DATABASE_URL / DB password exists in this repo either. `supabase db dump`
 * uses the existing `--linked` credentials and needs neither, so it is the one
 * mechanism that actually works here. It also covers the `storage` schema, which
 * a public-only check would miss -- and storage is exactly where the
 * unauthenticated progress-photos hole lived (migration 126).
 *
 * Requires the Supabase CLI to be linked (`npx supabase link`).
 */
import "./env-bootstrap";

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

type Failure = { clause: string; detail: string };

function dumpSchema(schema: string, outFile: string): string {
  execFileSync(
    "npx",
    ["supabase", "db", "dump", "--linked", "--schema", schema, "-f", outFile],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  return readFileSync(outFile, "utf8");
}

/** Tables created in the dump, by schema-qualified name. */
export function createdTables(sql: string, schema: string): Set<string> {
  const re = new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?"${schema}"\\."([a-z0-9_]+)"`, "g");
  return new Set([...sql.matchAll(re)].map((m) => m[1]));
}

/** Tables with RLS switched on. */
export function rlsEnabled(sql: string, schema: string): Set<string> {
  const re = new RegExp(
    `ALTER TABLE (?:ONLY )?"${schema}"\\."([a-z0-9_]+)" ENABLE ROW LEVEL SECURITY`,
    "g",
  );
  return new Set([...sql.matchAll(re)].map((m) => m[1]));
}

/**
 * Policies whose qual is trivially true AND which are granted to authenticated
 * or to PUBLIC (a policy with no TO clause defaults to PUBLIC, which includes
 * anon -- that is exactly how the progress-photos hole was written).
 */
export function permissivePolicies(sql: string, schema: string): string[] {
  const hits: string[] = [];

  for (const { name, table, body } of parsePolicies(sql, schema)) {
    const toAuthenticated = /\bTO "authenticated"/.test(body);
    const toPublic = !/\bTO "/.test(body); // no TO clause => PUBLIC => includes anon
    if (!toAuthenticated && !toPublic) continue;

    // USING (true) / WITH CHECK (true), tolerating pg_dump's extra parens.
    if (/(USING|WITH CHECK)\s*\(+\s*true\s*\)+/i.test(body)) {
      hits.push(`${schema}.${table} -> "${name}"`);
    }
  }
  return hits;
}

/**
 * Policies reachable by `anon` -- i.e. by anyone holding the browser-shipped
 * publishable key, with no login at all.
 *
 * A policy with NO `TO` clause defaults to PUBLIC, which includes anon. That is
 * a DIFFERENT failure from a trivially-true qual and the trivially-true check
 * does not catch it: the progress-photos hole (migration 126) was scoped
 * `USING (bucket_id = 'progress-photos')` -- a perfectly ordinary-looking
 * predicate -- and was catastrophic purely because it had no TO clause. This
 * clause exists because the first version of this gate would have missed the
 * exact bug it was written after.
 *
 * Deliberately strict: this app's entire data path is service_role, so no
 * policy should ever be anon-reachable. If one legitimately must be, name it in
 * ANON_REACHABLE_ALLOWLIST with a comment.
 */
const ANON_REACHABLE_ALLOWLIST = new Set<string>([
  // e.g. 'public.activity_suggestions -> "activity_suggestions_select"'
]);

export function anonReachablePolicies(sql: string, schema: string): string[] {
  const hits: string[] = [];

  for (const { name, table, body } of parsePolicies(sql, schema)) {
    const hasToClause = /\bTO "/.test(body);
    const namesAnon = /\bTO "anon"|\bTO "public"|,\s*"anon"/.test(body);
    if (hasToClause && !namesAnon) continue;

    // A no-TO-clause policy whose qual keys on auth.uid() still FAILS CLOSED for
    // anon, because auth.uid() is NULL when there is no JWT and the predicate
    // cannot match. Roughly 100 policies in this schema were that shape and
    // they were fine; flagging them would bury the real signal and the gate
    // would be ignored within a day. What is actually dangerous is an
    // anon-reachable policy whose qual never references the caller at all --
    // exactly the progress-photos shape, USING (bucket_id = '...'), true for
    // everyone.
    if (/auth"?\."?uid"?\s*\(\)/.test(body)) continue;

    const id = `${schema}.${table} -> "${name}"`;
    if (!ANON_REACHABLE_ALLOWLIST.has(id)) hits.push(id);
  }
  return hits;
}

/**
 * Clause 4: every policy in the schema, whatever its shape. The database
 * holds none (migration 201): every app read and write is the service role's,
 * which bypasses RLS, so a policy grants access that nothing in the app needs
 * and that the browser-shipped public key can use directly. A policy that a
 * proven non-service_role caller needs is named here, with that caller beside
 * it; the list ends empty and is meant to stay so.
 */
const POLICY_ALLOWLIST = new Set<string>([
  // e.g. 'public.some_table -> "some_policy"' — who calls it, and why the service role cannot
]);

export function policies(sql: string, schema: string, allowlist: Set<string> = POLICY_ALLOWLIST): string[] {
  return parsePolicies(sql, schema)
    .map(({ name, table }) => `${schema}.${table} -> "${name}"`)
    .filter((id) => !allowlist.has(id));
}

/**
 * Clause 5: every privilege `anon`, `authenticated` or PUBLIC holds on a
 * table, view or sequence in the schema, and every default privilege of the
 * role the migrations create tables as (postgres) that would hand a new one to
 * them. Supabase's stock defaults gave ALL on every new table to both roles
 * (probed on `client_phases` and `check_in_forms`, 2026-09-02), which left RLS
 * as the only perimeter on 42 tables; migration 201 revoked the grants and the
 * defaults. Nothing in the app reads as either role, so a grant here is a door
 * only the public key can open. Same allowlist contract as clause 4.
 *
 * pg_dump writes each grant as one statement per grantee and privilege set:
 *   GRANT ALL ON TABLE "public"."clients" TO "anon";
 *   GRANT SELECT ON TABLE "public"."client_measurements" TO "authenticated";
 *   GRANT SELECT("email") ON TABLE "public"."coaches" TO PUBLIC;
 *   GRANT ALL ON SEQUENCE "public"."things_id_seq" TO "anon";
 *   ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
 * A view is a TABLE to pg_dump. Functions are not relations: SECURITY DEFINER
 * functions are held to service_role by migration 201's closing check, not
 * here. supabase_admin's own defaults in `public` are not ours to change and
 * govern nothing a migration creates, so only postgres's are judged.
 */
const PUBLIC_ROLE_GRANT_ALLOWLIST = new Set<string>([
  // e.g. 'public.some_table -> anon: SELECT' — who reads it as anon, and why the service role cannot
]);

const PUBLIC_ROLES = `(PUBLIC|"anon"|"authenticated")`;

export function publicRoleGrants(
  sql: string,
  schema: string,
  allowlist: Set<string> = PUBLIC_ROLE_GRANT_ALLOWLIST,
): string[] {
  const hits: string[] = [];

  const grant = new RegExp(
    `^GRANT ([^\\n]+?) ON (?:TABLE|SEQUENCE) "${schema}"\\."([a-z0-9_]+)" TO ${PUBLIC_ROLES};`,
    "gm",
  );
  for (const [, privileges, relation, grantee] of sql.matchAll(grant)) {
    hits.push(`${schema}.${relation} -> ${grantee.replace(/"/g, "")}: ${privileges}`);
  }

  const defaults = new RegExp(
    `^ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "${schema}" GRANT ([^\\n]+?) ON (TABLES|SEQUENCES) TO ${PUBLIC_ROLES};`,
    "gm",
  );
  for (const [, privileges, kind, grantee] of sql.matchAll(defaults)) {
    hits.push(`${schema} default ${kind} -> ${grantee.replace(/"/g, "")}: ${privileges}`);
  }

  return hits.filter((id) => !allowlist.has(id));
}

/**
 * The grants the dump holds for the service role on the schema's tables and
 * views. Clause 5 is only as good as its reading of the dump: a dump that
 * stopped carrying privileges, or spelled them differently, would leave the
 * clause silently blind, so the gate refuses to pass when this reads zero.
 */
export function serviceRoleGrants(sql: string, schema: string): number {
  const re = new RegExp(`^GRANT [^\\n]+? ON TABLE "${schema}"\\."[a-z0-9_]+" TO "service_role";`, "gm");
  return [...sql.matchAll(re)].length;
}

function parsePolicies(
  sql: string,
  schema: string,
): Array<{ name: string; table: string; body: string }> {
  const re = new RegExp(
    `CREATE POLICY "([^"]+)" ON "${schema}"\\."([a-z0-9_]+)"([^;]*);`,
    "g",
  );
  return [...sql.matchAll(re)].map((m) => ({
    name: m[1],
    table: m[2],
    body: m[3],
  }));
}

/** Views missing the security_invoker reloption. */
export function viewsWithoutInvoker(sql: string, schema: string): string[] {
  const re = new RegExp(
    `CREATE (?:OR REPLACE )?VIEW "${schema}"\\."([a-z0-9_]+)"([^\\n]*)`,
    "g",
  );
  // pg_dump writes the reloption as WITH ("security_invoker"='on') -- the
  // identifier is double-quoted and the value single-quoted, so both quote
  // styles have to be optional here. Getting this wrong makes the clause report
  // a false violation on a correctly-configured view (it did, first run).
  return [...sql.matchAll(re)]
    .filter(([, , tail]) => !/["']?security_invoker["']?\s*=\s*["']?on/i.test(tail))
    .map(([, view]) => `${schema}.${view}`);
}

function main(): void {
  const dir = mkdtempSync(join(tmpdir(), "assert-rls-"));
  const failures: Failure[] = [];
  let policyCount = 0;
  let grantCount = 0;

  try {
    const publicSql = dumpSchema("public", join(dir, "public.sql"));
    const storageSql = dumpSchema("storage", join(dir, "storage.sql"));

    // --- Clause 1: RLS on every public table -------------------------------
    const tables = createdTables(publicSql, "public");
    const enabled = rlsEnabled(publicSql, "public");
    const bare = [...tables].filter((t) => !enabled.has(t)).sort();

    if (tables.size === 0) {
      failures.push({
        clause: "sanity",
        detail: "parsed zero tables from the public dump — the parser or the dump format changed",
      });
    }
    for (const t of bare) {
      failures.push({ clause: "1 (RLS enabled)", detail: `public.${t} has no RLS` });
    }

    // --- Clause 2: no trivially-true policy for authenticated/PUBLIC -------
    for (const schema of ["public", "storage"] as const) {
      const sql = schema === "public" ? publicSql : storageSql;
      for (const hit of permissivePolicies(sql, schema)) {
        failures.push({ clause: "2 (permissive policy)", detail: `${hit} is USING/WITH CHECK (true)` });
      }
      // --- Clause 2b: nothing reachable by anon at all --------------------
      for (const hit of anonReachablePolicies(sql, schema)) {
        failures.push({
          clause: "2b (anon-reachable)",
          detail: `${hit} has no TO clause (defaults to PUBLIC, which includes anon)`,
        });
      }
    }

    // --- Clause 3: every view is security_invoker --------------------------
    for (const schema of ["public", "storage"] as const) {
      const sql = schema === "public" ? publicSql : storageSql;
      for (const view of viewsWithoutInvoker(sql, schema)) {
        failures.push({ clause: "3 (view security_invoker)", detail: `${view} is owner-rights` });
      }
    }

    // --- Clause 4: no policy at all ----------------------------------------
    for (const schema of ["public", "storage"] as const) {
      const sql = schema === "public" ? publicSql : storageSql;
      const hits = policies(sql, schema);
      policyCount += hits.length;
      for (const hit of hits) {
        failures.push({
          clause: "4 (no policy)",
          detail: `${hit} exists — no app read or write runs under a database rule; drop it, or name its non-service_role caller in POLICY_ALLOWLIST`,
        });
      }
    }

    // --- Clause 5: no public-role privilege on a public relation -----------
    const grants = publicRoleGrants(publicSql, "public");
    grantCount = grants.length;
    for (const hit of grants) {
      failures.push({
        clause: "5 (public-role privilege)",
        detail: `${hit} — anon and authenticated hold nothing in public; revoke it, or name its caller in PUBLIC_ROLE_GRANT_ALLOWLIST`,
      });
    }
    if (serviceRoleGrants(publicSql, "public") === 0) {
      failures.push({
        clause: "sanity",
        detail: "parsed zero service_role grants from the public dump — clause 5 cannot see privileges; the parser or the dump format changed",
      });
    }

    console.info(
      `Checked ${tables.size} public tables, ${enabled.size} with RLS; ${policyCount} policies and ${grantCount} public-role grants found.`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(`\nFAILED — ${failures.length} schema-security violation(s):\n`);
    for (const f of failures) console.error(`  [clause ${f.clause}] ${f.detail}`);
    console.error(
      "\nFix with a migration. Do NOT patch this in the Supabase Studio SQL editor —" +
        "\nout-of-band changes drift from the tree and are how two of these bugs happened.",
    );
    process.exit(1);
  }

  console.info("OK — all schema-security invariants hold.");
}

// Only run when invoked directly, so the parsers above can be unit-tested
// without the test suite shelling out to the database.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
