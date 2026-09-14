"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  readJourneyTrip,
  stripJourneyReturn,
  stripJourneyTrip,
  type JourneyTripSurface,
} from "@/lib/client-tabs";

/**
 * A locally-owned open/close surface — the Nutrition plan drawer — that a
 * Journey block can deep-link OPEN, plus the trip back.
 *
 * Two properties carry the whole design, and both are bugs if dropped:
 *
 * 1. **Consume in an effect, once.** The strip is a router write, so it cannot
 *    run during render; the `consumed` ref keeps the effect from re-running
 *    against the params it already handled before the stripped URL commits.
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
    // Closing without a save ABANDONS the trip, and a hand open starts a fresh
    // one: either way nothing may ride on to the next save.
    setReturnBlockId(null);
  }, []);

  return { open, setOpen, returnBlockId };
}

/**
 * The trip's other half for an ADDRESSED surface — the Training apply tray,
 * whose open state is `?apply=1` and never local. Only the return target is
 * one-shot here: on arrival with the trip the block is captured and the two
 * return params are stripped, and `?apply=1` stays as the tray's address. The
 * block survives the pick and the editor's arrow (both replace the address; the
 * state is untouched) and the host clears it on the X and on a hand open, so a
 * trip left behind cannot bounce a later, unrelated apply back to Journey.
 */
export function useJourneyReturnBlock(surface: JourneyTripSurface): {
  returnBlockId: string | null;
  clearReturnBlock: () => void;
} {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [returnBlockId, setReturnBlockId] = useState<string | null>(null);
  const consumed = useRef(false);

  useEffect(() => {
    if (consumed.current) return;
    const trip = readJourneyTrip(searchParams, surface);
    const stripped = stripJourneyReturn(searchParams.toString());
    if (!trip.open || stripped === searchParams.toString()) return;
    consumed.current = true;
    setReturnBlockId(trip.returnBlockId);
    router.replace(`?${stripped}`, { scroll: false });
  }, [searchParams, router, surface]);

  const clearReturnBlock = useCallback(() => setReturnBlockId(null), []);

  return { returnBlockId, clearReturnBlock };
}
