"use client";

import { Sparkles, X } from "lucide-react";
import { SheetClose } from "@/components/ui/sheet";
import { UnitToggle } from "../../shared/unit-toggle";
import type { UnitPreference } from "@/types/check-in";

type DrawerHeaderProps = {
  hasPlan: boolean;
  title: string;
  calorieTarget?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  unitPreference: UnitPreference;
  onUnitChange: (value: UnitPreference) => void;
  isSavingUnit?: boolean;
};

export function DrawerHeader({
  hasPlan,
  title,
  calorieTarget,
  proteinG,
  carbsG,
  fatG,
  unitPreference,
  onUnitChange,
  isSavingUnit,
}: DrawerHeaderProps) {
  return (
    <div className="bg-[#0f2027] px-6 pt-5 pb-5 flex-shrink-0">
      {/* Top row: icon + title + close */}
      <div className="flex items-start gap-3">
        <div className="w-[28px] h-[28px] rounded-[6px] bg-[rgba(13,148,136,0.15)] flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-[15px] h-[15px] text-[#0d9488]" strokeWidth={1.5} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[16px] font-bold text-white leading-tight">
            {title}
          </h2>
          <p className="text-[12px] text-[rgba(255,255,255,0.4)] mt-1 leading-[1.4]">
            Recalculate macros from updated parameters. This replaces the current
            targets from the effective date forward.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <UnitToggle
            size="sm"
            value={unitPreference}
            onChange={onUnitChange}
            disabled={isSavingUnit}
          />
          <SheetClose className="w-[32px] h-[32px] rounded-[6px] bg-[rgba(255,255,255,0.06)] flex items-center justify-center hover:bg-[rgba(255,255,255,0.1)] transition-colors">
            <X className="w-4 h-4 text-[rgba(255,255,255,0.5)]" strokeWidth={1.5} />
            <span className="sr-only">Close</span>
          </SheetClose>
        </div>
      </div>

      {/* Current plan summary strip */}
      {hasPlan && calorieTarget != null && (
        <div className="mt-4 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)] rounded-[6px] px-4 py-3 flex items-center gap-4">
          <span className="font-mono-display text-[15px] font-bold text-white">
            {calorieTarget}
            <span className="text-[11px] font-normal text-[rgba(255,255,255,0.4)] ml-1">
              kcal/day
            </span>
          </span>
          <div className="flex items-center gap-3 ml-auto">
            <MacroDot color="#2d8fb5" label="P" value={proteinG} />
            <MacroDot color="#c8923a" label="C" value={carbsG} />
            <MacroDot color="#c06060" label="F" value={fatG} />
          </div>
        </div>
      )}
    </div>
  );
}

function MacroDot({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value?: number;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="w-[6px] h-[6px] rounded-full flex-shrink-0"
        style={{ backgroundColor: color }}
      />
      <span className="font-mono-display text-[12px] text-[rgba(255,255,255,0.7)]">
        {label} {value ?? 0}g
      </span>
    </span>
  );
}
