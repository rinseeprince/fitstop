// Wellness metric color thresholds for consistent visualization across the app

export type WellnessMetric = "mood" | "energy" | "sleep" | "stress" | "soreness";

export const getBarColor = (metric: WellnessMetric, value: number | null): string => {
  if (value === null) return "#e5e7eb"; // Grey for no data
  
  switch (metric) {
    case "mood":
      if (value >= 4) return "#10b981"; // Green
      if (value === 3) return "#f59e0b"; // Amber
      return "#ef4444"; // Red (1-2)
    
    case "energy":
    case "sleep":
      if (value >= 7) return "#10b981"; // Green
      if (value >= 4) return "#f59e0b"; // Amber
      return "#ef4444"; // Red (1-3)
    
    case "stress":
    case "soreness":
      // Inverted - lower is better
      if (value <= 3) return "#10b981"; // Green
      if (value <= 6) return "#f59e0b"; // Amber
      return "#ef4444"; // Red (7-10)

    default:
      return "#e5e7eb";
  }
};