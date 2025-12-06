import OpenAI from "openai";
import type {
  IntensityLevel,
  ActivityAnalysis,
  ActivitySuggestion,
  MuscleGroup,
} from "@/types/external-activity";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const ACTIVITY_ANALYSIS_SYSTEM_PROMPT = `You are a sports science expert analyzing physical activities for calorie burn and recovery impact.

Given an activity name and intensity level, provide:
1. MET value (metabolic equivalent) for the activity at that intensity
2. Primary muscle groups used
3. Estimated recovery time in hours
4. Brief recovery impact description
5. Training recommendations for the next 24-48 hours

IMPORTANT: Always respond with valid JSON only - no markdown, no code blocks.

The JSON must follow this exact structure:
{
  "metValue": number (typically 3-15 for most activities),
  "muscleGroupsImpacted": ["legs", "back", "chest", "shoulders", "arms", "core", "cardio", "grip", "full_body"],
  "recoveryHours": number (typically 12-48),
  "recoveryImpact": "Brief description of how this activity affects training recovery",
  "trainingRecommendations": ["Array of specific recommendations for training around this activity"]
}

MET Reference Values:
- Light activities (walking, stretching): 2-4 MET
- Moderate activities (brisk walking, cycling): 4-6 MET
- Vigorous activities (running, sports): 6-10 MET
- Very vigorous (sprinting, HIIT): 10-15 MET

Intensity adjustments:
- "low" intensity: Use base/lower MET value
- "moderate" intensity: Use typical MET value
- "vigorous" intensity: Use higher MET value (add 2-4 to base)`;

/**
 * Calculate calories burned using MET formula
 * Calories = MET × weight (kg) × duration (hours)
 */
export const calculateCaloriesFromMET = (
  metValue: number,
  weightKg: number,
  durationMinutes: number
): number => {
  const durationHours = durationMinutes / 60;
  return Math.round(metValue * weightKg * durationHours);
};

/**
 * Get MET value for a known activity at given intensity
 */
export const getMETValueForIntensity = (
  activity: ActivitySuggestion,
  intensity: IntensityLevel
): number => {
  switch (intensity) {
    case "low":
      return activity.defaultMetLow;
    case "moderate":
      return activity.defaultMetModerate;
    case "vigorous":
      return activity.defaultMetVigorous;
    default:
      return activity.defaultMetModerate;
  }
};

/**
 * Generate activity analysis for known activities (using stored data)
 */
export const analyzeKnownActivity = (
  activity: ActivitySuggestion,
  intensityLevel: IntensityLevel,
  durationMinutes: number,
  clientWeightKg: number
): ActivityAnalysis => {
  const metValue = getMETValueForIntensity(activity, intensityLevel);
  const estimatedCalories = calculateCaloriesFromMET(
    metValue,
    clientWeightKg,
    durationMinutes
  );

  // Calculate recovery hours based on intensity and duration
  const baseRecoveryHours =
    intensityLevel === "low" ? 12 : intensityLevel === "moderate" ? 18 : 24;
  const durationFactor = Math.min(durationMinutes / 60, 2);
  const recoveryHours = Math.round(baseRecoveryHours * (0.8 + durationFactor * 0.2));

  // Generate recommendations based on muscle groups
  const recommendations = generateRecommendations(
    activity.muscleGroupsImpacted,
    intensityLevel
  );

  return {
    estimatedCalories,
    metValue,
    recoveryImpact: activity.recoveryNotes || generateRecoveryImpact(activity, intensityLevel),
    recoveryHours,
    muscleGroupsImpacted: activity.muscleGroupsImpacted,
    trainingRecommendations: recommendations,
  };
};

/**
 * Generate recovery impact text for known activities
 */
const generateRecoveryImpact = (
  activity: ActivitySuggestion,
  intensity: IntensityLevel
): string => {
  const intensityText =
    intensity === "low" ? "Light" : intensity === "moderate" ? "Moderate" : "High";
  const muscleText = activity.muscleGroupsImpacted.slice(0, 3).join(", ");
  return `${intensityText} impact on ${muscleText}. Plan training accordingly.`;
};

/**
 * Generate training recommendations based on muscle groups
 */
const generateRecommendations = (
  muscleGroups: MuscleGroup[],
  intensity: IntensityLevel
): string[] => {
  const recommendations: string[] = [];

  if (intensity === "vigorous") {
    recommendations.push("Allow adequate recovery before next intense session");
  }

  if (muscleGroups.includes("legs")) {
    recommendations.push(
      intensity === "vigorous"
        ? "Consider reducing leg volume or moving leg day"
        : "Monitor leg fatigue during lower body training"
    );
  }

  if (muscleGroups.includes("shoulders") || muscleGroups.includes("arms")) {
    recommendations.push("Watch for upper body fatigue in push/pull sessions");
  }

  if (muscleGroups.includes("cardio")) {
    recommendations.push("Factor cardio work into overall training volume");
  }

  if (muscleGroups.includes("back") || muscleGroups.includes("grip")) {
    recommendations.push("May impact pulling exercises and grip strength");
  }

  if (recommendations.length === 0) {
    recommendations.push("This activity should have minimal impact on training");
  }

  return recommendations;
};

/**
 * Generate activity analysis using AI for unknown activities
 */
export const analyzeUnknownActivityAI = async (
  activityName: string,
  intensityLevel: IntensityLevel,
  durationMinutes: number,
  clientWeightKg: number
): Promise<ActivityAnalysis> => {
  const prompt = `Analyze this physical activity:
- Activity: ${activityName}
- Intensity: ${intensityLevel}
- Duration: ${durationMinutes} minutes
- Client weight: ${clientWeightKg} kg

Provide MET value, muscle groups, recovery impact, and training recommendations.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: ACTIVITY_ANALYSIS_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    temperature: 0.3,
    max_tokens: 500,
    response_format: { type: "json_object" },
  });

  const rawResponse = completion.choices[0]?.message?.content || "";

  try {
    const aiResponse = JSON.parse(rawResponse) as {
      metValue: number;
      muscleGroupsImpacted: MuscleGroup[];
      recoveryHours: number;
      recoveryImpact: string;
      trainingRecommendations: string[];
    };

    // Validate and bound MET value
    const metValue = Math.max(1.5, Math.min(15, aiResponse.metValue || 5));
    const estimatedCalories = calculateCaloriesFromMET(
      metValue,
      clientWeightKg,
      durationMinutes
    );

    return {
      estimatedCalories,
      metValue,
      recoveryImpact: aiResponse.recoveryImpact || "Activity analyzed. Plan recovery accordingly.",
      recoveryHours: Math.max(12, Math.min(72, aiResponse.recoveryHours || 24)),
      muscleGroupsImpacted: aiResponse.muscleGroupsImpacted || ["full_body"],
      trainingRecommendations: aiResponse.trainingRecommendations || [
        "Monitor fatigue levels in subsequent training",
      ],
    };
  } catch (error) {
    console.error("Failed to parse AI activity analysis:", error);
    // Return sensible defaults based on intensity
    const defaultMet = intensityLevel === "low" ? 4 : intensityLevel === "moderate" ? 6 : 8;
    return {
      estimatedCalories: calculateCaloriesFromMET(defaultMet, clientWeightKg, durationMinutes),
      metValue: defaultMet,
      recoveryImpact: `${activityName} at ${intensityLevel} intensity. Monitor recovery.`,
      recoveryHours: intensityLevel === "vigorous" ? 24 : 18,
      muscleGroupsImpacted: ["full_body", "cardio"],
      trainingRecommendations: ["Monitor fatigue and adjust training as needed"],
    };
  }
};
