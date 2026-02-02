import { supabase } from "@/services/supabase-client"
import { supabaseAdmin } from "@/services/supabase-admin"
import type {
  ClientInvitation,
  ClientInvitationRow,
  SendInvitationResponse,
} from "@/types/auth"

const INVITATION_EXPIRY_DAYS = 7

// Type cast for tables not yet in generated types
const invitationsTable = "client_invitations"
const clientsTable = "clients"

/**
 * Get invitation status for a client
 */
export async function getInvitationForClient(
  clientId: string
): Promise<ClientInvitation | null> {
  const { data, error } = await (supabase as any)
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

  return rowToInvitation(data as ClientInvitationRow)
}

/**
 * Send a magic link invitation to a client (server-side only)
 */
export async function sendInvitation(
  clientId: string,
  clientEmail: string,
  appUrl: string
): Promise<SendInvitationResponse> {
  try {
    // Check if invitation already exists
    const { data: invitationData } = await (supabaseAdmin as any)
      .from(invitationsTable)
      .select("*")
      .eq("client_id", clientId)
      .single()

    const existingInvitation = invitationData as ClientInvitationRow | null

    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS)

    // Create or update invitation record
    if (existingInvitation) {
      // Check if already accepted
      if (existingInvitation.status === "accepted") {
        return {
          success: false,
          error: "Client has already accepted the invitation",
        }
      }

      // Update existing invitation
      await (supabaseAdmin as any)
        .from(invitationsTable)
        .update({
          status: "sent",
          invited_at: new Date().toISOString(),
          expires_at: expiresAt.toISOString(),
        })
        .eq("client_id", clientId)
    } else {
      // Create new invitation
      await (supabaseAdmin as any).from(invitationsTable).insert({
        client_id: clientId,
        status: "sent",
        invited_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
      })
    }

    // Send magic link via Supabase Auth
    const redirectUrl = `${appUrl}/auth/callback?type=invitation&clientId=${clientId}`

    const { error: authError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      clientEmail,
      {
        redirectTo: redirectUrl,
        data: {
          role: "client",
          clientId: clientId,
        },
      }
    )

    if (authError) {
      console.error("Error sending invitation email:", authError)
      // Revert invitation status
      await (supabaseAdmin as any)
        .from(invitationsTable)
        .update({ status: "pending" })
        .eq("client_id", clientId)

      return {
        success: false,
        error: authError.message,
      }
    }

    // Fetch updated invitation
    const { data: updatedInvitation } = await (supabaseAdmin as any)
      .from(invitationsTable)
      .select("*")
      .eq("client_id", clientId)
      .single()

    return {
      success: true,
      invitation: updatedInvitation
        ? rowToInvitation(updatedInvitation as ClientInvitationRow)
        : undefined,
    }
  } catch (error) {
    console.error("Error in sendInvitation:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to send invitation",
    }
  }
}

/**
 * Mark invitation as accepted and link user to client (server-side only)
 */
export async function acceptInvitation(
  clientId: string,
  userId: string
): Promise<void> {
  // Update invitation status
  await (supabaseAdmin as any)
    .from(invitationsTable)
    .update({
      status: "accepted",
      accepted_at: new Date().toISOString(),
    })
    .eq("client_id", clientId)

  // Link user_id to client record
  await (supabaseAdmin as any)
    .from(clientsTable)
    .update({ user_id: userId })
    .eq("id", clientId)
}

/**
 * Get client ID from user metadata or invitation
 */
export async function getClientIdForUser(userId: string): Promise<string | null> {
  // First check if already linked
  const { data: client } = await (supabaseAdmin as any)
    .from(clientsTable)
    .select("id")
    .eq("user_id", userId)
    .single()

  if (client) {
    return (client as { id: string }).id
  }

  return null
}

/**
 * Convert database row to ClientInvitation type
 */
function rowToInvitation(row: ClientInvitationRow): ClientInvitation {
  return {
    id: row.id,
    clientId: row.client_id,
    status: row.status,
    invitedAt: row.invited_at,
    acceptedAt: row.accepted_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
