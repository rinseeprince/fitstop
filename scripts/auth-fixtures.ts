/**
 * Throwaway logins for the proof and seed scripts (docs/BETTER-AUTH-PLAN.md
 * section 6, commit 3), made the two ways the app makes a login (D9) and never
 * through Supabase:
 *   - a coach through createCoachLogin, the owner's command, then a password
 *     set from the "Set your password" link it asked for, as the coach sets it;
 *   - a client through acceptClientInvitation, the invite, from a pending
 *     invitation of a client row the script already made, as the client
 *     accepts it.
 * So a throwaway's profile, coach row and client link are written by the code
 * that writes a real one.
 *
 * deleteThrowawayLogin removes one: the app's rows that point at the login
 * first (its coach row, which takes that coach's clients with it, and its
 * profile), then the login and any password link it holds, through Better
 * Auth's own connection; the login takes its sessions and its password with
 * it. A client row the login signed in as is the script's own to delete: its
 * key goes back to null (migration 209).
 *
 * Both refuse an address outside the throwaway domains, a client's login is
 * made only for a client row on that same address with no login yet, and
 * deleting refuses the perf fixture's own two logins, so no slip in a script
 * reaches a real person's login or client. Both refuse unless the Supabase URL
 * and DATABASE_URL name one project, never production (assertOneProject). No
 * email leaves the machine: Resend is pointed at a closed port before anything
 * that sends one loads, and making a login is refused if the email client was
 * built before that.
 */
import { auth, authPool, backgroundWorkSettled } from "@/lib/auth";
import { supabaseAdmin } from "@/services/supabase-admin";
import { PERF_CLIENT_EMAIL, PERF_COACH_EMAIL } from "./perf-fixtures";
import { assertOneProject } from "./proof-session";
import { NO_EMAIL } from "./proof-server";
import { SEED_EMAIL_DOMAIN } from "./seed/ids";

process.env.RESEND_BASE_URL = NO_EMAIL;

/** Where every throwaway address lives: the proofs' domain and the scale seed's. */
const THROWAWAY_DOMAINS = ["fixture.local", SEED_EMAIL_DOMAIN];
/** The perf fixture's own logins: on a throwaway domain, and never a script's to delete. */
const KEPT_LOGINS = new Set([PERF_CLIENT_EMAIL, PERF_COACH_EMAIL]);
/** The prefix Better Auth 1.7.7 gives a password link's token in better_auth.verification. */
const PASSWORD_LINK = "reset-password:";
/** A throwaway's invitation is accepted at once: an hour is room enough. */
const INVITE_VALID_MS = 60 * 60 * 1000;

export type ThrowawayLoginInput =
  | { role: "coach"; email: string; password: string; name: string }
  | {
      role: "client";
      email: string;
      password: string;
      /** The client row the login signs in as: the script's own, with no login yet. */
      clientId: string;
      /** The token of a pending invitation the script already wrote for the client; without one the fixture invites the client itself. */
      inviteToken?: string;
    };

export type ThrowawayLogin = { userId: string; email: string; coachId: string | null; clientId: string | null };

/** The address, lower-cased, when it is on a throwaway domain; else a refusal. */
function throwawayAddress(email: string): string {
  const address = email.trim().toLowerCase();
  const domain = address.slice(address.lastIndexOf("@") + 1);
  if (!THROWAWAY_DOMAINS.includes(domain)) {
    throw new Error(`Refused: ${address} is not a throwaway address (@${THROWAWAY_DOMAINS.join(", @")}).`);
  }
  return address;
}

/** Refuses when the email client was built before this module pointed Resend at the closed port. */
async function assertNoEmailLeaves(): Promise<void> {
  const { resend } = await import("@/services/email-service");
  if (resend.baseUrl !== NO_EMAIL) {
    throw new Error("Refused: services/email-service loaded before scripts/auth-fixtures, so an email would leave the machine. Import auth-fixtures first.");
  }
}

/** The id of the login with this address, or null. */
export async function loginIdFor(email: string): Promise<string | null> {
  const { rows } = await authPool.query<{ id: string }>(`SELECT id FROM better_auth."user" WHERE email = lower($1)`, [email]);
  return rows[0]?.id ?? null;
}

/** Every login on one throwaway domain, by address: the scale seed's teardown sweeps its own with it. */
export async function loginsOnDomain(domain: string): Promise<string[]> {
  if (!THROWAWAY_DOMAINS.includes(domain)) throw new Error(`Refused: @${domain} is not a throwaway domain.`);
  const { rows } = await authPool.query<{ email: string }>(`SELECT email FROM better_auth."user" WHERE email LIKE $1 ORDER BY email`, [`%@${domain}`]);
  return rows.map((row) => row.email);
}

/** The newest live password-link token Better Auth wrote for a login, as its email would carry it. */
export async function passwordLinkToken(userId: string): Promise<string> {
  const { rows } = await authPool.query<{ identifier: string }>(
    `SELECT identifier FROM better_auth.verification
      WHERE value = $1 AND identifier LIKE $2 AND "expiresAt" > now()
      ORDER BY "createdAt" DESC LIMIT 1`,
    [userId, `${PASSWORD_LINK}%`]
  );
  if (!rows[0]) throw new Error("No live password link for the login");
  return rows[0].identifier.slice(PASSWORD_LINK.length);
}

/**
 * A throwaway login with a password, made through the app's own path for its
 * role, on an address that has none yet. Any failure deletes what it made
 * before the error is thrown.
 */
