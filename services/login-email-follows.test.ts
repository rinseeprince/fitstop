import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Migration 210 (docs/BETTER-AUTH-PLAN.md 2.1, D37), read as written: a
 * login's address and its two copies change in one UPDATE. What the database
 * does with it is scripts/email-follows-proof.ts's to show on DEV; this holds
 * the file to its shape, so an edit that drops a copy, opens the function to
 * a role or weakens its closing check fails here first.
 */
const MIGRATION = readFileSync(join(process.cwd(), "supabase/migrations/210_login_email_follows.sql"), "utf8");

/** The SQL with its comments taken out, so a statement is matched only where it runs. */
const SQL = MIGRATION.replace(/--[^\n]*/g, "");

/** The function's body, between its dollar quotes. */
const BODY = /CREATE OR REPLACE FUNCTION better_auth\.copy_login_email\(\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/.exec(SQL)?.[1] ?? "";

/** The closing check: the last DO block. */
const CLOSING_CHECK = SQL.slice(SQL.lastIndexOf("DO $$"));

const squash = (sql: string) => sql.replace(/\s+/g, " ").trim();

describe("migration 210: a login's address and its copies, one write", () => {
  it("is pure ASCII, as every migration the old CLI reads must be", () => {
    expect(/[^\p{ASCII}]/u.test(MIGRATION)).toBe(false);
  });

  it("copies the login's new address to its coach row and its client row, and only to the login's own rows", () => {
    const statements = squash(BODY).split(";").map((statement) => statement.trim()).filter(Boolean);
    expect(statements).toEqual([
      "BEGIN UPDATE public.coaches SET email = NEW.email WHERE user_id = NEW.id AND email IS DISTINCT FROM NEW.email",
      "UPDATE public.clients SET email = NEW.email WHERE user_id = NEW.id AND email IS DISTINCT FROM NEW.email",
      "RETURN NULL",
      "END",
    ]);
  });

  it("runs as its owner whoever updates the login, its search_path pinned", () => {
    expect(squash(SQL)).toContain(
      "CREATE OR REPLACE FUNCTION better_auth.copy_login_email() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, better_auth AS $$"
    );
  });

  it("grants the function to no role: PUBLIC, anon, authenticated and service_role lose it, and nothing is granted", () => {
    expect(squash(SQL)).toContain("REVOKE ALL ON FUNCTION better_auth.copy_login_email() FROM PUBLIC, anon, authenticated, service_role;");
    expect(SQL).not.toMatch(/\bGRANT\b/i);
  });

  it("fires inside the UPDATE that changes a login's address, once per row, and never for one that leaves it", () => {
    expect(squash(SQL)).toContain(
      'CREATE TRIGGER login_email_follows AFTER UPDATE OF email ON better_auth."user" FOR EACH ROW WHEN (OLD.email IS DISTINCT FROM NEW.email) EXECUTE FUNCTION better_auth.copy_login_email();'
    );
    expect(squash(SQL)).toContain('DROP TRIGGER IF EXISTS login_email_follows ON better_auth."user";');
  });

  it("names the trigger in the schema's comment, beside Better Auth's connection", () => {
    const comment = /COMMENT ON SCHEMA better_auth IS '((?:[^']|'')*)';/.exec(squash(SQL))?.[1];
    expect(comment).toContain(
      "Reached by Better Auth''s own connection, and by migration 210''s trigger, which copies a login''s address to its coach and client rows."
    );
  });

  it("closes by raising unless the trigger, the function and the schema's privileges are as written", () => {
    const check = squash(CLOSING_CHECK);
    // The trigger, by its catalog row: AFTER UPDATE, once per row, on the email column alone, with its condition.
    for (const clause of [
      "t.tgrelid = 'better_auth.\"user\"'::regclass",
      "t.tgname = 'login_email_follows'",
      "t.tgenabled = 'O'",
      "t.tgtype = 17",
      "t.tgfoid = 'better_auth.copy_login_email()'::regprocedure",
      "cardinality(t.tgattr::int2[]) = 1",
      "a.attname = 'email'",
      "t.tgqual IS NOT NULL",
    ]) {
      expect(check).toContain(clause);
    }
    expect(check).toContain("RAISE EXCEPTION 'Migration 210: trigger login_email_follows is not on better_auth.\"user\" as written'");
    // The function: SECURITY DEFINER, postgres's, a pinned search_path.
    for (const clause of ["p.prosecdef", "p.proowner = 'postgres'::regrole", "setting LIKE 'search_path=%'"]) {
      expect(check).toContain(clause);
    }
    // No privilege in better_auth for any role but the owner: a NULL function ACL read as the default it stands for.
    for (const clause of [
      "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
      "p.pronamespace = 'better_auth'::regnamespace AND a.grantee <> p.proowner",
      "c.relnamespace = 'better_auth'::regnamespace AND a.grantee <> c.relowner",
      "n.nspname = 'better_auth' AND a.grantee <> n.nspowner",
    ]) {
      expect(check).toContain(clause);
    }
    expect(check).toContain("RAISE EXCEPTION 'Migration 210: a role other than the owner holds a privilege in better_auth: %', found;");
  });
});
