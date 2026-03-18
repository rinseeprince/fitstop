import { supabase } from "@/services/supabase-client"
import { supabaseAdmin } from "@/services/supabase-admin"
import { sendInvitationEmail, generateInviteToken } from "@/services/email-service"
import type {
  ClientInvitation,
  ClientInvitationRow,
  SendInvitationResponse,
} from "@/types/auth"
import { toClientInvitation } from "@/types/auth"

const INVITATION_EXPIRY_DAYS = 7

// Type cast for tables not yet in generated types
const invitationsTable = "client_invitations"
const clientsTable = "clients"
const _coachesTable = "coaches"

/**
 * Get invitation status for a client
 */
export async function getInvitationForClient(
  clientId: string
): Promise<ClientInvitation | null> {
  const { data, error } = await supabase
    .from(invitationsTable)
    .select("*")
    .eq("client_id", clientId)
    .single()

  if (error) {
    if (error.code === "PGRST116") {
      return null
    }
    console.error("Error fetching invitation:", error)
    throw error
  }

  return toClientInvitation(data as ClientInvitationRow)
}

/**
 * Get invitation by token (public - no auth required)
 */
export async function getInvitationByToken(
  token: string
): Promise<{
  success: boolean
  invitation?: {
    id: string
    clientName: string
    clientEmail: string
    coachName: string
    expiresAt: string | null
    status: string
  }
  error?: string
}> {
  try {
    // Query invitation with client and coach info
    const { data: invitationData, error: invitationError } = await supabaseAdmin
      .from(invitationsTable)
      .select(`
        *,
        client:client_id (
          id,
          name,
          email,
          coach:coach_id (
            id,
            name
          )
        )
      `)
      .eq("token", token)
      .single()

    if (invitationError || !invitationData) {
      return {
        success: false,
        error: "Invalid invitation link"
      }
    }

    const invitation = invitationData as ClientInvitationRow & {
      client: {
        id: string
        name: string
        email: string
        coach: {
          id: string
          name: string
        }
      }
    }

    // Check if invitation has expired
    if (invitation.expires_at && new Date(invitation.expires_at) < new Date()) {
      return {
        success: false,
        error: "This invitation has expired"
      }
    }

    // Check if invitation is already accepted
    if (invitation.status === "accepted") {
      return {
        success: false,
        error: "This invitation has already been used"
      }
    }

    return {
      success: true,
      invitation: {
        id: invitation.id,
        clientName: invitation.client.name,
        clientEmail: invitation.client.email,
        coachName: invitation.client.coach.name,
        expiresAt: invitation.expires_at,
        status: invitation.status
      }
    }
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

/**
 * Accept invitation by token and link user to client (server-side only)
 */
export async function acceptInvitationByToken(
  token: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get invitation by token
    const { data: invitationData, error: invitationError } = await supabaseAdmin
      .from(invitationsTable)
      .select("*")
      .eq("token", token)
      .single()

    if (invitationError || !invitationData) {
      return {
        success: false,
        error: "Invalid invitation token"
      }
    }

    const invitation = invitationData as ClientInvitationRow

    // Check if invitation has expired
    if (invitation.expires_at && new Date(invitation.expires_at) < new Date()) {
      return {
        success: false,
        error: "This invitation has expired"
      }
    }

    // Check if invitation is already accepted
    if (invitation.status === "accepted") {
      return {
        success: false,
        error: "This invitation has already been used"
      }
    }

    // Update invitation status
    const { error: updateError } = await supabaseAdmin
      .from(invitationsTable)
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString()
      })
      .eq("token", token)

    if (updateError) {
      console.error("Error updating invitation status:", updateError)
      return {
        success: false,
        error: "Failed to accept invitation"
      }
    }

    // Link user_id to client record
    const { error: linkError } = await supabaseAdmin
      .from(clientsTable)
      .update({ user_id: userId })
      .eq("id", invitation.client_id)

    if (linkError) {
      console.error("Error linking user to client:", linkError)
      return {
        success: false,
        error: "Failed to link user to client"
      }
    }

    console.warn("Successfully accepted invitation")
    return { success: true }
  } catch (error) {
    console.error("Error in acceptInvitationByToken:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to accept invitation"
    }
  }
}

/**
 * Legacy function: Mark invitation as accepted by clientId (for backward compatibility)
 * @deprecated Use acceptInvitationByToken instead
 */
export async function acceptInvitation(
  clientId: string,
  userId: string
): Promise<void> {
  console.warn("acceptInvitation is deprecated, use acceptInvitationByToken instead")
  
  // Update invitation status
  await supabaseAdmin
    .from(invitationsTable)
    .update({
      status: "accepted",
      accepted_at: new Date().toISOString()
    })
    .eq("client_id", clientId)

  // Link user_id to client record
  await supabaseAdmin
    .from(clientsTable)
    .update({ user_id: userId })
    .eq("id", clientId)
}

/**
 * Get client ID from user ID
 */
export async function getClientIdForUser(userId: string): Promise<string | null> {
  const { data: client } = await supabaseAdmin
    .from(clientsTable)
    .select("id")
    .eq("user_id", userId)
    .single()

  if (client) {
    return client.id
  }

  return null
}