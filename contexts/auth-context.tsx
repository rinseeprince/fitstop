"use client"

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import useSWR, { useSWRConfig } from "swr"
import { supabase } from "@/services/supabase-client"
import type { User } from "@supabase/supabase-js"
import type { Coach } from "@/types/check-in"
import type { Profile, UserRole } from "@/types/auth"
import { swrFetcher } from "@/lib/swr-fetcher"

// Session lifecycle lives here (supabase.auth only — auth API calls never
// touch PostgREST). Profile/coach come from GET /api/auth/me via SWR; the
// browser never reads the profiles/coaches tables directly (CONVENTIONS §8).
// The onAuthStateChange callback MUST stay synchronous: supabase-js holds an
// origin-wide Navigator lock while it runs, and any awaited supabase query
// inside it deadlocks against that lock. Middleware remains the server-side
// backstop for session validity on every navigation.

const ME_URL = "/api/auth/me"

type MeResponse = {
  success: boolean
  data: { profile: Profile | null; coach: Coach | null }
}

const meKey = (userId: string) => [ME_URL, userId] as const
/**
 * Area matcher for the /api/auth/me cache. Exported because the coach's unit
 * preference rides on this payload (`coach.unitPreference`), so it lives in
 * BOTH this cache and the units cache — `useInvalidateUnitPreference`
 * (contexts/units-context.tsx) must clear both areas or a settings change
 * refreshes one and silently leaves `useAuth().coach` stale (CONVENTIONS §7).
 *
 * A test that factory-mocks this module AND mounts UnitsProvider must include
 * `isMeKey` in the mock, or `mutate(undefined)` becomes a silent no-op. The two
 * existing mocks (app/client/layout.test.tsx,
 * components/client-portal/nav/client-nav.test.tsx) mount neither, so they are
 * unaffected today.
 */
export const isMeKey = (key: unknown): boolean =>
  Array.isArray(key) && key[0] === ME_URL

interface AuthContextType {
  user: User | null
  coach: Coach | null
  profile: Profile | null
  role: UserRole | null
  loading: boolean
  isTrainer: boolean
  isClient: boolean
  login: (email: string, password: string) => Promise<UserRole | null>
  loginWithGoogle: () => Promise<void>
  signup: (email: string, password: string, name: string) => Promise<void>
  logout: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
  updatePassword: (newPassword: string) => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [sessionResolved, setSessionResolved] = useState(false)
  // login() fetches /me itself and primes the SWR cache before setting user;
  // suppressing the SIGNED_IN echo during that window keeps it to one fetch.
  const loginInFlightRef = useRef(false)
  const { mutate: globalMutate } = useSWRConfig()

  const { data: me, error: meError } = useSWR<MeResponse>(
    user ? meKey(user.id) : null,
    (key: readonly [string, string]) => swrFetcher(key[0]) as Promise<MeResponse>,
    {
      revalidateOnFocus: false,
      errorRetryCount: 3,
      errorRetryInterval: 1000,
      // A login-primed cache must not refetch on key mount; empty-cache
      // mounts still fetch (that's revalidateOnMount's default).
      revalidateIfStale: false,
    }
  )

  const profile = me?.data.profile ?? null
  const coach = me?.data.coach ?? null
  const role = profile?.role ?? null
  const isTrainer = role === "trainer"
  const isClient = role === "client"
  // False as soon as the first /me attempt settles; background retries must
  // not strobe consumer gates, so this deliberately isn't SWR's isLoading.
  const loading =
    !sessionResolved || (user !== null && me === undefined && meError === undefined)

  useEffect(() => {
    // Subscribe before getSession so no auth event slips between the two.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (loginInFlightRef.current && event === "SIGNED_IN") return
      setUser(session?.user ?? null)
      setSessionResolved(true)
    })

    void supabase.auth
      .getSession()
      .then(({ data }) => setUser(data.session?.user ?? null))
      .catch((error) => console.error("[Auth] getSession failed:", error))
      .finally(() => setSessionResolved(true))

    return () => subscription.unsubscribe()
  }, [])

  /** Login with email and password — returns the role for redirect */
  const login = async (
    email: string,
    password: string
  ): Promise<UserRole | null> => {
    loginInFlightRef.current = true
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) throw error
      if (!data.user) return null

      let userRole: UserRole | null = null
      try {
        const meResponse = (await swrFetcher(ME_URL)) as MeResponse
        await globalMutate(meKey(data.user.id), meResponse, { revalidate: false })
        userRole = meResponse.data.profile?.role ?? null
      } catch (meFailure) {
        // Auth succeeded — never sign out or fail the login over a profile
        // read. Null role sends the user to /dashboard; middleware corrects
        // clients to /client, and the mounted SWR key retries.
        console.error("[Auth] /api/auth/me failed after login:", meFailure)
      }

      setUser(data.user)
      setSessionResolved(true)
      return userRole
    } finally {
      loginInFlightRef.current = false
    }
  }

  // Login with Google OAuth
  const loginWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) throw error
  }

  // Sign up with email and password (trainers only)
  const signup = async (email: string, password: string, name: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name,
          // Display metadata only — the signup trigger (migration 107)
          // derives the real role from server state and ignores this key.
          role: "trainer",
        },
      },
    })

    if (error) {
      if (error.status === 422 || error.message?.includes("already registered")) {
        throw new Error("This email is already registered. Please log in instead.")
      }
      throw error
    }

    // Supabase returns a user with an empty identities array for emails that
    // already have an account.
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      throw new Error("This email is already registered. Please log in instead.")
    }

    // The database trigger creates the profile/coach rows; /api/auth/me
    // fetches them once the session lands.
  }

  // Logout
  const logout = async () => {
    try {
      const { error } = await supabase.auth.signOut({ scope: "global" })
      if (error) {
        console.error("Logout error:", error)
        throw error
      }
    } finally {
      // Clear local state even if signOut partially fails, and purge the /me
      // cache so the previous user's profile never lingers in memory.
      setUser(null)
      await globalMutate(isMeKey, undefined, { revalidate: false })
    }
  }

  // Send password reset email
  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })

    if (error) throw error
  }

  // Update password
  const updatePassword = async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    })

    if (error) throw error
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        coach,
        profile,
        role,
        loading,
        isTrainer,
        isClient,
        login,
        loginWithGoogle,
        signup,
        logout,
        resetPassword,
        updatePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
