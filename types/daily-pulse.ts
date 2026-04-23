export type IntensityLevel = "low" | "moderate" | "vigorous";

export type UnplannedActivity = {
  activityName: string;
  intensityLevel: IntensityLevel;
  durationMinutes: number;
};

export type TodaysActivity = {
  sessionId: string;
  activityName: string;
  estimatedCalories: number;
};
