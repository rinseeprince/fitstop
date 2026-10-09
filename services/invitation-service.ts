import { supabaseAdmin } from "@/services/supabase-admin"
import { sendInvitationEmail, generateInviteToken } from "@/services/email-service"
import type { InvitationDetails, InvitationOutcome, InvitationRead } from "@/types/auth"
import { maskEmail } from "@/lib/mask-email"
import { captureApiError } from "@/lib/error-handler"
import { getTodayDateStringInTimezone } from "@/lib/date-helpers"

const INVITATION_EXPIRY_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

const invitationsTable = "client_invitations"

/**
 * An invitation is its dates (migration 215, D40): a row exists only once its
 * email has gone, invited_at says when, expires_at until when its link works,
 * accepted_at that it was used. Whether the client has an account is
 * clients.user_id.
 */
type InvitationDates = { invited_at: string | null; expires_at: string | null; accepted_at: string | null }

/**
 * Whether an invitation's link still opens: never used, and its expiry ahead
 * or unset (a row written before invitations carried an expiry has none). The
 * one predicate the coach's Invite box, activation and the invite page judge a
 * link by.
 */
export function invitationLinkWorks(
  row: Pick<InvitationDates, "expires_at" | "accepted_at">,
  now: Date = new Date()
): boolean {
  return row.accepted_at === null && (row.expires_at === null || new Date(row.expires_at) > now)
}

/** A pending invitation a token opens: what accepting it needs. Server-side only. */
export type LiveInvitation = {
  id: string
  clientId: string
  /** The address the invitation went to, and the one the client's login is made with. */
  email: string
  clientName: string
  coachName: string
  expiresAt: string | null
}

/** Why a token opens no invitation, each with the sentence the invite page shows. */
export const INVITATION_REFUSALS = {
  invalid: "Invalid invitation link",
  expired: "This invitation has expired",
  used: "This invitation has already been used",
} as const

type InvitationRefusal = keyof typeof INVITATION_REFUSALS

/**
 * The pending invitation a token opens, or why it opens none: no invitation
 * holds the token, it was used, or it has expired. Throws when the read
 * fails, which is not a refusal.
 */
export async function findLiveInvitation(
  token: string
): Promise<{ invitation: LiveInvitation } | { refusal: InvitationRefusal }> {
  const { data, error } = await supabaseAdmin
    .from(invitationsTable)
    .select("id, client_id, email, accepted_at, expires_at, client:client_id ( name, coach:coach_id ( name ) )")
    .eq("token", token)
    .maybeSingle()

  if (error) throw new Error(`Failed to read the invitation: ${error.message}`)
  if (!data?.client?.coach) return { refusal: "invalid" }
  if (!invitationLinkWorks(data)) return { refusal: data.accepted_at ? "used" : "expired" }

  return {
    invitation: {
      id: data.id,
      clientId: data.client_id,
      email: data.email,
      clientName: data.client.name,
      coachName: data.client.coach.name,
      expiresAt: data.expires_at,
    },
  }
}

/**
 * What the invite page shows of the invitation a token opens (public, no auth
 * required): the coach's name and the invited address with its middle hidden
 * (D11). Neither the full address nor the client's name travels to whoever
 * holds the link.
 */
export async function getInvitationByToken(
  token: string
): Promise<{ success: boolean; invitation?: InvitationDetails; error?: string }> {
  try {
    const found = await findLiveInvitation(token)
    if ("refusal" in found) return { success: false, error: INVITATION_REFUSALS[found.refusal] }
    const { coachName, email, expiresAt } = found.invitation
    return { success: true, invitation: { coachName, emailMasked: maskEmail(email), expiresAt } }
  } catch (error) {
    console.error("Error fetching invitation by token:", error)
    return {
      success: false,
      error: "Failed to validate invitation"
    }
  }
}

/** The invitation as the coach's Invite box reads it: its dates as the coach's calendar days, never its token (D43). */
function toInvitationRead(
  row: InvitationDates | null,
  hasAccount: boolean,
  timeZone: string | null,
  now: Date
): InvitationRead {
  const day = (stamp: string | null) =>
    stamp ? getTodayDateStringInTimezone(timeZone ?? "UTC", new Date(stamp)) : null
  return {
    hasAccount,
    invitation: row
      ? { sentOn: day(row.invited_at), expiresOn: day(row.expires_at), linkWorks: invitationLinkWorks(row, now) }
      : null,
  }
}

/**
 * A client's invitation, for the coach's Invite box: whether the client has
 * an account (the caller's verified client row says), and the invitation's
 * dates on the coach's calendar. Throws when a read fails.
 */
export async function readInvitation(
  client: { id: string; coachId: string; hasAccount: boolean },
  now: Date = new Date()
): Promise<InvitationRead> {
  const [invitation, coach] = await Promise.all([
    supabaseAdmin
      .from(invitationsTable)
      .select("invited_at, expires_at, accepted_at")
      .eq("client_id", client.id)
      .maybeSingle(),
    supabaseAdmin.from("coaches").select("timezone").eq("id", client.coachId).maybeSingle(),
  ])
  if (invitation.error) throw new Error(`Failed to read the invitation: ${invitation.error.message}`)
  if (coach.error) throw new Error(`Failed to read the coach's timezone: ${coach.error.message}`)
  return toInvitationRead(invitation.data, client.hasAccount, coach.data?.timezone ?? null, now)
}

