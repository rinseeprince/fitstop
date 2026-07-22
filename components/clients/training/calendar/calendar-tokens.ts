import { Ban, Check, Dumbbell, Minus, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { TrainingEventStatus } from "@/types/training";
import type { PhaseStatus } from "@/types/roadmap";

// Teal-Summit tokens for the Plans-subtab month calendar. Same role as
// program-builder/builder-tokens.ts, scoped to the real-date calendar: the
// column template, per-phase day tints, and the per-status event thumb map
// that replaces the old raw-Tailwind status dots.

// Shared by the weekday header row and every week row — 42px rail + 7 days,
// mirroring the builder grid's shape (GRID_COLS) at calendar cell widths.
export const CAL_GRID_COLS =
  "grid grid-cols-[42px_repeat(7,minmax(0,1fr))] gap-2";

// Day-cell wash by the phase covering that date. Teal alpha ladder only —
// replaces the old blue (rgba(59,130,246,…)) and slate (rgba(148,163,184,…))
// tints. Skipped phases get no tint (same as no phase).
export const PHASE_TINT: Partial<Record<PhaseStatus, string>> = {
  active: "bg-[rgba(13,148,136,0.06)]",
  planned: "bg-[rgba(13,148,136,0.03)]",
  completed: "bg-[rgba(0,0,0,0.02)]",
};

export type StatusThumbSpec = {
  bg: string;
  icon: LucideIcon;
  iconClass: string;
  strokeWidth: number;
  /** Extra classes on the whole event card (e.g. skipped dims it). */
  cardClass?: string;
};

export const STATUS_THUMB: Record<TrainingEventStatus, StatusThumbSpec> = {
  scheduled: {
    bg: "bg-[rgba(13,148,136,0.08)]",
    icon: Dumbbell,
    iconClass: "text-[#0d9488]",
    strokeWidth: 1.5,
  },
  completed: {
    bg: "bg-[rgba(13,148,136,0.08)]",
    icon: Check,
    iconClass: "text-[#0d9488]",
    strokeWidth: 2,
  },
  partial: {
    bg: "bg-[rgba(245,158,11,0.07)]",
    icon: Minus,
    iconClass: "text-[#d97706]",
    strokeWidth: 1.5,
  },
  missed: {
    bg: "bg-[rgba(192,96,96,0.08)]",
    icon: X,
    iconClass: "text-[#c06060]",
    strokeWidth: 1.5,
  },
  skipped: {
    bg: "bg-[rgba(0,0,0,0.03)]",
    icon: Ban,
    iconClass: "text-[#93b0b4]",
    strokeWidth: 1.5,
    cardClass: "opacity-70",
  },
};
