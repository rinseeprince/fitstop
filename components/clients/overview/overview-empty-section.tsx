"use client"

import type { LucideIcon } from "lucide-react"

interface OverviewEmptySectionProps {
  title: string
  primaryMessage: string
  secondaryMessage?: string
  icon?: LucideIcon
}

export function OverviewEmptySection({
  title,
  primaryMessage,
  secondaryMessage,
  icon: Icon,
}: OverviewEmptySectionProps) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <span className="text-[10.5px] uppercase tracking-[0.07em] text-[#93b0b4] font-semibold whitespace-nowrap">
          {title}
        </span>
        <div className="flex-1 h-px bg-[rgba(13,148,136,0.08)]" />
      </div>
      <div className="bg-white rounded-[6px] p-8 text-center animate-card-in">
        {Icon && (
          <Icon className="h-8 w-8 text-[#93b0b4] mx-auto mb-3" strokeWidth={1.5} />
        )}
        <p className="text-[13px] font-medium text-[#5a7d82]">{primaryMessage}</p>
        {secondaryMessage && (
          <p className="text-[12px] text-[#93b0b4] mt-1">{secondaryMessage}</p>
        )}
      </div>
    </div>
  )
}
