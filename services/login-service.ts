import { isAPIError } from "better-auth/api";
import { auth, authPool } from "@/lib/auth";
import { SET_PASSWORD_PAGE } from "@/lib/constants";
import { captureApiError } from "@/lib/error-handler";
import { supabaseAdmin } from "@/services/supabase-admin";
import { findLiveInvitation, INVITATION_REFUSALS } from "@/services/invitation-service";
import type { UserRole } from "@/types/auth";

/**
 * The two paths that make a login (D9), and the only writers of profiles and
 * of the login side of coaches and clients, but for a coach's email, which
 * follows the login's address once made (services/account-service.ts): the
 * owner's coach command (createCoachLogin) and the client invite
 * (acceptClientInvitation). Each
 * makes the login through the admin plugin's create-user, the one path
 * lib/auth.ts's guard lets make one, then writes the app's rows for it in the
 * same request, so the role comes from the path and nothing races to make a
 * row later.
 *
 * A login and its rows are two writes in two places (Better Auth owns its
 * insert, the app's rows go through supabaseAdmin), so no transaction spans
 * them (D10). When a write after the login fails, the login is deleted, which
 * takes everything written for it through migration 209's keys: the profile
 * and the sessions cascade, and the client's user_id is set back to null.
 */

/** The answer a refused invite gets, each with the sentence the invite page shows (rule 11). */
export const ACCEPT_REFUSALS = {
  ...INVITATION_REFUSALS,
  account_exists: "This email already has an account. Sign in instead.",
} as const;

export type AcceptRefusal = keyof typeof ACCEPT_REFUSALS;

type AcceptResult =
  | { accepted: true; userId: string; clientId: string; setCookies: string[] }
  | { accepted: false; refusal: AcceptRefusal };

/** The admin plugin's answer to an address that already has a login, at 1.7.7. */
export const ADDRESS_TAKEN = "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL";

/**
 * A coach's login, made by the owner's command: verified, with no password
 * until the coach sets one from the emailed link it asks Better Auth for (the
 * "Set your password" link, D17). Writes the trainer profile and the coach
 * row. Returns the login's id; an address that already has a login is refused
 * by Better Auth before anything is written. The email goes out in the
 * background: a script calling this awaits backgroundWorkSettled (lib/auth.ts)
 * before it exits.
 */
export async function createCoachLogin({ email, name }: { email: string; name: string }): Promise<string> {
  const { user } = await auth.api.createUser({ body: { email, name, data: { emailVerified: true } } });
  try {
    await insertProfile(user.id, "trainer");
    const { error } = await supabaseAdmin.from("coaches").insert({ user_id: user.id, name, email: user.email });
    if (error) throw new Error(`Failed to create the coach row: ${error.message}`);
    await auth.api.requestPasswordReset({ body: { email: user.email, redirectTo: SET_PASSWORD_PAGE } });
  } catch (error) {
    await undoLogin(user.id, error);
    throw error;
  }
  return user.id;
}

/**
 * A client's login, made from their invite in one request (D11): the token's
 * pending invitation is checked as the invite page checks it, the login is
 * made on the invited address with the password the client chose (verified:
 * the invite reached that address), the client profile and the client's link
 * are written, the client is signed in, and the invitation is marked accepted
 * last. The caller forwards `setCookies` to the browser. Nothing the request
 * carries but the token and the password decides whose login it is.
 */
export async function acceptClientInvitation({ token, password }: { token: string; password: string }): Promise<AcceptResult> {
  const found = await findLiveInvitation(token);
  if ("refusal" in found) return { accepted: false, refusal: found.refusal };
  const { invitation } = found;

  const startedAt = new Date();
  let userId: string;
  let email: string;
  try {
    const { user } = await auth.api.createUser({
      body: { email: invitation.email, name: invitation.clientName, password, data: { emailVerified: true } },
    });
    userId = user.id;
    email = user.email;
  } catch (error) {
    if (isAPIError(error) && error.body?.code === ADDRESS_TAKEN) return { accepted: false, refusal: "account_exists" };
    await undoHalfMadeLogin(invitation.email, startedAt, error);
    throw error;
  }

  try {
    await insertProfile(userId, "client");

    // Only a client with no login yet: an invitation never re-points a client
    // someone already signs in as.
    const { data: linked, error: linkError } = await supabaseAdmin
      .from("clients")
      .update({ user_id: userId })
      .eq("id", invitation.clientId)
      .is("user_id", null)
      .select("id");
    if (linkError) throw new Error(`Failed to link the client to the login: ${linkError.message}`);
    if (!linked?.length) {
      await undoLogin(userId, new Error("the client already has a login"));
      return { accepted: false, refusal: "used" };
    }

    const { headers } = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });

    // Last, and only while still pending: of two accepts racing on one
    // token, one marks it.
    const { data: marked, error: markError } = await supabaseAdmin
      .from("client_invitations")
      .update({ status: "accepted", accepted_at: new Date().toISOString() })
      .eq("id", invitation.id)
      .neq("status", "accepted")
      .select("id");
    if (markError) throw new Error(`Failed to mark the invitation accepted: ${markError.message}`);
    if (!marked?.length) {
      await undoLogin(userId, new Error("the invitation was accepted by another request"));
      return { accepted: false, refusal: "used" };
    }

    return { accepted: true, userId, clientId: invitation.clientId, setCookies: headers.getSetCookie() };
  } catch (error) {
    await undoLogin(userId, error);
    throw error;
  }
}

async function insertProfile(userId: string, role: UserRole): Promise<void> {
  const { error } = await supabaseAdmin.from("profiles").insert({ user_id: userId, role });
  if (error) throw new Error(`Failed to create the profile: ${error.message}`);
}

/**
 * Deletes a login this module made. The app's one write to schema
 * better_auth outside migrations (with undoHalfMadeLogin's), through Better
 * Auth's own connection: Better Auth's removeUser needs an admin's session.
 * A failure is reported with the id, and the caller's own error stands.
 */
async function undoLogin(userId: string, cause: unknown): Promise<void> {
  try {
    await authPool.query(`DELETE FROM better_auth."user" WHERE id = $1`, [userId]);
  } catch (error) {
    captureApiError(error, { source: "login-service: a login left without its rows", userId, cause: String(cause) });
  }
}

/**
 * At 1.7.7 the admin plugin's create-user writes the login and then its
 * password as two statements in no transaction, so one that throws may have
 * made a login with no password. That login, and only that one, is deleted: on
 * the invited address, made since this call began, holding no password. An
 * address that already had a login was refused before anything was written,
 * and a login that signs in is never touched.
 */
async function undoHalfMadeLogin(email: string, since: Date, cause: unknown): Promise<void> {
  try {
    await authPool.query(
      `DELETE FROM better_auth."user" u
        WHERE u.email = lower($1) AND u."createdAt" >= $2
          AND NOT EXISTS (SELECT 1 FROM better_auth.account a WHERE a."userId" = u.id AND a."providerId" = 'credential')`,
      [email, since]
    );
  } catch (error) {
    captureApiError(error, { source: "login-service: a half-made login left", cause: String(cause) });
  }
}
