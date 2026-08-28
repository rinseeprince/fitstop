"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { containsDigit } from "@/components/clients/metrics/metrics-format";
import {
  CHIP_NEUTRAL_CLASS,
  LABEL_CLASS,
  MONO,
  MONO_META_CLASS,
  THUMB_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";

// Shared Teal-Summit recipes for the coach Overview's six sections. Every card
// here composes these rather than retyping class strings, so a spacing or tone
// change lands in one place.

/** Inner hairline between a card's header and body, or between stat cells. */
export const CARD_HAIRLINE = "border-[rgba(13,148,136,0.06)]";

/** White card on the #f4f7f6 page — spacing separates them, so no border. */
export function OverviewCard({
  children,
  className,
  animationDelay,
}: {
  children: ReactNode;
  className?: string;
  animationDelay?: string;
}) {
  return (
    <div
      className={cn("flex flex-col rounded-[6px] bg-white animate-card-in", className)}
      style={animationDelay ? { animationDelay } : undefined}
    >
      {children}
    </div>
  );
}

/**
 * Card header: optional teal thumb, title, optional right slot.
 * `compact` drops the title to the 13px card-title tier (used where the title
 * is a data name — a plan name — rather than a section heading).
 */
export function CardHeader({
  icon,
  title,
  subtitle,
  right,
  compact,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  right?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-5 pb-3 pt-5">
      {icon && <span className={cn(THUMB_CLASS, "h-8 w-8")}>{icon}</span>}
      <div className="min-w-0 flex-1">
        <h3
          className={cn(
            "truncate font-semibold text-[#0c1a1e]",
            compact ? "text-[13px]" : "text-[15px]"
          )}
        >
          {title}
        </h3>
        {subtitle}
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  );
}

/**
 * The quiet teal text action.
 *
 * Exported as a string because two different buttons wear it: a destination
 * link (`OpenTabLink`) and the notes card's Save, which sits beside one and has
 * to be indistinguishable from it. Copying the treatment across would be two
 * strings that agree until one of them is edited.
 */
export const TEXT_ACTION_CLASS =
  "shrink-0 text-[11px] font-medium text-[#0d9488] transition-colors hover:text-[#0b7f75]";

/** Quiet teal text link that sends the coach to the tab that owns the data. */
export function OpenTabLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={TEXT_ACTION_CLASS}>
      {label}
    </button>
  );
}

/**
 * A mono datum sitting inside a sans line ("Starts <date>", "Next check-in due
 * <date>").
 *
 * Owns its own leading gap of one monospace character, and the call site must
 * NOT also put a space before it. A literal space there is rendered in the sans
 * run (~3.5px at 13px) while the datum's own internal spaces are JetBrains
 * Mono's (~7.8px) — so the label reads as glued to the value while the value
 * looks airy. `ch` resolves against this span's own font, so the gap always
 * matches the datum's rhythm whatever the size.
 */
export function InlineMono({ children }: { children: ReactNode }) {
  return <span className={cn(MONO, "ml-[1ch]")}>{children}</span>;
}

/** Neutral chip; digit-bearing text renders mono, word-only text sans. */
export function NeutralChip({ children }: { children: string }) {
  return (
    <span className={cn(CHIP_NEUTRAL_CLASS, containsDigit(children) && MONO)}>{children}</span>
  );
}

export type StatCellData = {
  label: string;
  /** Rendered value; null shows the muted em-dash. */
  value: string | null;
  /** Set when the value is a NAME rather than a datum (session name). */
  valueIsName?: boolean;
  unit?: string;
  sub?: string;
  /** Sub-line carries a numeral → mono. Word-only sub-lines stay sans. */
  subIsNumeric?: boolean;
};

// Static classes so Tailwind's JIT emits them (no dynamic grid-cols-${n}).
const STRIP_COLS: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
};

/** Hairline-separated stat columns — the white-card echo of the dark hero band. */
export function StatStrip({ cells }: { cells: StatCellData[] }) {
  return (
    <div className={cn("grid px-5 py-4", STRIP_COLS[cells.length] ?? "grid-cols-3")}>
      {cells.map((cell, i) => (
        <div
          key={cell.label}
          className={cn(
            "flex min-w-0 flex-col",
            i > 0 && "pl-4",
            i < cells.length - 1 && cn("border-r pr-4", CARD_HAIRLINE)
          )}
        >
          <span className={LABEL_CLASS}>{cell.label}</span>
          {cell.value === null ? (
            <span className="mt-1 text-[18px] font-semibold text-[#93b0b4]">—</span>
          ) : cell.valueIsName ? (
            <span className="mt-1 truncate text-[13px] font-semibold text-[#0c1a1e]">
              {cell.value}
            </span>
          ) : (
            <span className={cn(MONO, "mt-1 truncate text-[18px] font-semibold text-[#0c1a1e]")}>
              {cell.value}
              {cell.unit && (
                <span className="ml-1 text-[11px] font-normal text-[#93b0b4]">{cell.unit}</span>
              )}
            </span>
          )}
          {cell.sub && (
            <span
              className={cn(
                "mt-1 truncate text-[11px]",
                cell.subIsNumeric ? MONO_META_CLASS : "text-[#93b0b4]"
              )}
            >
              {cell.sub}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * The card body shown when a client has nothing of this kind yet: names what is
 * missing, says what it unlocks, and offers the one action that fixes it.
 */
export function EmptyInvite({
  icon,
  title,
  hint,
  actionLabel,
  onAction,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-5 py-10 text-center">
      <span className="text-[#93b0b4] opacity-50">{icon}</span>
      <p className="mt-2 text-sm text-[#5a7d82]">{title}</p>
      <p className="mt-1 text-xs text-[#93b0b4]">{hint}</p>
      <button
        type="button"
        onClick={onAction}
        className="mt-3 inline-flex items-center gap-1.5 rounded-[6px] bg-[#0d9488] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#0b7f75]"
      >
        {actionLabel}
      </button>
    </div>
  );
}
