"use client"

// Uppercase section label + hairline rule + optional right-aligned mono
// meta (mockup `seclabel`). Shared by the library pages and the builder's
// Schedule header.
export function SectionLabel({ label, meta }: { label: string; meta?: string }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#5a7d82]">
        {label}
      </span>
      <div className="h-px flex-1 bg-[rgba(13,148,136,0.08)]" />
      {meta && (
        <span className="font-mono-display text-[11px] text-[#93b0b4]">{meta}</span>
      )}
    </div>
  )
}
