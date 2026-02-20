import type { CalorieFeedback } from "@/utils/nutrition-tracking-helpers";

export function getFeedbackText(feedback: CalorieFeedback, isCalories: boolean = false): string {
  if (feedback.direction === "exact") {
    return "Perfect!";
  }
  const prefix = feedback.direction === "over" ? "+" : "-";
  const value = feedback.difference;
  const unit = isCalories ? " cal" : "g";
  const suffix = feedback.direction === "over" ? " over target" : " under target";
  return `${prefix}${value}${unit}${suffix}`;
}

export function getFeedbackColor(colour: string): string {
  switch (colour) {
    case "green": return "text-green-600";
    case "amber": return "text-amber-600";
    case "red": return "text-red-600";
    default: return "text-muted-foreground";
  }
}