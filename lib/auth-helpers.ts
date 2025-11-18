import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Gets the authenticated coach ID from the current session
 * @returns The coach ID if authenticated, null otherwise
 */
export async function getAuthenticatedCoachId(): Promise<string | null> {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );

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
