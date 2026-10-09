/**
 * Which Supabase project an owner's command acts on (docs/BETTER-AUTH-PLAN.md
 * 2.3). A command reaches a project three ways: the Supabase CLI's linked
 * project (supabase/.temp/project-ref, what `npx supabase link` wrote),
 * DATABASE_URL (Better Auth's logins, through the pooler, whose user is
 * postgres.<ref>) and NEXT_PUBLIC_SUPABASE_URL (the app's rows, through
 * supabaseAdmin). The command names the project it means, and runs only when
 * all three name it too: a run on production is a deliberate flag and a
 * deliberate env, never one of them by accident. Off DEV, a command that
 * emails a link runs only when the link opens the deployed app.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDatabaseUrl } from "@/lib/supabase-connection";

/** DEV's project ref: the one project `npm run auth:last-link` reads (rule 14). */
export const DEV_REF = "aeaphsslctwcmebldrzx";

/** What a machine's Supabase CLI link and env name, as projectEnv reads them. */
export type ProjectEnv = { linkedRef: string; databaseUrl: string; supabaseUrl: string };

/** The ref a pooler string names, its user being postgres.<ref>; empty when it names none. */
function databaseRef(databaseUrl: string): string {
  return /^postgres\.([a-z0-9]+)$/.exec(parseDatabaseUrl(databaseUrl).username)?.[1] ?? "";
}

/** The ref a Supabase URL names, https://<ref>.supabase.co; empty when it names none. */
function supabaseRef(supabaseUrl: string): string {
  return /^([a-z0-9]+)\.supabase\.co$/.exec(new URL(supabaseUrl).hostname)?.[1] ?? "";
}

/**
 * Refuses, by throwing, unless the linked project, DATABASE_URL and
 * NEXT_PUBLIC_SUPABASE_URL all name `project`. A command calls it before it
 * loads anything that reaches a database.
 */
export function refuseUnlessProject(project: string, env: ProjectEnv): void {
  if (!project) throw new Error("Refused: no project named. Name it with --project <ref>.");
  const named: Array<[string, string]> = [
    ["the linked project (supabase/.temp/project-ref)", env.linkedRef.trim()],
    ["DATABASE_URL", databaseRef(env.databaseUrl)],
    ["NEXT_PUBLIC_SUPABASE_URL", supabaseRef(env.supabaseUrl)],
  ];
  const others = named.filter(([, ref]) => ref !== project);
  if (others.length > 0) {
    const disagreements = others.map(([source, ref]) => `${source} names ${ref || "no project"}`).join(", ");
    throw new Error(`Refused: this run is for project ${project}, but ${disagreements}. Nothing was read or written.`);
  }
}

/**
 * A link an owner's command emails opens BETTER_AUTH_URL's app: on DEV, next
 * dev on this machine; on any other project it must be the deployed app,
 * which is https. A production run left on .env.local's localhost address
 * would email a real person a link to the owner's own machine. `recipient`
 * names who is emailed, as the refusal says it ("a coach").
 */
export function refuseLocalLink(project: string, betterAuthUrl: string | undefined, recipient: string): void {
  if (project === DEV_REF) return;
  if (betterAuthUrl && URL.canParse(betterAuthUrl) && new URL(betterAuthUrl).protocol === "https:") return;
  throw new Error(
    `Refused: ${recipient} on ${project} is emailed a link to BETTER_AUTH_URL, ${betterAuthUrl || "which is unset"}, and it must be the app's https address. Set BETTER_AUTH_URL and NEXT_PUBLIC_APP_URL to it. Nothing was read or written.`
  );
}

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env.local`);
  return value;
}

/** The linked project and the two connection strings, as this machine holds them; no link reads as no project. */
export function projectEnv(): ProjectEnv {
  let linkedRef = "";
  try {
    linkedRef = readFileSync(join(__dirname, "..", "supabase", ".temp", "project-ref"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { linkedRef, databaseUrl: need("DATABASE_URL"), supabaseUrl: need("NEXT_PUBLIC_SUPABASE_URL") };
}
