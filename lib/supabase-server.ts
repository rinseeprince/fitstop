import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";

/**
 * The session client for API routes: built from the public key and the
 * caller's login, it validates the session (`auth.getUser()`) and reads
 * nothing. Every table read is `supabaseAdmin`'s (CONVENTIONS §8).
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  // Mark the session cookie Secure over https (production) but not over plain
  // http (local dev), or the browser would drop it and dev login would break.
  const secure = (await headers()).get("x-forwarded-proto") === "https";
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
              cookieStore.set(name, value, { ...options, secure })
            );
          } catch {
            // Handle read-only error in Server Components
          }
        },
      },
    }
  );
}