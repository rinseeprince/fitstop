// Daily external activity tracking types

// Full daily external activity record from database
export type DailyExternalActivity = {
  id: string;
  clientId: string;
  date: string; // ISO date string (YYYY-MM-DD)
  activityName: string;
  intensityLevel: "low" | "moderate" | "vigorous";
  durationMinutes: number;
  estimatedCalories?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

// Input type for client adding external activity
export type DailyExternalActivityInput = {
  date: string; // ISO date string (YYYY-MM-DD)
  activityName: string;
  intensityLevel: "low" | "moderate" | "vigorous";
  durationMinutes: number;
  estimatedCalories?: number;
  notes?: string;
};