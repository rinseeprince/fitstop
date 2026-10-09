import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Migration 211 (docs/BETTER-AUTH-PLAN.md 2.1 and 2.6, D2, D20, D21), read as
 * written: a deleted account's records go in one statement per role. What the
 * database does with it is scripts/delete-account-proof.ts's to show on DEV;
 * this holds the file to its shape, so an edit that deletes the coach before
 * the clients, deletes another coach's login, deletes the caller's own login,
 * or opens a function to a role fails here first.
 */
const MIGRATION = readFileSync(join(process.cwd(), "supabase/migrations/211_delete_account_functions.sql"), "utf8");

/** The SQL with its comments taken out, so a statement is matched only where it runs. */
const SQL = MIGRATION.replace(/--[^\n]*/g, "");

const squash = (sql: string) => sql.replace(/\s+/g, " ").trim();

/** A function's body, between its dollar quotes, as its statements. */
function statementsOf(name: string): string[] {
  const body = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(p_user_id uuid\\)[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`).exec(SQL)?.[1] ?? "";
  return squash(body)
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

describe("migration 211: a deleted account's records", () => {
  it("is pure ASCII, as every migration the old CLI reads must be", () => {
    expect(/[^\p{ASCII}]/u.test(MIGRATION)).toBe(false);
  });

  it("a client's: the client rows the login signs in as, whose keys cascade everything under them, and never the login itself", () => {
    expect(statementsOf("delete_client_records")).toEqual([
      "DECLARE n integer",
      "BEGIN DELETE FROM public.clients WHERE user_id = p_user_id",
      "GET DIAGNOSTICS n = ROW_COUNT",
      "RETURN n",
      "END",
    ]);
  });

  it("a coach's: the clients' logins, then the clients in a statement of their own, then the coach row, and never the coach's own login", () => {
    const statements = statementsOf("delete_coach_records");
    expect(statements).toEqual([
      "DECLARE n integer",
      'BEGIN DELETE FROM better_auth."user" u USING public.clients cl JOIN public.coaches c ON c.id = cl.coach_id WHERE c.user_id = p_user_id AND cl.user_id = u.id AND NOT EXISTS (SELECT 1 FROM public.coaches oc WHERE oc.user_id = u.id) AND NOT EXISTS (SELECT 1 FROM public.clients other WHERE other.user_id = u.id AND other.coach_id <> c.id)',
      "DELETE FROM public.clients WHERE coach_id IN (SELECT c.id FROM public.coaches c WHERE c.user_id = p_user_id)",
      "DELETE FROM public.coaches WHERE user_id = p_user_id",
      "GET DIAGNOSTICS n = ROW_COUNT",
      "RETURN n",
      "END",
    ]);
  });

  it.each([
    ["delete_client_records", "public"],
    ["delete_coach_records", "public, better_auth"],
  ])("%s runs as its owner whoever calls it, its search_path pinned", (name, searchPath) => {
    expect(squash(SQL)).toContain(
      `CREATE OR REPLACE FUNCTION public.${name}(p_user_id uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = ${searchPath} AS $$`
    );
  });

  it("is executable by service_role alone: PUBLIC, anon and authenticated lose it, and nothing else is granted", () => {
    const sql = squash(SQL);
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.delete_client_records(uuid), public.delete_coach_records(uuid) FROM PUBLIC, anon, authenticated;"
    );
    expect(sql.match(/\bGRANT\b[^;]*;/gi)).toEqual([
      "GRANT EXECUTE ON FUNCTION public.delete_client_records(uuid), public.delete_coach_records(uuid) TO service_role;",
    ]);
  });

  it("names the coach function in the better_auth schema's comment, beside migration 210's trigger", () => {
    expect(squash(SQL)).toMatch(/COMMENT ON SCHEMA better_auth IS '[^;]*migration 210''s trigger[^;]*migration 211''s public\.delete_coach_records/);
  });

  it("closes by checking both functions are postgres's, SECURITY DEFINER with a pinned search_path, and executable by service_role alone", () => {
    const check = SQL.slice(SQL.lastIndexOf("DO $$"));
    expect(check).toContain("'public.delete_client_records(uuid)'::regprocedure");
    expect(check).toContain("'public.delete_coach_records(uuid)'::regprocedure");
    for (const clause of [
      "p.prosecdef",
      "p.proowner = 'postgres'::regrole",
      "setting LIKE 'search_path=%'",
      "a.grantee <> 'service_role'::regrole::oid",
      "has_function_privilege('service_role', fn, 'EXECUTE')",
    ]) {
      expect(check).toContain(clause);
    }
    expect(check.match(/RAISE EXCEPTION/g)).toHaveLength(3);
  });
});

/**
 * Migration 212, read as written: an index led by every foreign key column a
 * deleted account's cascades walk, which had none on DEV. Without them each
 * deleted row's key lookup scanned the whole linked table, and a coach with
 * twenty clients took longer than the Data API lets a statement run.
 */
const INDEXES = readFileSync(join(process.cwd(), "supabase/migrations/212_delete_account_key_indexes.sql"), "utf8");
const INDEX_SQL = squash(INDEXES.replace(/--[^\n]*/g, ""));

describe("migration 212: an index on every key a deleted account's cascades walk", () => {
  it("is pure ASCII", () => {
    expect(/[^\p{ASCII}]/u.test(INDEXES)).toBe(false);
  });

  it.each([
    ["attention_dismissals", "client_id"],
    ["check_in_exercise_highlights", "exercise_id"],
    ["check_in_form_questions", "question_id"],
    ["check_in_reminders", "check_in_id"],
    ["client_notes", "coach_id"],
    ["coach_client_views", "client_id"],
    ["content_assignments", "assigned_by"],
    ["exercise_logs", "exercise_id"],
    ["exercise_logs", "training_exercise_id"],
    ["nutrition_logs", "nutrition_plan_id"],
    ["nutrition_plan_kept_goals", "kept_by"],
    ["nutrition_plans", "coach_id"],
    ["training_events", "session_log_id"],
    ["training_events", "training_session_id"],
    ["training_plans", "coach_id"],
    ["training_plans", "saved_plan_id"],
  ])("indexes %s.%s, led by the column", (table, column) => {
    expect(INDEX_SQL).toContain(`CREATE INDEX IF NOT EXISTS idx_${table}_${column} ON public.${table} (${column});`);
  });

  it("creates those sixteen indexes, and no table, function, grant or drop", () => {
    expect(INDEX_SQL.match(/CREATE INDEX/g)).toHaveLength(16);
    expect(INDEX_SQL).not.toMatch(/\b(DROP|ALTER|GRANT|REVOKE|CREATE (OR REPLACE )?FUNCTION|CREATE TABLE)\b/);
  });

  it("closes by checking every foreign key into a table a coach's deletion reaches has an index led by its column", () => {
    const check = INDEX_SQL.slice(INDEX_SQL.lastIndexOf("DO $$"));
    for (const clause of [
      "WITH RECURSIVE reach(tbl) AS ( SELECT 'public.coaches'::regclass",
      "WHERE c.contype = 'f' AND c.confdeltype = 'c'",
      "c.confrelid IN (SELECT tbl FROM reach)",
      "NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1])",
      "RAISE EXCEPTION",
    ]) {
      expect(check).toContain(clause);
    }
  });
});
