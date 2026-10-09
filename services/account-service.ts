import { auth } from "@/lib/auth";
import { RESET_PASSWORD_PAGE } from "@/lib/constants";
import { captureApiError } from "@/lib/error-handler";
import { chunkIds, fetchAllPages } from "@/lib/paged-fetch";
import { CONTENT_BUCKET } from "@/services/content-storage-service";
import { listObjects, PROGRESS_PHOTOS_BUCKET, removeObjects, type StorageBucket } from "@/services/storage-service";
import { supabaseAdmin } from "@/services/supabase-admin";
import type { UserRole } from "@/types/auth";

/**
 * A login's address (docs/BETTER-AUTH-PLAN.md 2.10): coaches.email and
 * clients.email copy it, and the trigger login_email_follows rewrites both,
 * and unlinks the login's Google accounts (migrations 210 and 213), in the one
 * UPDATE of better_auth."user" that changes it, whoever changes it. Here: the
 * check lib/auth.ts makes of a change of email's new address, and the owner's
 * move of a login to a new address (scripts/move-email.ts), which changes it
 * through Better Auth's own adapter so Better Auth stays the writer of its
 * tables. And a deleted account's records (2.6): Better Auth's beforeDelete.
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
 * rows with it and unlinks every Google account linked to it (migrations 210
 * and 213), so the lost or taken inbox's Google account no longer signs it
 * in; every session of the login ends; and "Reset your password" is asked for
 * at the new address, which Better Auth sends in the background (a script
 * awaits backgroundWorkSettled, lib/auth.ts).
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

/**
 * The app's role of a login (profiles.role, written with the login by
 * services/login-service.ts), or null for a login with no profile. Throws when
 * the profile can't be read.
 */
export async function readLoginRole(userId: string): Promise<UserRole | null> {
  const { data, error } = await supabaseAdmin.from("profiles").select("role").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`Failed to read the login's role: ${error.message}`);
  return data?.role === "trainer" || data?.role === "client" ? data.role : null;
}

/** How many client folders are listed at once for a coach's deletion: one listing request per client, a few in flight. */
const FOLDERS_AT_ONCE = 8;

/**
 * Every progress photo in the folders of these clients. The upload writes a
 * client's photos into their own folder (`<clientId>/<file>`), so the folder
 * holds every photo of theirs, one no check-in names among them (an upload
 * whose check-in was then refused); and nothing a check-in carries is read,
 * since it may be any string its client sent (lib/validations/check-in.ts).
 */
async function photoKeysOf(clientIds: string[]): Promise<string[]> {
  const keys: string[] = [];
  for (const batch of chunkIds(clientIds, FOLDERS_AT_ONCE)) {
    const listed = await Promise.all(batch.map((clientId) => listObjects(PROGRESS_PHOTOS_BUCKET, clientId)));
    keys.push(...listed.flat());
  }
  return keys;
}

/** The client rows a login signs in as, or a coach's clients, read whole past PostgREST's row cap. */
async function clientIdsWhere(column: "user_id" | "coach_id", value: string): Promise<string[]> {
  const rows = await fetchAllPages<{ id: string }>(
    (from, to) => supabaseAdmin.from("clients").select("id").eq(column, value).order("id").range(from, to),
    { errorLabel: "the account's client rows" }
  );
  return rows.map((row) => row.id);
}

/** The coach row a login signs in as, or null. */
async function coachIdOf(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from("coaches").select("id").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`Failed to read the coach row: ${error.message}`);
  return data?.id ?? null;
}

/**
 * Better Auth's beforeDelete (docs/BETTER-AUTH-PLAN.md 2.6, D20, D21): what
 * the app holds about a login goes before Better Auth deletes the login, which
 * takes its sessions, its password and its profile.
 * - A client: every object in their photo folder, then the audit rows about
 *   or by them, their client rows and everything under them
 *   (delete_client_records, migrations 211 and 214).
 * - A coach: every object in each of their clients' photo folders and in
 *   their own content library folder (`<coachId>/…`, each file under its
 *   item's folder), then the audit rows about or by their clients and by the
 *   coach, their clients' logins, their clients and everything
 *   under them, and the coach row with the coach's library
 *   (delete_coach_records). Only the account's own folders are listed, so no
 *   other account's object is ever named.
 * - A login with no role holds nothing of the app's: Better Auth deletes it
 *   alone.
 * Objects first, rows second: a failure before the function leaves every row,
 * and the objects not yet removed, as they were; a failure of the function
 * after the objects went leaves every row. Either way it reaches Sentry with
 * the keys that went and throws, Better Auth refuses the deletion, and a new
 * request from Settings finishes it (a key whose object is gone is no
 * failure).
 */
export async function deleteAccountRecords(user: { id: string }): Promise<void> {
  const removed: Partial<Record<StorageBucket, string[]>> = {};
  const remove = async (bucket: StorageBucket, keys: string[]) => {
    await removeObjects(bucket, keys);
    removed[bucket] = keys;
  };
  try {
    const role = await readLoginRole(user.id);
    if (role === "client") {
      await remove(PROGRESS_PHOTOS_BUCKET, await photoKeysOf(await clientIdsWhere("user_id", user.id)));
      const { error } = await supabaseAdmin.rpc("delete_client_records", { p_user_id: user.id });
      if (error) throw new Error(`delete_client_records failed: ${error.message}`);
    } else if (role === "trainer") {
      const coachId = await coachIdOf(user.id);
      if (coachId) {
        const [photoKeys, contentKeys] = await Promise.all([
          clientIdsWhere("coach_id", coachId).then(photoKeysOf),
          listObjects(CONTENT_BUCKET, coachId),
        ]);
        await remove(PROGRESS_PHOTOS_BUCKET, photoKeys);
        await remove(CONTENT_BUCKET, contentKeys);
      }
      const { error } = await supabaseAdmin.rpc("delete_coach_records", { p_user_id: user.id });
      if (error) throw new Error(`delete_coach_records failed: ${error.message}`);
    }
  } catch (error) {
    captureApiError(error, { source: "deleteAccountRecords: the account is not deleted", userId: user.id, removed });
    throw error;
  }
}
