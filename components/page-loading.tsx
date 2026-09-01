import { Loader2 } from "lucide-react"

/**
 * The page/tab initial-load treatment — one spec, platform-wide
 * (docs/newdesignsystem.md → "Loading & async states"): the standard spinner
 * with a VISIBLE label naming what is loading. A bare spinner says something
 * is happening but not what; sr-only labels satisfied nobody's eyes.
 */
export function PageLoading({ label }: { label: string }) {
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center gap-3 py-24"
    >
      <Loader2 className="h-6 w-6 animate-spin text-[#93b0b4]" strokeWidth={1.5} />
      <p className="text-[13px] text-[#93b0b4]">{label}</p>
    </div>
  )
}
