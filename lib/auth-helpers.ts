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
  const supabase = await createSupabaseServerClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return null;
  }

  const { data: coach } = await supabase
    .from("coaches")
    .select("id")
    .eq("user_id", session.user.id)
    .single();

  return coach?.id || null;
}

/**
 * Gets the authenticated client ID from the current session
 * @returns The client ID if authenticated as a client, null otherwise
 */
export async function getAuthenticatedClientId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return null;
  }

  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("user_id", session.user.id)
    .single();

  return client?.id || null;
}
