// Wellness metric thresholds — the single source for "which values read as good",
// including the stress/soreness inversion (lower is better). Every wellness
// surface derives its tone from here so no two of them can disagree about
// whether a 7 is a good day.

export type WellnessMetric = "mood" | "energy" | "sleep" | "stress" | "soreness";

/**
 * Teal-Summit two-colour status: teal good, amber attention (no red — the
 * system has no filled destructive tone). "none" = no value logged.
 */
export type WellnessTone = "good" | "attention" | "none";

/**
 * Hex per tone, for SVG fills/strokes that cannot take a Tailwind class.
 * Class-based consumers map the tone themselves so the label gate still sees
 * their literals (scripts/check-labels.ts scans app/ and components/ only).
 */
export const WELLNESS_TONE_COLOR: Record<WellnessTone, string> = {
  good: "#0d9488",
  attention: "#d97706",
  none: "rgba(13,148,136,0.12)",
};

export const getWellnessTone = (
  metric: WellnessMetric,
  value: number | null | undefined
): WellnessTone => {
  if (value === null || value === undefined) return "none";

  switch (metric) {
    case "mood":
      return value >= 4 ? "good" : "attention";

    case "energy":
    case "sleep":
      return value >= 7 ? "good" : "attention";

    case "stress":
    case "soreness":
      // Inverted — lower is better.
      return value <= 3 ? "good" : "attention";

    default:
      return "none";
  }
};
