import { supabase } from "@/services/supabase-client"
import type { Profile, ProfileRow, UserRole } from "@/types/auth"

// Type cast for profiles table not yet in generated types
const profilesTable = "profiles"

/**
 * Get a user's profile by their auth user ID
 */
export async function getProfileByUserId(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from(profilesTable)
    .select("*")
    .eq("user_id", userId)
    .single()

  if (error) {
    if (error.code === "PGRST116") {
      // No rows returned
      return null
    }
    console.error("Error fetching profile:", error)
    throw error
  }

  return rowToProfile(data as ProfileRow)
}

/**
 * Create a new profile for a user
 */
export async function createProfile(
  userId: string,
  role: UserRole
): Promise<Profile> {
  const { data, error } = await supabase
    .from(profilesTable)
    .insert({
      user_id: userId,
      role,
    })
    .select()
    .single()

  if (error) {
    console.error("Error creating profile:", error)
    throw error
  }

  return rowToProfile(data as ProfileRow)
}

/**
 * Get a user's role by their auth user ID
 */
export async function getUserRole(userId: string): Promise<UserRole | null> {
  const profile = await getProfileByUserId(userId)
  return profile?.role ?? null
}

/**
 * Get or create a profile for a user
 */
export async function getOrCreateProfile(
  userId: string,
  defaultRole: UserRole = "trainer"
): Promise<Profile> {
  const existing = await getProfileByUserId(userId)
  if (existing) {
    return existing
  }
  return createProfile(userId, defaultRole)
}

/**
 * Convert database row to Profile type
 */
function rowToProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    userId: row.user_id,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
