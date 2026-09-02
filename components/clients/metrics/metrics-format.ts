import type { MeasurementSource } from "@/lib/measurements/keys";
import type { Tone } from "./metrics-view-types";

// Small render-side formatting helpers for the Metrics page. Date parsing
// follows the platform's history-table convention (new Date(dateStr) +
// toLocaleDateString en-AU), matching training-history-table.tsx.

/** "+1.2" / "-0.3" / "0.0" — signed change for mono value slots. */
export function formatSigned(value: number, decimals = 1): string {
  const fixed = value.toFixed(decimals);
  return value > 0 && Number(fixed) !== 0 ? `+${fixed}` : fixed;
}

/** "5 Apr" — compact date for stat sub-lines. */
export function formatShortDate(date: string): string {
  return new Date(date).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
  });
}

/** "24 July" — long-month date for the Measurement Log's DATE column. */
export function formatLogDate(date: string): string {
  return new Date(date).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
  });
}

/** "Thursday" — the Measurement Log's DAY column. */
export function formatDayName(date: string): string {
  return new Date(date).toLocaleDateString("en-AU", { weekday: "long" });
}

/** Chip font split: digit-bearing strings render mono, word-only strings sans. */
export function containsDigit(text: string): boolean {
  return /\d/.test(text);
}

/** Direction-aware text colour for trends/deltas. */
export const TONE_TEXT: Record<Tone, string> = {
  good: "text-[#0d9488]",
  bad: "text-[#d97706]",
  neutral: "text-[#93b0b4]",
};

/** How a reading's source reads to a coach, beside its date. */
export const SOURCE_LABELS: Record<MeasurementSource, string> = {
  check_in: "check-in",
  coach_entry: "coach entry",
  client_log: "client log",
  intake: "intake",
};
