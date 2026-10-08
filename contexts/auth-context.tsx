"use client"

import { createContext, useContext, type ReactNode } from "react"
import useSWR, { useSWRConfig } from "swr"
import { authClient, type SessionUser } from "@/lib/auth-client"
import { AuthRefusal } from "@/lib/auth-error-messages"
import { LOGGED_OUT_PAGE } from "@/lib/constants"
import { loadFreshPage } from "@/lib/load-fresh-page"
import type { Coach } from "@/types/check-in"
import type { Profile, UserRole } from "@/types/auth"
import { swrFetcher } from "@/lib/swr-fetcher"

// Who is signed in is Better Auth's session, read by authClient.useSession()
// (lib/auth-client.ts), which also renews the session's cookie. Profile/coach
// come from GET /api/auth/me via SWR, keyed on the session's user id; the
// browser never reads the profiles/coaches tables (CONVENTIONS §8). The proxy
// remains the server-side backstop for session validity on every navigation.

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
  user: SessionUser | null
  coach: Coach | null
  profile: Profile | null
  role: UserRole | null
  loading: boolean
  isTrainer: boolean
  isClient: boolean
  login: (email: string, password: string) => Promise<UserRole | null>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession()
  const user = session?.user ?? null
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
  // useSession's isPending holds while it reads a session with none in hand:
  // the first read, and a signed-out page's re-read on focus. A signed-in
  // person's re-reads and renewals leave it false, so their gates never strobe.
  const loading =
    isPending || (user !== null && me === undefined && meError === undefined)

  /** Sign in with email and password; returns the role for the redirect. */
  const login = async (
    email: string,
    password: string
  ): Promise<UserRole | null> => {
    const { data, error } = await authClient.signIn.email({ email, password })
    if (error) throw new AuthRefusal(error)

    let userRole: UserRole | null = null
    try {
      const meResponse = (await swrFetcher(ME_URL)) as MeResponse
      await globalMutate(meKey(data.user.id), meResponse, { revalidate: false })
      userRole = meResponse.data.profile?.role ?? null
    } catch (meFailure) {
      // Auth succeeded — never sign out or fail the login over a profile
      // read. Null role sends the user to /dashboard; the proxy corrects
      // clients to /client, and the mounted SWR key retries.
      console.error("[Auth] /api/auth/me failed after login:", meFailure)
    }
    return userRole
  }

  /**
   * Sign out this device only (D14); every other device stays signed in. Then
   * the login page loads fresh, which says "Logged out successfully". A fresh
   * page keeps nothing of the account that signed out: not the data this page
   * holds, which whoever signs in next on this browser would see first, nor
   * Next's remembered routes, which could send the way to the login page back
   * to the dashboard. A refused sign-out throws and goes nowhere.
   */
  const logout = async () => {
    try {
      const { error } = await authClient.signOut()
      if (error) {
        console.error("Logout error:", error)
        throw new AuthRefusal(error)
      }
    } finally {
      // Purge the /me cache even if sign-out partially fails, so the previous
      // user's profile never lingers in memory.
      await globalMutate(isMeKey, undefined, { revalidate: false })
    }
    loadFreshPage(LOGGED_OUT_PAGE)
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
        logout,
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
