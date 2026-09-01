"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { OPEN_PROFILE_EDITOR_PARAM } from "@/lib/client-tabs";

/**
 * The Overview's half of a one-shot trip: another tab sent the coach here to
 * edit the client's profile, and this opens that sheet on arrival.
 *
 * The same two properties `useJourneyRoundTrip` documents, and both are bugs if
 * dropped:
 *
 * 1. **Consume on ARRIVAL, not at mount.** The param is not in the URL when
 *    this tab mounts — `handleTabChange` flips `activeTab` before
 *    `router.replace` lands, so the tab renders once against the previous tab's
 *    query and the param arrives a render later. A `useState` initializer reads
 *    too early and sees nothing.
 *
 * 2. **Strip it.** The whole query rides across every tab change, and Radix
 *    unmounts an inactive `TabsContent`, so every visit is a fresh mount — a
 *    param left in the URL re-opens the sheet on every later return to the
 *    Overview, including one the coach makes by hand.
 *
 * Narrower than `useJourneyRoundTrip` on purpose: there is no return leg, and
 * the destination is a single sheet rather than one of several surfaces.
 */
export function useProfileEditorTrip(onOpen: () => void): void {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  // Guards the window between consuming and the stripped URL committing, in
  // which this effect can re-run against the param it already handled — and
  // re-open a sheet the coach has closed in the meantime.
  const consumed = useRef(false);

  useEffect(() => {
    if (consumed.current) return;
    if (searchParams.get(OPEN_PROFILE_EDITOR_PARAM) !== "1") return;

    consumed.current = true;
    onOpen();

    const next = new URLSearchParams(searchParams.toString());
    next.delete(OPEN_PROFILE_EDITOR_PARAM);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [searchParams, pathname, router, onOpen]);
}
