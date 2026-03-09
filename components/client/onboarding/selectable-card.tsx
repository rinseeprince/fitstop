"use client"

import { cn } from "@/lib/utils"

type SelectableCardProps = {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
}

export function SelectableCard({
  selected,
  onClick,
  children,
  className,
}: SelectableCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-center",
        "min-h-[44px] cursor-pointer transition-all duration-200",
        selected
          ? "border-primary bg-primary/5 ring-1 ring-primary/20"
          : "border-border hover:border-primary/50",
        className
      )}
    >
      {children}
    </button>
  )
}
