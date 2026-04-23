import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * Gets the authenticated coach ID from the current session
 * @returns The coach ID if authenticated, null otherwise
 */
export async function getAuthenticatedCoachId(): Promise<string | null> {
  try {
    const supabase = await createServerSupabaseClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return null;
    }

    // Use maybeSingle() to avoid throwing PGRST116 when no coach found
    const { data: coach, error } = await supabase
      .from("coaches")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    // Log unexpected errors but don't throw
    if (error) {
      console.error("Error fetching coach:", error.message);
      return null;
    }

    return coach?.id || null;
  } catch (error) {
    console.error("Unexpected error in getAuthenticatedCoachId:", error);
    return null;
  }
}

/**
 * Gets the authenticated client ID from the current session
 * @returns The client ID if authenticated as a client, null otherwise
 */
export async function getAuthenticatedClientId(): Promise<string | null> {
  try {
    const supabase = await createServerSupabaseClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return null;
    }

    // Use maybeSingle() to avoid throwing PGRST116 when no client found
    const { data: client, error } = await supabase
      .from("clients")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    // Log unexpected errors but don't throw
    if (error) {
      console.error("Error fetching client:", error.message);
      return null;
    }

    return client?.id || null;
  } catch (error) {
    console.error("Unexpected error in getAuthenticatedClientId:", error);
    return null;
  }
}

/**
 * Gets the authenticated client ID and check-in day from the current session.
 * Used by training-related routes that need the client's check-in day
 * to compute correct training week boundaries.
 */
export async function getAuthenticatedClientWithCheckInDay(): Promise<{
  clientId: string;
  checkInDay: string | null;
} | null> {
  try {
    const supabase = await createServerSupabaseClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return null;
    }

    const { data: client, error } = await supabase
      .from("clients")
      .select("id, expected_check_in_day")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      console.error("Error fetching client:", error.message);
      return null;
    }

    if (!client?.id) return null;

    return {
      clientId: client.id,
      checkInDay: client.expected_check_in_day ?? null,
    };
  } catch (error) {
    console.error("Unexpected error in getAuthenticatedClientWithCheckInDay:", error);
    return null;
  }
}
