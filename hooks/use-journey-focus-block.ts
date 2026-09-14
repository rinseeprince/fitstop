"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * The Blocks pane's half of the Journey round trip: a save lands on
 * `?journey=blocks&block=<id>`, and the card it names opens instead of the
 * current block. The param is ONE-SHOT — the block's expansion is a local
 * view, not an address — so it is consumed at mount, which is the arrival
 * (the tab and the pane both derive from the URL, so the param is present on
 * the first render), held in state for the cards that mount once the blocks
 * read lands, and stripped by a replace so no later return to the pane
 * re-opens the trip's block.
 */
export function useJourneyFocusBlock(): string | null {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [focusBlockId] = useState(() => searchParams.get("block"));

  useEffect(() => {
    if (searchParams.get("block") === null) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("block");
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  return focusBlockId;
}
