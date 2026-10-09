import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Migration 215 (docs/BETTER-AUTH-PLAN.md 2.1 and 2.12, D40), read as written:
 * an invitation's state is its dates. What the database does with it is the
 * push's own closing check and scripts/invitation-proof.ts's to show on DEV;
 * this holds the file to its shape, so an edit that drops the column before
 * its refusal, takes anything else with it, or skips its closing check fails
 * here first.
 */
const MIGRATION = readFileSync(join(process.cwd(), "supabase/migrations/215_invitation_dates_decide.sql"), "utf8");

/** The SQL with its comments taken out, so a statement is matched only where it runs. */
const SQL = MIGRATION.replace(/--[^\n]*/g, "");
const squash = (sql: string) => sql.replace(/\s+/g, " ").trim();
const STATEMENTS = squash(SQL);

describe("migration 215: an invitation is its dates", () => {
  it("is pure ASCII, as every migration the old CLI reads must be", () => {
    expect(/[^\p{ASCII}]/u.test(MIGRATION)).toBe(false);
  });

  it("refuses, before the drop, an accepted invitation with no accepted_at, whose link the drop would make live again", () => {
    const refusal = STATEMENTS.indexOf(
      "IF EXISTS (SELECT 1 FROM public.client_invitations WHERE status = 'accepted' AND accepted_at IS NULL) THEN RAISE EXCEPTION"
    );
    const drop = STATEMENTS.indexOf("ALTER TABLE public.client_invitations DROP COLUMN");
    expect(refusal).toBeGreaterThan(-1);
    expect(drop).toBeGreaterThan(refusal);
  });

  it("drops the status column alone, with what is its own (its CHECK, its default, its index), and nothing else", () => {
    expect(STATEMENTS.match(/ALTER TABLE[^;]*;/g)).toEqual(["ALTER TABLE public.client_invitations DROP COLUMN IF EXISTS status;"]);
    expect(STATEMENTS).not.toMatch(/\bCASCADE\b/i);
    expect(STATEMENTS).not.toMatch(/\bDROP (TABLE|INDEX|CONSTRAINT|POLICY|FUNCTION|TRIGGER)\b/i);
  });

  it("changes no privilege and adds no policy", () => {
    expect(STATEMENTS).not.toMatch(/\b(GRANT|REVOKE|CREATE POLICY)\b/i);
  });

  it("says on the table what each date means, and where the account is", () => {
    expect(STATEMENTS).toContain(
      "COMMENT ON TABLE public.client_invitations IS 'One invitation per client, written only once its email has gone: invited_at when, expires_at until when its link works, accepted_at when it was used. Whether the client has an account is clients.user_id.';"
    );
  });

  it("closes by checking the column and its index are gone and the UNIQUE (client_id) key the send's upsert names is valid", () => {
    const check = STATEMENTS.slice(STATEMENTS.indexOf("COMMENT ON TABLE"));
    expect(check).toMatch(/a\.attname = 'status' AND NOT a\.attisdropped \) THEN RAISE EXCEPTION/);
    expect(check).toMatch(/IF to_regclass\('public\.idx_client_invitations_status'\) IS NOT NULL THEN RAISE EXCEPTION/);
    expect(check).toMatch(/c\.contype = 'u' AND c\.convalidated AND i\.indisvalid AND c\.conkey = ARRAY\[\(SELECT a\.attnum FROM pg_attribute a WHERE a\.attrelid = 'public\.client_invitations'::regclass AND a\.attname = 'client_id'\)\]::int2\[\] \) THEN RAISE EXCEPTION/);
  });

  it("is re-runnable: the refusal reads status only while the column is there", () => {
    expect(STATEMENTS).toMatch(
      /IF EXISTS \( SELECT 1 FROM information_schema\.columns WHERE table_schema = 'public' AND table_name = 'client_invitations' AND column_name = 'status' \) THEN IF EXISTS \(SELECT 1 FROM public\.client_invitations WHERE status = 'accepted'/
    );
  });
});
