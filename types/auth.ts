// User role types
export type UserRole = "trainer" | "client"

// Profile type linked to auth.users
export type Profile = {
  id: string
  userId: string
  role: UserRole
  createdAt: string
  updatedAt: string
}

// Database row type for profiles
export type ProfileRow = {
  id: string
  user_id: string
  role: UserRole
  created_at: string
  updated_at: string
}

// Invitation status
export type InvitationStatus = "pending" | "sent" | "accepted" | "expired"

// Client invitation record
export type ClientInvitation = {
  id: string
  clientId: string
  status: InvitationStatus
  token: string | null
  email: string
  invitedAt: string | null
  acceptedAt: string | null
  expiresAt: string | null
  createdAt: string
  updatedAt: string
}

// Database row type for client_invitations
export type ClientInvitationRow = {
  id: string
  client_id: string
  status: InvitationStatus
  token: string | null
  email: string
  invited_at: string | null
  accepted_at: string | null
  expires_at: string | null
  created_at: string
  updated_at: string
}

export type SendInvitationResponse = {
  success: boolean
  invitation?: ClientInvitation
  error?: string
}

export type AcceptInvitationResponse = {
  success: boolean
  error?: string
}

export type InvitationDetailsResponse = {
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
}

// Helper to convert DB row to Profile
export function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    userId: row.user_id,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// Helper to convert DB row to ClientInvitation
export function toClientInvitation(row: ClientInvitationRow): ClientInvitation {
  return {
    id: row.id,
    clientId: row.client_id,
    status: row.status,
    token: row.token,
    email: row.email,
    invitedAt: row.invited_at,
    acceptedAt: row.accepted_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
