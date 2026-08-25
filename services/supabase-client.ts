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

// Client-side Supabase client using SSR package with explicit cookie configuration
// This ensures sessions are stored in cookies (not localStorage) for middleware compatibility
export const supabase = createBrowserClient<Database>(
  supabaseUrl,
  supabaseAnonKey,
  {
    cookies: {
      getAll() {
        if (typeof document !== 'undefined') {
          return document.cookie
            .split(';')
            .map(cookie => cookie.trim().split('='))
            .filter(([name]) => name)
            .map(([name, value]) => ({ name, value: decodeURIComponent(value || '') }));
        }
        return [];
      },
      setAll(cookiesToSet) {
        if (typeof document !== 'undefined') {
          cookiesToSet.forEach(({ name, value, options }) => {
            const cookieOptions = {
              path: '/',
              secure: window.location.protocol === 'https:',
              sameSite: 'lax' as const,
              ...options,
            };
            
            let cookieString = `${name}=${encodeURIComponent(value)}`;
            
            if (cookieOptions.maxAge !== undefined) {
              cookieString += `; Max-Age=${cookieOptions.maxAge}`;
            } else if (cookieOptions.expires) {
              cookieString += `; Expires=${cookieOptions.expires.toUTCString()}`;
            }
            
            cookieString += `; Path=${cookieOptions.path}`;
            cookieString += `; SameSite=${cookieOptions.sameSite}`;
            
            if (cookieOptions.secure) {
              cookieString += '; Secure';
            }
            
            if (cookieOptions.domain) {
              cookieString += `; Domain=${cookieOptions.domain}`;
            }
            
            document.cookie = cookieString;
          });
        }
      },
    },
  }
);
