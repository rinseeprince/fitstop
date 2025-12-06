import OpenAI from "openai";
import type { TrainingSession, TrainingPlan } from "@/types/training";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const TRAINING_CALORIE_SYSTEM_PROMPT = `You are an exercise physiology expert estimating calorie expenditure for resistance training sessions.

Given session details, estimate total calories burned during the workout including:
1. Active work during sets (higher intensity)
2. Rest periods between sets (elevated but lower intensity)
3. EPOC effect (post-exercise oxygen consumption from resistance training)

Factors to consider:
- Compound movements (squat, deadlift, bench, row) burn significantly more than isolation exercises
- Higher volume (total sets × reps) increases calorie burn
- Higher RPE/intensity targets indicate more effort and calorie burn
- Shorter rest periods increase metabolic demand
- Larger muscle groups (legs, back) burn more than smaller groups (arms)
- More exercises in a session increases total work done

DO NOT factor in session duration - this varies per client. Base estimate on:
- Number of exercises
- Total sets and rep ranges
- Intensity indicators (RPE)
- Muscle groups targeted

Calorie Reference for Weight Training (per session):
- Light session (few exercises, low volume, easy): 150-250 cal
- Moderate session (typical exercises, moderate volume): 250-400 cal
- Hard session (many compound exercises, high volume, high RPE): 400-600 cal
- Very intense session (high volume, heavy compounds, minimal rest): 500-750 cal

IMPORTANT: Always respond with valid JSON only - no markdown, no code blocks.

The JSON must follow this exact structure:
{
  "estimatedCalories": number (typically 150-750 for weight training),
  "intensity": "light" | "moderate" | "hard" | "very_intense",
  "reasoning": "Brief explanation of the estimate"
}`;

export type SessionCalorieEstimate = {
  estimatedCalories: number;
  intensity: "light" | "moderate" | "hard" | "very_intense";
  reasoning: string;
};

/**
 * Estimate calories for a weight training session using AI analysis
 */
export const estimateSessionCalories = async (
  session: TrainingSession,
  clientWeightKg: number
): Promise<SessionCalorieEstimate> => {
  // Skip external activities - they have their own calorie calculation
  if (session.sessionType === "external_activity") {
    return {
      estimatedCalories: session.activityMetadata?.estimatedCalories || 0,
      intensity: "moderate",
      reasoning: "External activity - using MET-based calculation",
    };
  }

  // Build exercise summary for AI
  const exerciseSummary = session.exercises
    .map((e) => {
      const reps = e.repsTarget || (e.repsMin && e.repsMax ? `${e.repsMin}-${e.repsMax}` : "8-12");
      const rpe = e.rpeTarget ? `RPE ${e.rpeTarget}` : "";
      const rest = e.restSeconds ? `${e.restSeconds}s rest` : "";
      return `- ${e.name}: ${e.sets} sets × ${reps} reps ${rpe} ${rest}`.trim();
    })
    .join("\n");

  const prompt = `Estimate calories for this weight training session:

Session: "${session.name}"
Focus: ${session.focus || "General"}
Client Weight: ${clientWeightKg} kg

Exercises (${session.exercises.length} total):
${exerciseSummary || "No exercises defined yet"}

Estimate total calories burned during this workout.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: TRAINING_CALORIE_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 300,
      response_format: { type: "json_object" },
    });

    const rawResponse = completion.choices[0]?.message?.content || "";
    const aiResponse = JSON.parse(rawResponse) as SessionCalorieEstimate;

    // Validate and bound calories
    const estimatedCalories = Math.max(100, Math.min(800, aiResponse.estimatedCalories || 300));

    return {
      estimatedCalories,
      intensity: aiResponse.intensity || "moderate",
      reasoning: aiResponse.reasoning || "AI-estimated based on session details",
    };
  } catch (error) {
    console.error("Failed to estimate session calories:", error);
    // Return sensible default based on exercise count
    const exerciseCount = session.exercises.length;
    const defaultCalories = Math.min(150 + exerciseCount * 40, 500);
    return {
      estimatedCalories: defaultCalories,
      intensity: exerciseCount > 6 ? "hard" : "moderate",
      reasoning: "Default estimate based on exercise count",
    };
  }
};

/**
 * Calculate total weekly training calories from a plan
 * Includes both training sessions and external activities
 */
export const calculateWeeklyTrainingCalories = (plan: TrainingPlan | null): number => {
  if (!plan) return 0;

  return plan.sessions.reduce((sum, session) => {
    if (session.sessionType === "training") {
      return sum + (session.estimatedCalories || 0);
    }
    if (session.sessionType === "external_activity") {
      return sum + (session.activityMetadata?.estimatedCalories || 0);
    }
    return sum;
  }, 0);
};

/**
 * Calculate daily average training calories from a plan
 */
export const calculateDailyTrainingCalories = (plan: TrainingPlan | null): number => {
  const weekly = calculateWeeklyTrainingCalories(plan);
  return Math.round(weekly / 7);
};

/**
 * Get calorie breakdown by day of week
 */
export const getTrainingCaloriesByDay = (
  plan: TrainingPlan | null
): Record<string, number> => {
  const byDay: Record<string, number> = {
    monday: 0,
    tuesday: 0,
    wednesday: 0,
    thursday: 0,
    friday: 0,
    saturday: 0,
    sunday: 0,
  };

  if (!plan) return byDay;

  plan.sessions.forEach((session) => {
    const day = session.dayOfWeek?.toLowerCase();
    if (day && day in byDay) {
      if (session.sessionType === "training") {
        byDay[day] += session.estimatedCalories || 0;
      } else if (session.sessionType === "external_activity") {
        byDay[day] += session.activityMetadata?.estimatedCalories || 0;
      }
    }
  });

  return byDay;
};
