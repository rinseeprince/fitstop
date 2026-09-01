import { cn } from "@/lib/utils"

/**
 * Pending text that cannot change a layout. It renders INSIDE the real text
 * element, as an inline block shorter than the line box, so the element's own
 * font metrics (the strut) fix the height — pending and loaded are the same
 * size by construction, never by a hand-measured slot
 * (docs/newdesignsystem.md → "Loading & async states").
 *
 * A SPAN, deliberately, not the shared <Skeleton> (a div): this sits inside
 * <p> and <span> elements, and the HTML parser closes a <p> at the first flow
 * element — React 19 flags exactly that as a hydration hazard. Phrasing
 * content is the load-bearing half of this component's contract, and its test
 * pins it. Width comes from the call site; the fill defaults to the dark
 * bands' white/10.
 */
export function TextSkeleton({ className }: { className?: string }) {
  return (
    <span
      data-slot="skeleton"
      className={cn(
        "inline-block h-[0.7em] w-16 animate-pulse rounded-[4px] bg-white/10 align-middle",
        className
      )}
    />
  )
}
