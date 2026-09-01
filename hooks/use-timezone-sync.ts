"use client";

import { useEffect, useRef } from "react";
import { getDeviceTimeZone } from "@/lib/date-helpers";

const ENDPOINTS = {
  client: "/api/client/settings",
  coach: "/api/coach/settings",
} as const;

/**
 * Auto-syncs the stored timezone with the device's IANA zone (Session 7.81).
 *
 * Compares on every app load — not just when the stored value is the 'UTC'
 * default — so a traveller's zone updates on next open. The PATCH is
 * fire-and-forget: it never blocks render and failures are silent (the next
 * load retries). One attempt per mount guards against re-PATCH loops while the
 * SWR/auth cache still holds the stale stored value after a successful sync.
 *
 * Pass `storedTimezone` as undefined/null while the profile is loading; the
 * effect re-runs when it resolves.
 */
export function useTimezoneSync(
  scope: "client" | "coach",
  storedTimezone: string | null | undefined,
): void {
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (storedTimezone == null) {
      // Profile not loaded — or gone again, as on logout, which clears it
      // before the route changes and the mount (app/client/layout.tsx, or
      // CoachTimezoneSync under app/(coach)/layout.tsx) goes with it. Re-arm so
      // the next resolved profile is compared afresh; a one-shot that stayed
      // spent would skip it.
      attemptedRef.current = false;
      return;
    }
    if (attemptedRef.current) return;
    const device = getDeviceTimeZone();
    if (!device || device === storedTimezone) return;

    attemptedRef.current = true;
    void fetch(ENDPOINTS[scope], {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timezone: device }),
    }).catch(() => {
      // Silent by design: sync retries on the next app load.
    });
  }, [scope, storedTimezone]);
}
