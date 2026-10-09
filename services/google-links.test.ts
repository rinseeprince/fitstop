import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Migration 213 (docs/BETTER-AUTH-PLAN.md 2.1, after commit 7), read as
 * written: a login's Google links go in the UPDATE that changes its address,
 * and one Google account links to one login. What the database does with it
 * is scripts/email-follows-proof.ts's to show on DEV; this holds the file to
 * its shape, so an edit that deletes a password row or another login's link,
 * opens the function to a role, loosens the key or weakens its closing check
 * fails here first.
 */
const MIGRATION = readFileSync(join(process.cwd(), "supabase/migrations/213_google_links.sql"), "utf8");

/** The SQL with its comments taken out, so a statement is matched only where it runs. */
const SQL = MIGRATION.replace(/--[^\n]*/g, "");

/** The function's body, between its dollar quotes. */
const BODY = /CREATE OR REPLACE FUNCTION better_auth\.follow_login_email\(\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/.exec(SQL)?.[1] ?? "";

/** The closing check: the last DO block. */
const CLOSING_CHECK = SQL.slice(SQL.lastIndexOf("DO $$"));

const squash = (sql: string) => sql.replace(/\s+/g, " ").trim();

describe("migration 213: a login's Google links go with its address, and one Google account links to one login", () => {
  it("is pure ASCII, as every migration the old CLI reads must be", () => {
    expect(/[^\p{ASCII}]/u.test(MIGRATION)).toBe(false);
  });

  it("copies the new address to the login's coach row and client row, and deletes every account row of the login but its password", () => {
    const statements = squash(BODY).split(";").map((statement) => statement.trim()).filter(Boolean);
    expect(statements).toEqual([
      "BEGIN UPDATE public.coaches SET email = NEW.email WHERE user_id = NEW.id AND email IS DISTINCT FROM NEW.email",
      "UPDATE public.clients SET email = NEW.email WHERE user_id = NEW.id AND email IS DISTINCT FROM NEW.email",
      `DELETE FROM better_auth.account WHERE "userId" = NEW.id AND "providerId" <> 'credential'`,
      "RETURN NULL",
      "END",
    ]);
  });

  it("runs as its owner whoever updates the login, its search_path pinned", () => {
    expect(squash(SQL)).toContain(
      "CREATE OR REPLACE FUNCTION better_auth.follow_login_email() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, better_auth AS $$"
    );
  });

  it("grants the function to no role: PUBLIC, anon, authenticated and service_role lose it, and nothing is granted", () => {
    expect(squash(SQL)).toContain("REVOKE ALL ON FUNCTION better_auth.follow_login_email() FROM PUBLIC, anon, authenticated, service_role;");
    expect(SQL).not.toMatch(/\bGRANT\b/i);
  });

  it("is what the trigger runs, inside the UPDATE that changes a login's address and never one that leaves it, and the old function goes once nothing runs it", () => {
    const sql = squash(SQL);
    expect(sql).toContain('DROP TRIGGER IF EXISTS login_email_follows ON better_auth."user";');
    const trigger =
      'CREATE TRIGGER login_email_follows AFTER UPDATE OF email ON better_auth."user" FOR EACH ROW WHEN (OLD.email IS DISTINCT FROM NEW.email) EXECUTE FUNCTION better_auth.follow_login_email();';
    const dropOld = "DROP FUNCTION IF EXISTS better_auth.copy_login_email();";
    expect(sql).toContain(trigger);
    expect(sql).toContain(dropOld);
    expect(sql.indexOf(dropOld)).toBeGreaterThan(sql.indexOf(trigger));
  });

  it("keys better_auth.account on the provider and the provider's account id: one Google account, one login", () => {
    expect(squash(SQL)).toContain('CREATE UNIQUE INDEX IF NOT EXISTS account_provider_id_account_id_key ON better_auth.account ("providerId", "accountId");');
  });

  it("names both writers of better_auth in the schema's comment: the trigger, and migration 211's delete_coach_records", () => {
    const comment = /COMMENT ON SCHEMA better_auth IS '((?:[^']|'')*)';/.exec(squash(SQL))?.[1];
    expect(comment).toContain(
      "by the trigger login_email_follows (migrations 210 and 213), which copies a login''s new address to its coach and client rows and deletes its Google links,"
    );
    expect(comment).toContain("and by migration 211''s public.delete_coach_records, which deletes a deleted coach''s clients'' logins.");
  });

  it("closes by raising unless the trigger, the function, the key and the schema's privileges are as written", () => {
    const check = squash(CLOSING_CHECK);
    // The trigger, by its catalog row: AFTER UPDATE, once per row, on the email column alone, with its condition, running the new function.
    for (const clause of [
      "t.tgrelid = 'better_auth.\"user\"'::regclass",
      "t.tgname = 'login_email_follows'",
      "t.tgenabled = 'O'",
      "t.tgtype = 17",
      "t.tgfoid = 'better_auth.follow_login_email()'::regprocedure",
      "cardinality(t.tgattr::int2[]) = 1",
      "a.attname = 'email'",
      "t.tgqual IS NOT NULL",
    ]) {
      expect(check).toContain(clause);
    }
    expect(check).toContain("RAISE EXCEPTION 'Migration 213: trigger login_email_follows is not on better_auth.\"user\" as written'");
    expect(check).toContain("IF to_regprocedure('better_auth.copy_login_email()') IS NOT NULL THEN RAISE EXCEPTION");
    // The function: SECURITY DEFINER, postgres's, a pinned search_path.
    for (const clause of ["p.oid = 'better_auth.follow_login_email()'::regprocedure", "p.prosecdef", "p.proowner = 'postgres'::regrole", "setting LIKE 'search_path=%'"]) {
      expect(check).toContain(clause);
    }
    expect(check).toContain(
      "RAISE EXCEPTION 'Migration 213: better_auth.follow_login_email() is not SECURITY DEFINER, owned by postgres, with its search_path pinned';"
    );
    // The key: unique and valid, on "providerId" then "accountId" alone, with no condition and no expression.
    for (const clause of [
      "i.indexrelid = 'better_auth.account_provider_id_account_id_key'::regclass",
      "i.indisunique",
      "i.indisvalid",
      "i.indpred IS NULL",
      "i.indexprs IS NULL",
      "i.indnatts = 2",
      "i.indkey[0] = (SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = 'better_auth.account'::regclass AND a.attname = 'providerId')",
      "i.indkey[1] = (SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = 'better_auth.account'::regclass AND a.attname = 'accountId')",
    ]) {
      expect(check).toContain(clause);
    }
    expect(check).toContain(
      `RAISE EXCEPTION 'Migration 213: better_auth.account_provider_id_account_id_key is not a valid unique key on ("providerId", "accountId")';`
    );
    // No privilege in better_auth for any role but the owner: a NULL function ACL read as the default it stands for.
    for (const clause of [
      "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
      "p.pronamespace = 'better_auth'::regnamespace AND a.grantee <> p.proowner",
      "c.relnamespace = 'better_auth'::regnamespace AND a.grantee <> c.relowner",
      "n.nspname = 'better_auth' AND a.grantee <> n.nspowner",
    ]) {
      expect(check).toContain(clause);
    }
    expect(check).toContain("RAISE EXCEPTION 'Migration 213: a role other than the owner holds a privilege in better_auth: %', found;");
  });
});