export async function createThrowawayLogin(login: ThrowawayLoginInput): Promise<ThrowawayLogin> {
  const email = throwawayAddress(login.email);
  assertOneProject();
  if (await loginIdFor(email)) throw new Error(`Refused: ${email} already has a login.`);
  await assertNoEmailLeaves();
  try {
    return login.role === "coach" ? await makeCoach(email, login.name, login.password) : await makeClient(email, login);
  } catch (error) {
    // The address had no login when this began, so whatever is there is this call's.
    await removeLogin(email);
    throw error;
  } finally {
    // createCoachLogin's link email runs on outside a request: it goes nowhere,
    // but it settles before the caller moves on.
    await backgroundWorkSettled();
  }
}

async function makeCoach(email: string, name: string, password: string): Promise<ThrowawayLogin> {
  const { createCoachLogin } = await import("@/services/login-service");
  const userId = await createCoachLogin({ email, name });
  await auth.api.resetPassword({ body: { newPassword: password, token: await passwordLinkToken(userId) } });
  const { data: coach, error } = await supabaseAdmin.from("coaches").select("id").eq("user_id", userId).single();
  if (error || !coach) throw new Error(`No coach row for ${email}: ${error?.message}`);
  return { userId, email, coachId: coach.id, clientId: null };
}

async function makeClient(email: string, login: Extract<ThrowawayLoginInput, { role: "client" }>): Promise<ThrowawayLogin> {
  // Only a throwaway client: the row the script made on this very address,
  // with no login yet, and an invitation of that row to that address.
  const { data: client, error } = await supabaseAdmin.from("clients").select("email, user_id").eq("id", login.clientId).maybeSingle();
  if (error) throw new Error(`client read: ${error.message}`);
  if (client?.email?.toLowerCase() !== email || client.user_id !== null) {
    throw new Error(`Refused: client ${login.clientId} is not a throwaway client on ${email} with no login.`);
  }
  if (login.inviteToken) {
    const { data: invitation, error: invitationError } = await supabaseAdmin
      .from("client_invitations")
      .select("client_id, email")
      .eq("token", login.inviteToken)
      .maybeSingle();
    if (invitationError) throw new Error(`invitation read: ${invitationError.message}`);
    if (invitation?.client_id !== login.clientId || invitation.email.toLowerCase() !== email) {
      throw new Error(`Refused: the invitation given for ${email} is not that client's on that address.`);
    }
  }
  const token = login.inviteToken ?? (await inviteClient(login.clientId, email));
  const { acceptClientInvitation } = await import("@/services/login-service");
  const accepted = await acceptClientInvitation({ token, password: login.password });
  if (!accepted.accepted) throw new Error(`The invite for ${email} was refused: ${accepted.refusal}`);
  if (accepted.clientId !== login.clientId || (await loginIdFor(email)) !== accepted.userId) {
    await removeLoginById(accepted.userId, email);
    throw new Error(`The invite made a login for another client or address than ${email}'s; it was deleted`);
  }
  return { userId: accepted.userId, email, coachId: null, clientId: accepted.clientId };
}

/** A pending invitation of the client, as the coach's invite writes one; returns the token its link carries. */
async function inviteClient(clientId: string, email: string): Promise<string> {
  const { generateInviteToken } = await import("@/services/email-service");
  const token = generateInviteToken();
  const { error } = await supabaseAdmin.from("client_invitations").insert({
    client_id: clientId,
    email,
    token,
    status: "sent",
    invited_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + INVITE_VALID_MS).toISOString(),
  });
  if (error) throw new Error(`invitation insert: ${error.message}`);
  return token;
}

/**
 * Deletes a throwaway login and the app's rows that point at it. Returns
 * whether there was one; throws when anything of it is left.
 */
export async function deleteThrowawayLogin(email: string): Promise<boolean> {
  const address = throwawayAddress(email);
  if (KEPT_LOGINS.has(address)) throw new Error(`Refused: ${address} is the perf fixture's own login.`);
  return removeLogin(address);
}

async function removeLogin(address: string): Promise<boolean> {
  const userId = await loginIdFor(address);
  if (!userId) return false;
  await removeLoginById(userId, address);
  return true;
}

/** Deletes one login and the app's rows that point at it; throws when anything of it is left. */
async function removeLoginById(userId: string, address: string): Promise<void> {
  assertOneProject();

  const coaches = await supabaseAdmin.from("coaches").delete().eq("user_id", userId);
  if (coaches.error) throw new Error(`coach row of ${address}: ${coaches.error.message}`);
  const profiles = await supabaseAdmin.from("profiles").delete().eq("user_id", userId);
  if (profiles.error) throw new Error(`profile of ${address}: ${profiles.error.message}`);
  await authPool.query(`DELETE FROM better_auth.verification WHERE value = $1`, [userId]);
  await authPool.query(`DELETE FROM better_auth."user" WHERE id = $1`, [userId]);

  const { rows } = await authPool.query<{ n: number }>(
    `SELECT (SELECT count(*) FROM better_auth."user" WHERE id = $1::uuid)
          + (SELECT count(*) FROM better_auth.session WHERE "userId" = $1::uuid)
          + (SELECT count(*) FROM better_auth.account WHERE "userId" = $1::uuid)
          + (SELECT count(*) FROM better_auth.verification WHERE value = $2)
          + (SELECT count(*) FROM public.profiles WHERE user_id = $1::uuid)
          + (SELECT count(*) FROM public.coaches WHERE user_id = $1::uuid) AS n`,
    [userId, userId]
  );
  if (Number(rows[0]?.n) !== 0) throw new Error(`${address}: ${rows[0]?.n} row(s) of the login are left`);
}
