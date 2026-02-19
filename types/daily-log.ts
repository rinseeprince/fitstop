// Daily log types for wellness and nutrition tracking

export type NutritionAdherenceStatus = "hit" | "partial" | "missed";

// Full daily log record from database
export type DailyLog = {
  id: string;
  clientId: string;
  date: string; // ISO date string (YYYY-MM-DD)
  
  // Subjective metrics
  mood?: number; // 1-5
  energy?: number; // 1-10
  sleep?: number; // 1-10
  stress?: number; // 1-10
  notes?: string;
  
  // Training tracking
  trained?: boolean;
  trainingSessionId?: string;
  trainingData?: {
    sessionCompleted: boolean;
    trainingSessionId: string | null;
    isAlternativeSession: boolean;
    activityStatuses: Record<string, boolean>;
    unplannedActivities: Array<{
      activityName: string;
      intensityLevel: string;
      durationMinutes: number;
    }>;
  } | null;
  
  // Nutrition tracking
  caloriesConsumed?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  targetCalories?: number;
  targetProteinG?: number;
  targetCarbsG?: number;
  targetFatG?: number;
  nutritionAdherence?: NutritionAdherenceStatus;
  calorieSurplusDeficit?: number;
  
  // Timestamps
  createdAt: string;
  updatedAt: string;
};

// Input type for creating/updating daily logs (client-facing)
export type DailyLogInput = {
  date: string; // ISO date string (YYYY-MM-DD)
  
  // Subjective metrics
  mood?: number; // 1-5
  energy?: number; // 1-10
  sleep?: number; // 1-10
  stress?: number; // 1-10
  notes?: string;
  
  // Training tracking
  trained?: boolean;
  trainingSessionId?: string;
  trainingData?: {
    sessionCompleted: boolean;
    trainingSessionId: string | null;
    isAlternativeSession: boolean;
    activityStatuses: Record<string, boolean>;
    unplannedActivities: Array<{
      activityName: string;
      intensityLevel: string;
      durationMinutes: number;
    }>;
  } | null;
  
  // Nutrition tracking (optional - client may log wellness without calories)
  caloriesConsumed?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
};