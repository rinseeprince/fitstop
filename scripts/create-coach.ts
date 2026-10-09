/**
 * The owner's command that creates a coach (docs/BETTER-AUTH-PLAN.md 2.3,
 * rule 14):
 *
 *   npm run coach:create -- --project <ref> --email <address> --name "<name>"
 *
 * Makes the coach's login (verified, no password yet), their trainer profile
 * and their coach row through createCoachLogin, which asks Better Auth for the
 * "Set your password" link and its email (rule 9). It runs only when
 * --project, the linked project, DATABASE_URL and NEXT_PUBLIC_SUPABASE_URL
 * all name one project (scripts/project-ref.ts), so a run on production is a
 * deliberate flag and a deliberate env, never an accident, and on any project
 * but DEV only when the link it emails opens an https address. An address
 * that already has a login, a client's included, is refused and nothing is
 * written. Reads .env.local; a variable already set in the environment wins.
 */
import "./env-bootstrap";

import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { SET_PASSWORD_PAGE } from "@/lib/constants";
import { DEV_REF, projectEnv, refuseLocalLink, refuseUnlessProject, type ProjectEnv } from "./project-ref";

const USAGE = 'Usage: npm run coach:create -- --project <ref> --email <address> --name "<name>"';

export type CoachToCreate = { project: string; email: string; name: string };

/**
 * The command's three flags, each required and none blank; any other flag or
 * a stray word is refused with the usage. The address is lower-cased, as
 * Better Auth stores it.
 */
export function parseCreateCoachArgs(argv: string[]): CoachToCreate {
  let values: { project?: string; email?: string; name?: string };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { project: { type: "string" }, email: { type: "string" }, name: { type: "string" } },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
  }
  const project = values.project?.trim() ?? "";
  const email = values.email?.trim().toLowerCase() ?? "";
  const name = values.name?.trim() ?? "";
  if (!project || !email || !name) throw new Error(USAGE);
  return { project, email, name };
}

/**
 * The command, from npm's arguments. A run the project guard or the link's
 * address refuses is refused before anything that reaches a database loads;
 * every refusal throws the sentence the command prints.
 */
export async function createCoach(argv: string[], readEnv: () => ProjectEnv = projectEnv): Promise<void> {
  const coach = parseCreateCoachArgs(argv);
  refuseUnlessProject(coach.project, readEnv());
  refuseLocalLink(coach.project, process.env.BETTER_AUTH_URL, "a coach");

  // Loaded only once the project is the one meant: lib/auth starts Better
  // Auth, whose pool reaches the database.
  const { isAPIError } = await import("better-auth/api");
  const { authPool, backgroundWorkSettled } = await import("@/lib/auth");
  const { ADDRESS_TAKEN, createCoachLogin } = await import("@/services/login-service");

  let userId: string;
  try {
    userId = await createCoachLogin({ email: coach.email, name: coach.name });
  } catch (error) {
    if (isAPIError(error) && error.body?.code === ADDRESS_TAKEN) {
      throw new Error(`Refused: ${coach.email} already has a login. Nothing was written.`);
    }
    if (isAPIError(error) && error.statusCode < 500) throw new Error(`Refused: ${error.message}. Nothing was written.`);
    throw error;
  } finally {
    // The email goes out in the background (lib/auth.ts), and nothing but
    // this wait keeps a script alive for it.
    await backgroundWorkSettled();
    await authPool.end();
  }

  const landing = new URL(SET_PASSWORD_PAGE, process.env.BETTER_AUTH_URL).href;
  console.info(`Created ${coach.email} (user id ${userId}).`);
  console.info(`Set-your-password email sent to ${coach.email}. Its link lasts one hour and lands on ${landing}.`);
  // A failed send is never thrown (forgot password answers every address
  // alike), so the command cannot know the email arrived: it says where the
  // link can be had instead.
  console.info(
    coach.project === DEV_REF
      ? `If it doesn't arrive: npm run auth:last-link -- --email ${coach.email}`
      : `If it doesn't arrive, the coach can click "Forgot your password?" on the sign-in page.`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createCoach(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
