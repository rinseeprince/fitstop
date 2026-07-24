"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { MONO } from "@/components/clients/training/program-builder/builder-tokens";

type BarContent = {
  count: number;
  averageCalories: number | null;
  hasModified: boolean;
};

type NutritionSelectionBarProps = BarContent & {
  /** editMode && selection non-empty — drives mount + rise/drop animation. */
  visible: boolean;
  /** Today's week is in the current view (chip hides otherwise). */
  weekAvailable: boolean;
  trainEmpty: boolean;
  restEmpty: boolean;
  isSaving: boolean;
  onSelectWeek: () => void;
  onSelectTrain: () => void;
  onSelectRest: () => void;
  onRevert: () => void;
  onClear: () => void;
  onEditTargets: () => void;
};

const DIVIDER = <div className="h-4 w-px shrink-0 bg-[rgba(255,255,255,0.07)]" />;

const CHIP_CLASS =
  "rounded-[6px] border border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.08)] px-2.5 py-1 text-[12px] font-medium text-[rgba(255,255,255,0.92)] transition-colors hover:bg-[rgba(255,255,255,0.14)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[rgba(255,255,255,0.08)]";

const QUIET_CLASS =
  "text-[12px] font-medium text-[rgba(255,255,255,0.45)] transition-colors hover:text-white disabled:opacity-50";

/**
 * Floating action bar for the calendar's edit-mode selection. Portaled to
 * <body> (a transformed ancestor would break `fixed` — same hazard the builder
 * portals its DragOverlay for) and layered at z-40: under the edit sheet's
 * z-50 overlay, under z-[100] toasts, above the page.
 */
export function NutritionSelectionBar({
  visible,
  count,
  averageCalories,
  hasModified,
  weekAvailable,
  trainEmpty,
  restEmpty,
  isSaving,
  onSelectWeek,
  onSelectTrain,
  onSelectRest,
  onRevert,
  onClear,
  onEditTargets,
}: NutritionSelectionBarProps) {
  const [rendered, setRendered] = useState(false);
  const [shown, setShown] = useState(false);

  // Latch the display content while the bar drops away so it never flashes
  // "0 selected" mid-fade (the placed-session tray's displayDate pattern).
  const latch = useRef<BarContent>({ count, averageCalories, hasModified });
  useEffect(() => {
    if (visible) latch.current = { count, averageCalories, hasModified };
  });

  useEffect(() => {
    if (visible) {
      setRendered(true);
      // First paint mounts hidden; the next frame flips classes so the
      // opacity/translate transition actually runs.
      const raf = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    const timeout = setTimeout(() => setRendered(false), 180);
    return () => clearTimeout(timeout);
  }, [visible]);

  if (!rendered || typeof document === "undefined") return null;

  const view = visible ? { count, averageCalories, hasModified } : latch.current;

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
      <div
        className={cn(
          "pointer-events-auto flex items-center gap-3 rounded-[6px] bg-[#0f2027] px-4 py-2.5 shadow-[0_12px_40px_rgba(15,32,39,0.35)]",
          "transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none",
          shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
        )}
      >
        <span className="whitespace-nowrap text-[12px]">
          <span className={cn(MONO, "font-semibold text-white")}>{view.count}</span>{" "}
          <span className="text-[rgba(255,255,255,0.35)]">selected</span>
        </span>
        {view.averageCalories != null && (
          <span className={cn(MONO, "whitespace-nowrap text-[12px] text-[rgba(255,255,255,0.4)]")}>
            avg {view.averageCalories.toLocaleString()} kcal
          </span>
        )}

        {DIVIDER}

        {weekAvailable && (
          <button type="button" className={CHIP_CLASS} disabled={isSaving} onClick={onSelectWeek}>
            This week
          </button>
        )}
        <button
          type="button"
          className={CHIP_CLASS}
          disabled={isSaving || trainEmpty}
          title={trainEmpty ? "No editable training days this month" : undefined}
          onClick={onSelectTrain}
        >
          Train days
        </button>
        <button
          type="button"
          className={CHIP_CLASS}
          disabled={isSaving || restEmpty}
          title={restEmpty ? "No editable rest days this month" : undefined}
          onClick={onSelectRest}
        >
          Rest days
        </button>

        {DIVIDER}

        {view.hasModified && (
          <button type="button" className={QUIET_CLASS} disabled={isSaving} onClick={onRevert}>
            Revert to auto
          </button>
        )}
        <button type="button" className={QUIET_CLASS} disabled={isSaving} onClick={onClear}>
          Clear
        </button>

        <button
          type="button"
          className="whitespace-nowrap rounded-[6px] bg-[#0d9488] px-3 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-[#0b7f75] disabled:opacity-50"
          disabled={isSaving}
          onClick={onEditTargets}
        >
          Edit targets
        </button>
      </div>
    </div>,
    document.body
  );
}
