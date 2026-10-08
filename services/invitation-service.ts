import { supabaseAdmin } from "@/services/supabase-admin"
import { sendInvitationEmail, generateInviteToken } from "@/services/email-service"
import type {
  ClientInvitationRow,
  InvitationDetails,
  SendInvitationResponse,
} from "@/types/auth"
import { toClientInvitation } from "@/types/auth"
import { maskEmail } from "@/lib/mask-email"

const INVITATION_EXPIRY_DAYS = 7

// Type cast for tables not yet in generated types
const invitationsTable = "client_invitations"
const clientsTable = "clients"
const _coachesTable = "coaches"

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
 * holds the token, it has expired, or it was accepted. Throws when the read
 * fails, which is not a refusal.
 */
export async function findLiveInvitation(
  token: string
): Promise<{ invitation: LiveInvitation } | { refusal: InvitationRefusal }> {
  const { data, error } = await supabaseAdmin
    .from(invitationsTable)
    .select("id, client_id, email, status, expires_at, client:client_id ( name, coach:coach_id ( name ) )")
    .eq("token", token)
    .maybeSingle()

  if (error) throw new Error(`Failed to read the invitation: ${error.message}`)
  if (!data?.client?.coach) return { refusal: "invalid" }
  if (data.expires_at && new Date(data.expires_at) < new Date()) return { refusal: "expired" }
  if (data.status === "accepted") return { refusal: "used" }

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

/**
 * Send invitation via email with secure token (server-side only)
 */
export async function sendInvitation(
  clientId: string
): Promise<SendInvitationResponse> {
  try {
    // First, get client and coach info
    const { data: clientData, error: clientError } = await supabaseAdmin
      .from(clientsTable)
      .select(`
        *,
        coach:coach_id (
          id,
          name,
          email
        )
      `)
      .eq("id", clientId)
      .single()

    if (clientError || !clientData) {
      return {
        success: false,
        error: "Client not found"
      }
    }

    const client = clientData as {
      id: string
      name: string
      email: string
      coach: {
        id: string
        name: string
        email: string
      }
    }

    // Check if invitation already exists
    const { data: existingInvitation } = await supabaseAdmin
      .from(invitationsTable)
      .select("*")
      .eq("client_id", clientId)
      .single()

    // Check if already accepted
    if (existingInvitation?.status === "accepted") {
      return {
        success: false,
        error: "Client has already accepted the invitation"
      }
    }

    // Generate secure token and set expiry
    const token = generateInviteToken()
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS)

    const invitationData = {
      client_id: clientId,
      token,
      email: client.email,
      status: "sent",
      invited_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
    }

    // Create or update invitation record
    if (existingInvitation) {
      // Update existing invitation with new token
      const { data: _updatedInvitation, error: updateError } = await supabaseAdmin
        .from(invitationsTable)
        .update(invitationData)
        .eq("client_id", clientId)
        .select()
        .single()

      if (updateError) {
        console.error("Error updating invitation:", updateError)
        return {
          success: false,
          error: "Failed to update invitation"
        }
      }
    } else {
      // Create new invitation
      const { data: _newInvitation, error: createError } = await supabaseAdmin
        .from(invitationsTable)
        .insert(invitationData)
        .select()
        .single()

      if (createError) {
        console.error("Error creating invitation:", createError)
        return {
          success: false,
          error: "Failed to create invitation"
        }
      }
    }

    // Send email via Resend
    const emailResult = await sendInvitationEmail(
      client.email,
      client.name,
      client.coach.name,
      token
    )

    if (!emailResult.success) {
      console.error("Failed to send invitation email:", emailResult.error)
      
      // Revert invitation status if email failed
      await supabaseAdmin
        .from(invitationsTable)
        .update({ status: "pending" })
        .eq("client_id", clientId)

      return {
        success: false,
        error: emailResult.error || "Failed to send invitation email"
      }
    }

    // Fetch the final invitation record
    const { data: finalInvitation } = await supabaseAdmin
      .from(invitationsTable)
      .select("*")
      .eq("client_id", clientId)
      .single()

    return {
      success: true,
      invitation: finalInvitation ? toClientInvitation(finalInvitation as ClientInvitationRow) : undefined
    }
  } catch (error) {
    console.error("Error in sendInvitation:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to send invitation"
    }
  }
}