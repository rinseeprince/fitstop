"use client"

import type { ComponentType, MouseEvent } from "react"
import { cn } from "@/lib/utils"

export type RowAction = {
  label: string
  icon: ComponentType<{ className?: string; strokeWidth?: number }>
  onClick: () => void
  danger?: boolean
}

// Hover-revealed action cluster for table rows. Rows must carry the
// `group/row` class; clicks stop propagation so the row's own click
// (open) never fires.
export function RowActions({ actions }: { actions: RowAction[] }) {
  const handle = (e: MouseEvent, action: RowAction) => {
    e.stopPropagation()
    action.onClick()
  }

  return (
    <div className="flex justify-end gap-0.5 opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 focus-within:opacity-100">
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          title={action.label}
          aria-label={action.label}
          onClick={(e) => handle(e, action)}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-[6px] text-[#93b0b4] transition-colors duration-150",
            action.danger
              ? "hover:bg-[rgba(192,96,96,0.08)] hover:text-[#c06060]"
              : "hover:bg-[#f0f5f4] hover:text-[#5a7d82]",
          )}
        >
          <action.icon className="h-[15px] w-[15px]" strokeWidth={1.5} />
        </button>
      ))}
    </div>
  )
}
