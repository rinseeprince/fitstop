/**
 * Prints the newest live link Better Auth emailed an address, for an email
 * that can't be delivered (docs/BETTER-AUTH-PLAN.md rule 14). DEV only: it
 * refuses unless the linked project, DATABASE_URL and NEXT_PUBLIC_SUPABASE_URL
 * all name DEV (scripts/project-ref.ts), since what it prints opens the login.
 *
 *   npm run auth:last-link -- --email <address>
 *
 * Better Auth 1.7.7 keeps a row in better_auth.verification for each link it
 * emails, the row's identifier its kind and token, its value the login's id:
 *   - reset-password:<token>  the password link (api/routes/password.mjs),
 *                             landing on /set-password or /reset-password
 *   - delete-account-<token>  the delete-account confirmation
 *                             (api/routes/update-user.mjs), landing on
 *                             /login?deleted=1
 * Change email's two links carry a token Better Auth signs and never stores
 * (createEmailVerificationToken), so no row holds them and this prints
 * neither. A used link's row is gone, and an expired one is skipped.
 */
import "./env-bootstrap";

import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { ACCOUNT_DELETED_PAGE, RESET_PASSWORD_PAGE, SET_PASSWORD_PAGE } from "@/lib/constants";
import { DEV_REF, projectEnv, refuseUnlessProject, type ProjectEnv } from "./project-ref";

const USAGE = "Usage: npm run auth:last-link -- --email <address>";

/** Better Auth 1.7.7's identifier prefixes for the links it emails. */
const PASSWORD_LINK = "reset-password:";
const DELETE_LINK = "delete-account-";

/** A row of better_auth.verification, as Better Auth writes one. */
export type VerificationRow = { identifier: string; value: string; expiresAt: Date; createdAt: Date };

/** Where Better Auth answers (BETTER_AUTH_URL with /api/auth), and whether the login has a password yet. */
export type LinkContext = { authBaseURL: string; hasPassword: boolean };

export type EmailedLink = { url: string; landing: string; expiresAt: Date };

/**
 * The link an email carried for one of Better Auth's rows, built as Better
 * Auth builds it; null for a row that is no emailed link. A password link's
 * row records no landing: a login with no password yet is setting its first
 * (the owner's coach:create asked for /set-password), and one with a password
 * is resetting it (forgot password asks for /reset-password).
 */
export function emailedLink(row: VerificationRow, { authBaseURL, hasPassword }: LinkContext): EmailedLink | null {
  if (row.identifier.startsWith(PASSWORD_LINK)) {
    const token = row.identifier.slice(PASSWORD_LINK.length);
    const landing = hasPassword ? RESET_PASSWORD_PAGE : SET_PASSWORD_PAGE;
    return { url: `${authBaseURL}/reset-password/${token}?callbackURL=${encodeURIComponent(landing)}`, landing, expiresAt: row.expiresAt };
  }
  if (row.identifier.startsWith(DELETE_LINK)) {
    const token = row.identifier.slice(DELETE_LINK.length);
    return {
      url: `${authBaseURL}/delete-user/callback?token=${token}&callbackURL=${encodeURIComponent(ACCOUNT_DELETED_PAGE)}`,
      landing: ACCOUNT_DELETED_PAGE,
      expiresAt: row.expiresAt,
    };
  }
  return null;
}

/** The newest live link among the rows Better Auth keeps for one login, or null. */
export function newestLiveLink(rows: VerificationRow[], userId: string, now: Date, context: LinkContext): EmailedLink | null {
  const live = rows
    .filter((row) => row.value === userId && row.expiresAt > now)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  for (const row of live) {
    const link = emailedLink(row, context);
    if (link) return link;
  }
  return null;
}

/** The one flag, required and not blank; anything else is refused with the usage. */
export function parseAuthLastLinkArgs(argv: string[]): string {
  let email: string | undefined;
  try {
    ({ values: { email } } = parseArgs({ args: argv, options: { email: { type: "string" } }, strict: true, allowPositionals: false }));
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
  }
  const address = email?.trim().toLowerCase() ?? "";
  if (!address) throw new Error(USAGE);
  return address;
}

/**
 * The command, from npm's arguments. A run on any project but DEV is refused
 * before anything that reaches a database loads; every refusal, and a login
 * or link not found, throws the sentence the command prints.
 */
export async function printLastLink(argv: string[], readEnv: () => ProjectEnv = projectEnv): Promise<void> {
  const email = parseAuthLastLinkArgs(argv);
  refuseUnlessProject(DEV_REF, readEnv());

  // Loaded only once the project is DEV: lib/auth starts Better Auth, whose
  // pool reaches the database, and whose context says where it answers.
  const { auth, authPool } = await import("@/lib/auth");
  try {
    const { rows: logins } = await authPool.query<{ id: string; hasPassword: boolean }>(
      `SELECT u.id,
              EXISTS (SELECT 1 FROM better_auth.account a
                       WHERE a."userId" = u.id AND a."providerId" = 'credential' AND a.password IS NOT NULL) AS "hasPassword"
         FROM better_auth."user" u
        WHERE u.email = lower($1)`,
      [email]
    );
    const login = logins[0];
    if (!login) throw new Error(`No login for ${email} on DEV.`);
    const { rows } = await authPool.query<VerificationRow>(
      `SELECT identifier, value, "expiresAt", "createdAt" FROM better_auth.verification WHERE value = $1`,
      [login.id]
    );
    const { baseURL } = await auth.$context;
    const link = newestLiveLink(rows, login.id, new Date(), { authBaseURL: baseURL, hasPassword: login.hasPassword });
    if (!link) throw new Error(`No live link for ${email}: none was emailed, or the last one was used or has expired.`);
    console.info(`The newest live link for ${email}, landing on ${link.landing}, until ${link.expiresAt.toISOString()}:`);
    console.info(link.url);
  } finally {
    await authPool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  printLastLink(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
