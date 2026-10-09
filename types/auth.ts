// User role types
export type UserRole = "trainer" | "client"

// A login's role, keyed on its Better Auth user id
export type Profile = {
  id: string
  userId: string
  role: UserRole
  createdAt: string
  updatedAt: string
}

// Database row type for profiles
type ProfileRow = {
  id: string
  user_id: string
  role: UserRole
  created_at: string
  updated_at: string
}

/**
 * What the coach's Invite box reads of a client's invitation (GET and POST
 * /api/clients/[id]/invitation, D43): whether the client has an account, and
 * the invitation's dates as the coach's calendar days. Never the link's token:
 * whoever holds it can set up the client's account.
 */
export type InvitationRead = {
  hasAccount: boolean
  invitation: {
    /** The coach's calendar day the email went (YYYY-MM-DD). */
    sentOn: string | null
    /** The coach's calendar day the link stops working (YYYY-MM-DD); none on a row written before links expired. */
    expiresOn: string | null
    /** Never used, and its expiry ahead (invitationLinkWorks, services/invitation-service.ts). */
    linkWorks: boolean
  } | null
}

/** What activating a client did about their invitation (D42), as POST /api/clients/[id]/activate answers it. */
export type InvitationOutcome = "sent" | "failed" | "not_needed"

export type AcceptInvitationResponse = {
  success: boolean
  error?: string
}

/** What GET /api/invitations/[token] shows whoever holds the link: never the full address or the client's name. */
export type InvitationDetails = {
  coachName: string
  /** The invited address with the middle of its local part hidden (lib/mask-email.ts). */
  emailMasked: string
  expiresAt: string | null
}

export type InvitationDetailsResponse = {
  success: boolean
  invitation?: InvitationDetails
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
