"use client"

import { createContext, useCallback, useContext, type ReactNode } from "react"
import useSWR, { useSWRConfig } from "swr"
import { isMeKey, useAuth } from "@/contexts/auth-context"
import { swrFetcher } from "@/lib/swr-fetcher"
import { DEFAULT_UNIT_SYSTEM, type UnitSystem } from "@/utils/unit-conversions"

// The viewer's own unit system, resolved once for the whole app. Mounted in
// app/layout.tsx, which wraps both the coach and client surfaces, so no
// component needs to fetch a preference of its own.
//
// Storage is canonical kg/cm; this only decides what a person is SHOWN. Pair it
// with the formatters in utils/unit-conversions.ts at the render boundary.

const UNIT_PREFERENCE_URL = "/api/me/unit-preference"

type UnitPreferenceResponse = {
  success: boolean
  data: { preference: UnitSystem }
}

const unitPreferenceKey = (userId: string) =>
  [UNIT_PREFERENCE_URL, userId] as const

const isUnitPreferenceKey = (key: unknown): boolean =>
  Array.isArray(key) && key[0] === UNIT_PREFERENCE_URL

interface UnitsContextType {
  /**
   * The viewer's unit system. Only a RESOLVED value when both `isLoading` and
   * `error` are falsy — otherwise it is the metric fallback and must not be
   * presented as the viewer's choice.
   */
  preference: UnitSystem
  isLoading: boolean
  error: unknown
}

const UnitsContext = createContext<UnitsContextType | undefined>(undefined)

export function UnitsProvider({ children }: { children: ReactNode }) {
  const { user, coach, loading: authLoading } = useAuth()

  // A trainer's preference already arrived on the /api/auth/me payload, so
  // refetching it would duplicate both a request and a cache copy. Only a
  // client (or a coach whose /me failed) needs the route. The `!authLoading`
  // gate costs the client one serialized round trip and buys never firing a
  // request a coach will discard; it also keeps us from fetching before a
  // session exists, where middleware answers /api/me/** with a 307 to /login
  // and the fetcher would try to parse login HTML as JSON.
  const key = user && !authLoading && !coach ? unitPreferenceKey(user.id) : null

  const {
    data,
    isLoading: swrLoading,
    error,
  } = useSWR<UnitPreferenceResponse>(
    key,
    (k: readonly [string, string]) =>
      swrFetcher(k[0]) as Promise<UnitPreferenceResponse>,
    {
      revalidateOnFocus: false,
      errorRetryCount: 3,
      errorRetryInterval: 1000,
      dedupingInterval: 2000,
      onError: (err) =>
        console.error("[Units] unit preference fetch failed:", err),
    }
  )

  const preference =
    coach?.unitPreference ?? data?.data.preference ?? DEFAULT_UNIT_SYSTEM
  const isLoading = authLoading || (key !== null && swrLoading)

  return (
    <UnitsContext.Provider value={{ preference, isLoading, error }}>
      {children}
    </UnitsContext.Provider>
  )
}

export function useUnits() {
  const context = useContext(UnitsContext)
  if (context === undefined) {
    throw new Error("useUnits must be used within a UnitsProvider")
  }
  return context
}

/**
 * Invalidates BOTH caches that carry a unit preference: this route's, and
 * /api/auth/me (which serves the coach's inside `coach.unitPreference`).
 * Clearing only one leaves the other stale with nothing erroring — a settings
 * change would appear to take effect on one surface and not the other until a
 * full reload. Call it from every site that writes a preference.
 */
export function useInvalidateUnitPreference() {
  const { mutate } = useSWRConfig()
  return useCallback(async () => {
    await Promise.all([mutate(isUnitPreferenceKey), mutate(isMeKey)])
  }, [mutate])
}
