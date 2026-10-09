/**
 * The owner's command that moves a login to a new address, for someone who
 * has lost their sign-in inbox and can neither approve a change of email nor
 * get a reset link (docs/BETTER-AUTH-PLAN.md 2.10, rule 19, D39):
 *
 *   npm run auth:move-email -- --project <ref> --email <current> --to <new>
 *
 * The owner confirms who is asking first; there is no recovery email. The
 * login moves to the new address everywhere at once (its coach and client rows
 * with it, migration 210), every session of it ends, and "Reset your password"
 * goes to the new address (moveLoginEmail, services/account-service.ts). An
 * address with no login, and a new one that any login, coach row or client
 * row holds, are refused with nothing changed. It runs only when --project,
 * the linked project, DATABASE_URL and NEXT_PUBLIC_SUPABASE_URL all name one
 * project (scripts/project-ref.ts), and on any project but DEV only when the
 * link it emails opens an https address: both refusals come before anything
 * that reaches a database loads. Reads .env.local; a variable already set in
 * the environment wins.
 */
import "./env-bootstrap";

import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { RESET_PASSWORD_PAGE } from "@/lib/constants";
import type { MoveLoginEmailResult } from "@/services/account-service";
import { DEV_REF, projectEnv, refuseLocalLink, refuseUnlessProject, type ProjectEnv } from "./project-ref";

const USAGE = "Usage: npm run auth:move-email -- --project <ref> --email <current> --to <new>";

export type MoveToMake = { project: string; email: string; to: string };

const ADDRESS = z.string().email();

/**
 * The command's three flags, each required and none blank; any other flag or
 * a stray word is refused with the usage. Both addresses are lower-cased, as
 * Better Auth stores them, and each must be one; they must differ.
 */
export function parseMoveEmailArgs(argv: string[]): MoveToMake {
  let values: { project?: string; email?: string; to?: string };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { project: { type: "string" }, email: { type: "string" }, to: { type: "string" } },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
  }
  const project = values.project?.trim() ?? "";
  const email = values.email?.trim().toLowerCase() ?? "";
  const to = values.to?.trim().toLowerCase() ?? "";
  if (!project || !email || !to) throw new Error(USAGE);
  for (const address of [email, to]) {
    if (!ADDRESS.safeParse(address).success) throw new Error(`Refused: ${address} is not an email address. Nothing was read or written.`);
  }
  if (email === to) throw new Error(`Refused: --email and --to name the same address. Nothing was read or written.`);
  return { project, email, to };
}

/**
 * The command, from npm's arguments. A run the project guard or the link's
 * address refuses is refused before anything that reaches a database loads;
 * every refusal throws the sentence the command prints.
 */
export async function moveEmail(argv: string[], readEnv: () => ProjectEnv = projectEnv): Promise<void> {
  const move = parseMoveEmailArgs(argv);
  refuseUnlessProject(move.project, readEnv());
  refuseLocalLink(move.project, process.env.BETTER_AUTH_URL, "the moved login");

  // Loaded only once the project is the one meant: lib/auth starts Better
  // Auth, whose pool reaches the database.
  const { authPool, backgroundWorkSettled } = await import("@/lib/auth");
  const { moveLoginEmail } = await import("@/services/account-service");

  let result: MoveLoginEmailResult;
  try {
    result = await moveLoginEmail({ email: move.email, to: move.to });
  } finally {
    // The reset email goes out in the background (lib/auth.ts), and nothing
    // but this wait keeps a script alive for it.
    await backgroundWorkSettled();
    await authPool.end();
  }

  if (!result.moved) {
    throw new Error(
      result.refusal === "no_login"
        ? `Refused: ${move.email} has no login. Nothing was changed.`
        : `Refused: ${move.to} is in use: ${result.heldBy} holds it. Nothing was changed.`
    );
  }

  const landing = new URL(RESET_PASSWORD_PAGE, process.env.BETTER_AUTH_URL).href;
  console.info(`Moved the login of ${move.email} to ${move.to} (user id ${result.userId}), its coach and client rows with it.`);
  console.info(`Ended ${result.sessionsEnded} session(s): every device it was signed in on is signed out.`);
  console.info(`"Reset your password" sent to ${move.to}. Its link lasts one hour and lands on ${landing}.`);
  // A failed send is never thrown (forgot password answers every address
  // alike), so the command cannot know the email arrived: it says where the
  // link can be had instead.
  console.info(
    move.project === DEV_REF
      ? `If it doesn't arrive: npm run auth:last-link -- --email ${move.to}`
      : `If it doesn't arrive, they can click "Forgot your password?" on the sign-in page.`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  moveEmail(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
