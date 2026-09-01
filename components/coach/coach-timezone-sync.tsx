"use client"

import { useAuth } from "@/contexts/auth-context"
import { useTimezoneSync } from "@/hooks/use-timezone-sync"

/**
 * Keeps the stored coach timezone in sync with the device. Mounted once, by the
 * coach layout (app/(coach)/layout.tsx) — the coach twin of the call in
 * app/client/layout.tsx. `coach` is only set for confirmed trainers, so this
 * no-ops until the profile resolves and whenever it is absent.
 */
export function CoachTimezoneSync() {
  const { coach } = useAuth()
  useTimezoneSync("coach", coach?.timezone)
  return null
}