/**
 * Why a send wrote nothing, each with the plain sentence the coach reads
 * (rule 22): never the email service's own words, which go to Sentry.
 */
export const INVITATION_NOT_SENT = {
  not_found: "Client not found",
  has_account: "This client already has an account.",
  no_email: "This client has no email address.",
  email_failed: "The email couldn't be sent. Try again.",
  failed: "Something went wrong. Try again.",
} as const

export type InvitationNotSent = keyof typeof INVITATION_NOT_SENT

type SendInvitationResult =
  | { sent: true; invitation: InvitationRead }
  | { sent: false; reason: InvitationNotSent }

/**
 * Sends a client their invitation (D41): a new link, good for seven days,
 * emailed first, and the client's row written only once the email has gone,
 * in one upsert on its UNIQUE client_id (migration 022): the token, the
 * address, invited_at now, expires_at, accepted_at empty. A failed email
 * writes nothing, so the link the client already holds still opens. A row
 * written after a resend replaces the earlier link, which stops opening.
 *
 * A write that fails after the email went leaves an email whose link opens
 * nothing (CONVENTIONS §2, item 13): the coach reads "Invitation not sent" and
 * the next send works. The new link opens only once its row is written, in a
 * moment no email arrives inside. Should the client accept their earlier link
 * while a resend's email is in flight, the resend's row makes the new link an
 * unused one on a client with an account, and it opens to "This email already
 * has an account. Sign in instead.": the account is clients.user_id, which
 * the Invite box and activation read first.
 *
 * Never throws: a client is added, or activated, whatever its invitation does.
 */
export async function sendInvitation(clientId: string, now: Date = new Date()): Promise<SendInvitationResult> {
  try {
    const { data: client, error: clientError } = await supabaseAdmin
      .from("clients")
      .select("name, email, user_id, coach:coach_id ( name, timezone )")
      .eq("id", clientId)
      .maybeSingle()
    if (clientError) throw new Error(`Failed to read the client: ${clientError.message}`)
    if (!client?.coach) return { sent: false, reason: "not_found" }
    if (client.user_id) return { sent: false, reason: "has_account" }
    if (!client.email) return { sent: false, reason: "no_email" }

    const token = generateInviteToken()
    const invitedAt = now.toISOString()
    const expiresAt = new Date(now.getTime() + INVITATION_EXPIRY_DAYS * DAY_MS).toISOString()

    const email = await sendInvitationEmail(client.email, client.name, client.coach.name, token)
    if (!email.success) {
      captureApiError(new Error(email.error ?? "The invitation email was not sent"), {
        source: "invitation-service: the invitation email",
        clientId,
      })
      return { sent: false, reason: "email_failed" }
    }

    const row = { invited_at: invitedAt, expires_at: expiresAt, accepted_at: null }
    const { error: writeError } = await supabaseAdmin
      .from(invitationsTable)
      .upsert({ client_id: clientId, token, email: client.email, ...row }, { onConflict: "client_id" })
    if (writeError) {
      captureApiError(new Error(`Failed to write the invitation: ${writeError.message}`), {
        source: "invitation-service: an invitation emailed and not written",
        clientId,
      })
      return { sent: false, reason: "failed" }
    }

    return { sent: true, invitation: toInvitationRead(row, false, client.coach.timezone, now) }
  } catch (error) {
    captureApiError(error, { source: "invitation-service: sendInvitation", clientId })
    return { sent: false, reason: "failed" }
  }
}

/** Two addresses are one inbox whatever their case, as a login's address is stored lower-cased. */
function sameAddress(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * Activation's invitation (D42): sent, and awaited, only to a client with no
 * account and no link that still works at their address, so a client invited
 * before activation gets no second email whose link would end the first. A
 * link sent before the coach corrected a pending client's address reaches
 * another inbox: the client is sent one at theirs, and its row ends the
 * other. A client who accepts while it runs needs none. Never throws: the
 * client is active either way.
 */
export async function sendInvitationIfNeeded(client: { id: string; email: string; userId?: string }): Promise<InvitationOutcome> {
  if (client.userId) return "not_needed"

  try {
    const { data: row, error } = await supabaseAdmin
      .from(invitationsTable)
      .select("email, expires_at, accepted_at")
      .eq("client_id", client.id)
      .maybeSingle()
    if (error) throw new Error(`Failed to read the invitation: ${error.message}`)
    if (row && sameAddress(row.email, client.email) && invitationLinkWorks(row)) return "not_needed"
  } catch (error) {
    // Unread, a working link can't be ruled out, and a send would end it.
    captureApiError(error, { source: "invitation-service: sendInvitationIfNeeded", clientId: client.id })
    return "failed"
  }

  const result = await sendInvitation(client.id)
  if (result.sent) return "sent"
  return result.reason === "has_account" ? "not_needed" : "failed"
}
