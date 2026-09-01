import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/**
 * Pending text that cannot change a layout. It renders INSIDE the real text
 * element, as an inline block shorter than the line box, so the element's own
 * font metrics (the strut) fix the height — pending and loaded are the same
 * size by construction, never by a hand-measured slot
 * (docs/newdesignsystem.md → "Loading & async states"). Width comes from the
 * call site; the fill defaults to the dark bands' white/10.
 */
export function TextSkeleton({ className }: { className?: string }) {
  return (
    <Skeleton
      className={cn(
        "inline-block h-[0.7em] w-16 align-middle rounded-[4px] bg-white/10",
        className
      )}
    />
  )
}
