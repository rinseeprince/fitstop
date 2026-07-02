"use client"

import type { ReactNode } from "react"

// Uppercase section label + hairline rule + optional right-aligned mono meta
// and action buttons (mockup `seclabel`). Shared by the library pages and the
// builder's Schedule header. Type scale matches the app-wide divider labels
// (TRAINING LOG / PHASES: 10.5px, 0.07em, #93b0b4) — keep them in lockstep.
export function SectionLabel({
  label,
  meta,
  actions,
}: {
  label: string
  meta?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <span className="whitespace-nowrap text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[#93b0b4]">
        {label}
      </span>
      <div className="h-px flex-1 bg-[rgba(13,148,136,0.08)]" />
      {meta && (
        <span className="whitespace-nowrap font-mono-display text-[11px] text-[#93b0b4]">
          {meta}
        </span>
      )}
      {actions}
    </div>
  )
}
