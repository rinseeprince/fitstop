import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/** Create a server-side Supabase client with cookie handling */
async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Handle read-only error in Server Components
          }
        },
      },
    }
  );
}

/**
 * Gets the authenticated coach ID from the current session
 * @returns The coach ID if authenticated, null otherwise
 */
export async function getAuthenticatedCoachId(): Promise<string | null> {
  try {
    const supabase = await createSupabaseServerClient();

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
    const supabase = await createSupabaseServerClient();

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
