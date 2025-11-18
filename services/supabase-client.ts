import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

// Supabase configuration (client-safe environment variables only)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase environment variables. Ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set."
  );
}

// Client-side Supabase client using SSR package with cookie storage
// This ensures sessions are stored in cookies (not localStorage) for middleware compatibility
export const supabase = createBrowserClient<Database>(
  supabaseUrl,
  supabaseAnonKey
);

// Export createServerClient from @supabase/ssr for middleware and server components
// This properly handles cookies for authentication while respecting RLS
export { createServerClient } from "@supabase/ssr";
