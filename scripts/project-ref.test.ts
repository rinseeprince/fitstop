import { describe, it, expect } from "vitest";
import { DEV_REF, refuseUnlessProject, type ProjectEnv } from "./project-ref";

/**
 * The guard on the owner's commands (docs/BETTER-AUTH-PLAN.md 2.3): a run acts
 * on a project only when the flag, the Supabase CLI's link and both connection
 * strings name it. The env below is each source as this machine holds it:
 * the pooler string as the dashboard gives it, the Supabase URL, and the link
 * file with its trailing newline.
 */
const PROD_REF = "etezzztgafcotyahgijk";

const poolerUrl = (ref: string) => `postgresql://postgres.${ref}:pa%40ss@aws-0-eu-west-2.pooler.supabase.com:6543/postgres`;
const supabaseUrl = (ref: string) => `https://${ref}.supabase.co`;

const envOf = (ref: string): ProjectEnv => ({ linkedRef: `${ref}\n`, databaseUrl: poolerUrl(ref), supabaseUrl: supabaseUrl(ref) });

describe("refuseUnlessProject", () => {
  it("lets a run through when the flag, the link and both connection strings name one project", () => {
    expect(() => refuseUnlessProject(DEV_REF, envOf(DEV_REF))).not.toThrow();
    expect(() => refuseUnlessProject(PROD_REF, envOf(PROD_REF))).not.toThrow();
  });

  it("refuses production's ref against DEV's env, naming every source that disagrees", () => {
    expect(() => refuseUnlessProject(PROD_REF, envOf(DEV_REF))).toThrow(
      `Refused: this run is for project ${PROD_REF}, but the linked project (supabase/.temp/project-ref) names ${DEV_REF}, DATABASE_URL names ${DEV_REF}, NEXT_PUBLIC_SUPABASE_URL names ${DEV_REF}. Nothing was read or written.`
    );
  });

  it.each([
    ["the linked project", { linkedRef: PROD_REF }, "the linked project (supabase/.temp/project-ref) names"],
    ["DATABASE_URL", { databaseUrl: poolerUrl(PROD_REF) }, "DATABASE_URL names"],
    ["NEXT_PUBLIC_SUPABASE_URL", { supabaseUrl: supabaseUrl(PROD_REF) }, "NEXT_PUBLIC_SUPABASE_URL names"],
  ])("refuses when %s alone names another project", (_label, other, sentence) => {
    expect(() => refuseUnlessProject(DEV_REF, { ...envOf(DEV_REF), ...other })).toThrow(`${sentence} ${PROD_REF}`);
  });

  it.each([
    ["no linked project", { linkedRef: "" }],
    ["a direct connection string, which names its project in the host, not the pooler's user", { databaseUrl: `postgresql://postgres:x@db.${DEV_REF}.supabase.co:5432/postgres` }],
    ["a database user that only ends like the ref", { databaseUrl: `postgresql://xpostgres.${DEV_REF}:x@aws-0-eu-west-2.pooler.supabase.com:6543/postgres` }],
    ["a Supabase URL on another domain", { supabaseUrl: `https://${DEV_REF}.supabase.co.example.com` }],
  ])("refuses %s: it names no project", (_label, other) => {
    expect(() => refuseUnlessProject(DEV_REF, { ...envOf(DEV_REF), ...other })).toThrow(/^Refused: .* names no project/);
  });

  it("refuses a run that names no project at all", () => {
    expect(() => refuseUnlessProject("", envOf(DEV_REF))).toThrow("Refused: no project named. Name it with --project <ref>.");
    expect(() => refuseUnlessProject("", { linkedRef: "", databaseUrl: "postgresql://u:p@h:1/d", supabaseUrl: "https://example.com" })).toThrow(
      "Refused: no project named."
    );
  });

  it("never quotes DATABASE_URL, password and all, in its refusal", () => {
    expect(() => refuseUnlessProject(DEV_REF, { ...envOf(DEV_REF), databaseUrl: poolerUrl(PROD_REF) })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("pa%40ss") })
    );
    expect(() => refuseUnlessProject(DEV_REF, { ...envOf(DEV_REF), databaseUrl: "not a url with a s3cret" })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("s3cret") })
    );
  });
});
