"use client"

import { useEffect } from "react"
import { trackCoachHistory } from "@/lib/coach-history"

/**
 * Keeps the count every back arrow reads (`lib/coach-history.ts`) while a
 * coach page is mounted. Mounted once, by the coach layout
 * (app/(coach)/layout.tsx), beside the other concerns that run on every coach
 * page; renders nothing.
 */
export function CoachHistoryTracker() {
  useEffect(() => trackCoachHistory(), [])
  return null
}
