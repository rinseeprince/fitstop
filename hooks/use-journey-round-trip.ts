"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  readJourneyTrip,
  stripJourneyTrip,
  type JourneyTripSurface,
} from "@/lib/client-tabs";

/**
 * A locally-owned open/close surface — the Training apply tray, the Nutrition
 * plan drawer — that a Journey block can deep-link OPEN, plus the trip back.
 *
 * Two properties carry the whole design, and both are bugs if dropped:
 *
 * 1. **Consume on ARRIVAL, not at mount.** The trip params are not in the URL
 *    when this surface mounts: `handleTabChange` flips `activeTab` before
 *    `router.replace` lands, so the surface renders once against the previous
 *    tab's query and the params arrive a render later. A `useState`
 *    initializer would read the URL too early and see nothing.
 *
 * 2. **Strip them, and clear the target on any close without a save.** The
 *    whole query rides across every tab change. A `returnTo` that outlives its
 *    own flow bounces the coach to Journey after a LATER, unrelated save; a
 *    lingering open-param re-opens the surface on every hand-return to the tab,
 *    because Radix unmounts inactive TabsContent and each visit is a fresh
 *    mount. Stripping covers the second, `setOpen(false)` covers the first.
 *
 * Read `returnBlockId` from the render closure when the save succeeds — the
 * surface's own close clears it, and closure capture makes that a non-race.
 */
export function useJourneyRoundTrip(surface: JourneyTripSurface): {
  open: boolean;
  setOpen: (open: boolean) => void;
  returnBlockId: string | null;
} {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [open, setOpenState] = useState(false);
  const [returnBlockId, setReturnBlockId] = useState<string | null>(null);
  // Guards the window between consuming and the stripped URL committing, in
  // which this effect can re-run against the params it already handled.
  const consumed = useRef(false);

  useEffect(() => {
    if (consumed.current) return;
    const trip = readJourneyTrip(searchParams, surface);
    if (!trip.open) return;
    consumed.current = true;
    setOpenState(true);
    setReturnBlockId(trip.returnBlockId);
    router.replace(`?${stripJourneyTrip(searchParams.toString(), surface)}`, {
      scroll: false,
    });
  }, [searchParams, router, surface]);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    // Closing without a save ABANDONS the trip. Nothing may ride on to the
    // next one.
    if (!next) setReturnBlockId(null);
  }, []);

  return { open, setOpen, returnBlockId };
}
