"use client"

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import {
  MONO_META_CLASS,
  SECTION_LABEL_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens"

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
    // min-h pins the row to the calendar toolbars' natural height (Today
    // button: 11px x 1.5 line-height + py-1 = 24.5px) so the centered hairline
    // sits at the same offset on every surface, whatever the row's contents.
    <div className="mb-3 flex min-h-[24.5px] items-center gap-3">
      <span className={cn("whitespace-nowrap", SECTION_LABEL_CLASS)}>
        {label}
      </span>
      <div className="h-px flex-1 bg-[rgba(13,148,136,0.08)]" />
      {meta && (
        <span className={cn("whitespace-nowrap text-[11px]", MONO_META_CLASS)}>
          {meta}
        </span>
      )}
      {actions}
    </div>
  )
}
