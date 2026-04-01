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
      <h3 className="text-[15px] font-semibold text-[#0c1a1e] mb-3">{title}</h3>
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
