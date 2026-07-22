import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";

/**
 * Create authenticated Supabase client for API routes
 * Uses regular client (not admin) to respect RLS policies
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