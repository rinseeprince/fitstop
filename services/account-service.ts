import { auth } from "@/lib/auth";
import { RESET_PASSWORD_PAGE } from "@/lib/constants";
import { supabaseAdmin } from "@/services/supabase-admin";

/**
 * A login's address (docs/BETTER-AUTH-PLAN.md 2.10): coaches.email and
 * clients.email copy it, and migration 210's trigger rewrites both in the one
 * UPDATE of better_auth."user" that changes it, whoever changes it. Here: the
 * check lib/auth.ts makes of a change of email's new address, and the owner's
 * move of a login to a new address (scripts/move-email.ts), which changes it
 * through Better Auth's own adapter so Better Auth stays the writer of its
 * tables.
 */

/** Which rows of one address's holders the reads return: the login each points at, or none. */
type Holder = { user_id: string | null };

/**
 * The coach rows and the client rows that hold an address, by the login each
 * points at. Two reads, at once, each on an index of its email column; a coach
 * row's address is its own (UNIQUE), a client row's may be shared by the
 * coaches of one person. Throws when a read fails.
 */
async function rowsHolding(address: string): Promise<{ coaches: Holder[]; clients: Holder[] }> {
  const [coaches, clients] = await Promise.all([
    supabaseAdmin.from("coaches").select("user_id").eq("email", address),
    supabaseAdmin.from("clients").select("user_id").eq("email", address),
  ]);
  if (coaches.error) throw new Error(`Failed to read the coach rows holding the address: ${coaches.error.message}`);
  if (clients.error) throw new Error(`Failed to read the client rows holding the address: ${clients.error.message}`);
  return { coaches: coaches.data, clients: clients.data };
}

/**
 * Whether a coach row or a client row of another login, or of no login, holds
 * the address a login asks to change to (rule 17). The asker's own rows count
 * for nothing either way: Better Auth refuses the address they have before it
 * asks. Throws when a row cannot be read, so a fault refuses rather than
 * guesses.
 */
export async function isAddressHeldElsewhere(address: string, userId: string): Promise<boolean> {
  const { coaches, clients } = await rowsHolding(address);
  return [...coaches, ...clients].some((row) => row.user_id !== userId);
}

/** What holds an address the owner's command was asked to move a login to. */
type AddressHolder = "a login" | "a coach row" | "a client row";

export type MoveLoginEmailResult =
  | { moved: true; userId: string; sessionsEnded: number }
  | { moved: false; refusal: "no_login" }
  | { moved: false; refusal: "in_use"; heldBy: AddressHolder };

/** A move whose address changed, with its rows, and whose next step failed: the message says what finishes it. */
export class MovedLoginUnfinishedError extends Error {
  constructor(to: string, what: string, cause: unknown) {
    super(
      `The login moved to ${to} with its coach and client rows, but ${what}: ${cause instanceof Error ? cause.message : String(cause)}. A password reset from "Forgot your password?" at ${to} ends every session of it.`,
      { cause }
    );
    this.name = "MovedLoginUnfinishedError";
  }
}

/**
 * The owner's auth:move-email (rule 19, D39): the login on `email` moves to
 * `to`, for someone who has lost their sign-in inbox. Both addresses arrive
 * lower-cased, as every login and copy is stored. Refused, with nothing
 * changed: an address with no login, and a new one that any login, coach row
 * or client row holds. Then, through Better Auth's adapter: the login's
 * address changes, verified, in one UPDATE that moves its coach and client
 * rows with it (migration 210); every session of the login ends; and "Reset
 * your password" is asked for at the new address, which Better Auth sends in
 * the background (a script awaits backgroundWorkSettled, lib/auth.ts).
 *
 * The three are not one transaction (CONVENTIONS §2 item 13). A move that
 * fails changes nothing. A failure after it throws saying the address has
 * moved, and a password reset from "Forgot your password?" at the new
 * address finishes the job: Better Auth ends every session of a login whose
 * password it resets.
 */
export async function moveLoginEmail({ email, to }: { email: string; to: string }): Promise<MoveLoginEmailResult> {
  const { internalAdapter } = await auth.$context;
  const [login, holder, { coaches, clients }] = await Promise.all([
    internalAdapter.findUserByEmail(email),
    internalAdapter.findUserByEmail(to),
    rowsHolding(to),
  ]);
  if (!login) return { moved: false, refusal: "no_login" };
  const heldBy: AddressHolder | null = holder ? "a login" : coaches.length > 0 ? "a coach row" : clients.length > 0 ? "a client row" : null;
  if (heldBy) return { moved: false, refusal: "in_use", heldBy };

  const userId = login.user.id;
  await internalAdapter.updateUser(userId, { email: to, emailVerified: true });

  let sessionsEnded: number;
  try {
    sessionsEnded = (await internalAdapter.listSessions(userId)).length;
    await internalAdapter.deleteUserSessions(userId);
  } catch (error) {
    throw new MovedLoginUnfinishedError(to, "its sessions could not be ended", error);
  }
  try {
    await auth.api.requestPasswordReset({ body: { email: to, redirectTo: RESET_PASSWORD_PAGE } });
  } catch (error) {
    throw new MovedLoginUnfinishedError(to, `"Reset your password" could not be asked for`, error);
  }
  return { moved: true, userId, sessionsEnded };
}
