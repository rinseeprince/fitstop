"use client"

import { cn } from "@/lib/utils"

// Dark KPI band for the library pages — the established dark summary-card
// pattern (model: check-in/kpi-ribbon.tsx), minus the status dots: library
// stats are descriptive, not statuses. Adapts to the number of cells.
export type StatBandCell = {
  label: string
  value: string
  unit?: string
  sub?: string
  subTone?: "neutral" | "warn" | "up"
  valueMuted?: boolean
}

const SUB_TONE_CLASS: Record<NonNullable<StatBandCell["subTone"]>, string> = {
  neutral: "text-[rgba(255,255,255,0.3)]",
  warn: "text-[#d97706]",
  up: "text-[#0d9488]",
}

// Static classes so Tailwind's JIT picks them up (no dynamic grid-cols-${n}).
const GRID_COLS: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
}

export function StatBand({ cells }: { cells: StatBandCell[] }) {
  return (
    <div
      className={cn(
        "bg-[#0f2027] rounded-[6px] p-5 grid animate-card-in",
        GRID_COLS[cells.length] ?? "grid-cols-4",
      )}
      data-slot="stat-band"
    >
      {cells.map((cell, i) => (
        <div
          key={cell.label}
          className={cn(
            "flex flex-col pl-5 pr-5",
            i < cells.length - 1 && "border-r border-[rgba(255,255,255,0.07)]",
          )}
        >
          <span className="text-[10px] uppercase tracking-[0.06em] text-[rgba(255,255,255,0.35)] font-medium">
            {cell.label}
          </span>
          <div className="flex items-baseline gap-1 mt-1.5">
            {cell.valueMuted ? (
              <span className="text-[13px] text-[rgba(255,255,255,0.3)]">
                {cell.value}
              </span>
            ) : (
              <span className="text-[24px] font-bold font-mono-display text-white leading-tight">
                {cell.value}
              </span>
            )}
            {cell.unit && (
              <span className="text-[10px] text-[rgba(255,255,255,0.3)]">
                {cell.unit}
              </span>
            )}
          </div>
          {cell.sub && (
            <span
              className={cn(
                "text-[10px] font-mono-display mt-1",
                SUB_TONE_CLASS[cell.subTone ?? "neutral"],
              )}
            >
              {cell.sub}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
