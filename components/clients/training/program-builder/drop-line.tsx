"use client";

import { cn } from "@/lib/utils";

// Where a dragged exercise or group will land in the session editor's list: a
// 2px teal line centred in the gap before or after a card or group. Drawn
// absolutely, so showing it moves nothing. The list's first card draws its top
// line inside its own edge, where the scroll area would clip one above it.
export type DropLineEdge =
  | "item-top"
  | "item-bottom"
  | "first-item-top"
  | "member-top"
  | "member-bottom";

const EDGE_CLASS: Record<DropLineEdge, string> = {
  // The list's 8px gap between cards and groups.
  "item-top": "-top-[5px]",
  "item-bottom": "-bottom-[5px]",
  "first-item-top": "top-0",
  // A rail's 10px gap between its cards.
  "member-top": "-top-[6px]",
  "member-bottom": "-bottom-[6px]",
};

export function DropLine({ edge }: { edge: DropLineEdge }) {
  return (
    <span
      aria-hidden
      data-testid="drop-line"
      className={cn(
        "pointer-events-none absolute inset-x-0 z-20 h-0.5 rounded-[1px] bg-[#0d9488]",
        EDGE_CLASS[edge],
      )}
    />
  );
}
