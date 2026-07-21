/**
 * Schema-security gate. Asserts three invariants against the LIVE database and
 * exits non-zero on any violation.
 *
 *   npx tsx scripts/assert-rls.ts          (or: npm run check:rls)
 *
 *   1. Every table in `public` has RLS enabled.
 *   2. No policy grants `authenticated` or PUBLIC a trivially-true qual.
 *   3. Every view in `public` and `storage` is security_invoker.
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
    // cannot match. Roughly 100 policies in this schema are that shape and they
    // are fine; flagging them would bury the real signal and the gate would be
    // ignored within a day. What is actually dangerous is an anon-reachable
    // policy whose qual never references the caller at all -- exactly the
    // progress-photos shape, USING (bucket_id = '...'), true for everyone.
    if (/auth"?\."?uid"?\s*\(\)/.test(body)) continue;

    const id = `${schema}.${table} -> "${name}"`;
    if (!ANON_REACHABLE_ALLOWLIST.has(id)) hits.push(id);
  }
  return hits;
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

    console.info(
      `Checked ${tables.size} public tables, ${enabled.size} with RLS.`,
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
