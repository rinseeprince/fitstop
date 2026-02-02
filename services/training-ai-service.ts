import OpenAI from "openai";
import type { AITrainingPlanInput, AIGeneratedPlan, TrainingSplitType } from "@/types/training";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const TRAINING_PLAN_SYSTEM_PROMPT = `You are an expert strength and conditioning coach creating personalized training programs.

Your task is to generate detailed, science-based training plans tailored to the client's goals, current fitness level, and constraints.

IMPORTANT: Always respond with valid JSON only - no markdown, no code blocks, just the raw JSON object.

The JSON must follow this exact structure:
{
  "name": "Program Name (e.g., 'Strength & Hypertrophy Program')",
  "description": "Brief 1-2 sentence description of the program approach and goals",
  "splitType": "push_pull_legs" | "upper_lower" | "full_body" | "bro_split" | "push_pull" | "custom",
  "frequencyPerWeek": 3-6,
  "programDurationWeeks": 4-16 (optional, can be null),
  "sessions": [
    {
      "name": "Session Name (e.g., 'Push Day A', 'Upper Body')",
      "dayOfWeek": "monday" | "tuesday" | etc. (optional),
      "focus": "Primary muscle groups or movement patterns",
      "notes": "Session-level coaching notes (optional)",
      "estimatedDurationMinutes": 45-90,
      "exercises": [
        {
          "name": "Exercise Name",
          "sets": 3-5,
          "repsMin": 6 (optional),
          "repsMax": 12 (optional),
          "repsTarget": "8-12" or "AMRAP" (alternative to min/max, optional),
          "rpeTarget": 7-9 (optional),
          "percentage1rm": null (use for strength-focused exercises, optional),
          "tempo": "3-1-2-0" (optional),
          "restSeconds": 90-180,
          "notes": "Form cues, variations, or progressions (optional)",
          "supersetGroup": "A" (for pairing exercises, optional),
          "isWarmup": false
        }
      ]
    }
  ]
}

Guidelines for creating effective programs:
1. Consider the client's stated goals, current metrics, and recovery capacity
2. Adjust volume and intensity based on check-in data (sleep, stress, energy levels)
3. Include appropriate warm-up exercises marked with "isWarmup": true
4. Use progressive overload principles
5. Balance pushing and pulling movements
6. Include practical notes for form cues and exercise substitutions
7. If the coach requests a framework/template, provide structure with flexibility
8. If the coach requests detailed programming, include specific sets/reps/RPE
9. Rest periods: 60-90s for hypertrophy, 2-3min for strength, 30-60s for conditioning
10. Consider training age and experience level when selecting exercises

## External Activities (RECOVERY CONSIDERATIONS)
When external activities are provided, you MUST:
1. Treat these as FIXED, immovable time slots - DO NOT suggest moving or changing them
2. Follow the specific scheduling rules provided in each request (some clients can train on activity days, others cannot)
3. Consider recovery requirements carefully:
   - NEVER schedule heavy leg training within 24-48 hours BEFORE high-impact leg activities (rugby, soccer, basketball, running)
   - Avoid scheduling upper body pressing before activities requiring shoulder stability (swimming, climbing, tennis)
   - Account for the activity's recovery hours when spacing workouts
4. Consider muscle group overlap:
   - If an activity heavily impacts "legs", reduce leg volume on adjacent training days
   - If an activity impacts "full_body", consider lighter training the day before/after
5. Place rest days strategically around high-intensity (vigorous) activities
6. When scheduling same-day training with activities, choose COMPLEMENTARY muscle groups (e.g., upper body training on a leg-intensive activity day)`;

// Generate training plan using OpenAI
export const generateTrainingPlanAI = async (
  input: AITrainingPlanInput
): Promise<{ plan: AIGeneratedPlan; rawResponse: string }> => {
  const prompt = buildTrainingPlanPrompt(input);

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: TRAINING_PLAN_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 4000,
    response_format: { type: "json_object" },
  });

  const rawResponse = completion.choices[0]?.message?.content || "";

  try {
    const plan = JSON.parse(rawResponse) as AIGeneratedPlan;

    // Validate and fix split type if needed
    const validSplitTypes: TrainingSplitType[] = [
      "push_pull_legs",
      "upper_lower",
      "full_body",
      "bro_split",
      "push_pull",
      "custom",
    ];
    if (!validSplitTypes.includes(plan.splitType)) {
      plan.splitType = "custom";
    }

    // Ensure frequency is within bounds
    plan.frequencyPerWeek = Math.max(1, Math.min(7, plan.frequencyPerWeek || 3));

    // Validate sessions
    if (!plan.sessions || plan.sessions.length === 0) {
      throw new Error("AI generated plan with no sessions");
    }

    // Ensure each session has required fields
    plan.sessions = plan.sessions.map((session) => ({
      ...session,
      name: session.name || "Workout Session",
      exercises: (session.exercises || []).map((exercise) => ({
        ...exercise,
        name: exercise.name || "Exercise",
        sets: Math.max(1, Math.min(20, exercise.sets || 3)),
        isWarmup: exercise.isWarmup || false,
      })),
    }));

    return { plan, rawResponse };
  } catch (error) {
    console.error("Failed to parse AI response:", error);
    console.error("Raw response:", rawResponse);
    throw new Error("Failed to parse AI-generated training plan");
  }
};

// Build the prompt for AI generation
const buildTrainingPlanPrompt = (input: AITrainingPlanInput): string => {
  let prompt = `## Coach's Request:\n${input.coachPrompt}\n\n`;

  // Add external activities section if provided
  if (input.externalActivities && input.externalActivities.length > 0) {
    prompt += `## FIXED EXTERNAL ACTIVITIES (DO NOT MOVE):\n`;
    prompt += `The client has the following recurring activities that are IMMOVABLE:\n\n`;

    const allDays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    const activityDays = input.externalActivities.map((a) => a.dayOfWeek.toLowerCase());
    const availableDays = allDays.filter((d) => !activityDays.includes(d));

    for (const activity of input.externalActivities) {
      prompt += `### ${activity.activityName} - ${activity.dayOfWeek.charAt(0).toUpperCase() + activity.dayOfWeek.slice(1)}\n`;
      prompt += `- Intensity: ${activity.intensityLevel}\n`;
      prompt += `- Duration: ${activity.durationMinutes} minutes\n`;
      prompt += `- Recovery needed: ${activity.recoveryHours} hours\n`;
      prompt += `- Muscle groups impacted: ${activity.muscleGroupsImpacted.join(", ")}\n`;
      if (activity.recoveryImpact) {
        prompt += `- Impact note: ${activity.recoveryImpact}\n`;
      }
      prompt += `\n`;
    }

    prompt += `### Scheduling Rules:\n`;
    if (input.allowSameDayTraining) {
      // Allow same-day training
      prompt += `- **SAME-DAY TRAINING ALLOWED**: This client CAN train on the same days as their activities\n`;
      prompt += `- Days with activities: ${activityDays.map((d) => d.charAt(0).toUpperCase() + d.slice(1)).join(", ")}\n`;
      prompt += `- Days without activities: ${availableDays.map((d) => d.charAt(0).toUpperCase() + d.slice(1)).join(", ")}\n`;
      prompt += `- When scheduling same-day training, choose COMPLEMENTARY muscle groups:\n`;
      prompt += `  - On leg-activity days (running, soccer, etc.): schedule upper body training\n`;
      prompt += `  - On upper-activity days (swimming, climbing): schedule lower body training\n`;
      prompt += `- Still avoid scheduling the SAME muscle groups that will be heavily used in the activity\n`;
      prompt += `- IMPORTANT: Do NOT schedule leg-heavy training the day BEFORE any activity that impacts legs\n\n`;
    } else {
      // Default: no same-day training
      prompt += `- Days BLOCKED by activities (no training): ${activityDays.map((d) => d.charAt(0).toUpperCase() + d.slice(1)).join(", ")}\n`;
      prompt += `- Available days for training: ${availableDays.map((d) => d.charAt(0).toUpperCase() + d.slice(1)).join(", ")}\n`;
      prompt += `- IMPORTANT: Do NOT schedule training on activity days\n`;
      prompt += `- IMPORTANT: Do NOT schedule leg-heavy training the day BEFORE any activity that impacts legs\n`;
      prompt += `- Consider placing rest days after vigorous activities\n\n`;
    }
  }

  prompt += `## Client Profile:\n`;
  prompt += `- Name: ${input.client.name}\n`;

  if (input.client.currentWeightKg) {
    prompt += `- Current Weight: ${input.client.currentWeightKg.toFixed(1)}kg (${(input.client.currentWeightKg * 2.205).toFixed(1)}lbs)\n`;
  }
  if (input.client.goalWeightKg) {
    prompt += `- Goal Weight: ${input.client.goalWeightKg.toFixed(1)}kg (${(input.client.goalWeightKg * 2.205).toFixed(1)}lbs)\n`;
  }
  if (input.client.bodyFatPercentage) {
    prompt += `- Current Body Fat: ${input.client.bodyFatPercentage}%\n`;
  }
  if (input.client.goalBodyFatPercentage) {
    prompt += `- Goal Body Fat: ${input.client.goalBodyFatPercentage}%\n`;
  }
  if (input.client.gender) {
    prompt += `- Gender: ${input.client.gender}\n`;
  }
  if (input.client.tdee) {
    prompt += `- TDEE: ${input.client.tdee} cal/day\n`;
  }
  if (input.client.bmr) {
    prompt += `- BMR: ${input.client.bmr} cal/day\n`;
  }

  if (input.checkInData) {
    prompt += `\n## Recent Check-In Data (Recovery Indicators):\n`;
    if (input.checkInData.avgMood !== undefined) {
      prompt += `- Average Mood: ${input.checkInData.avgMood.toFixed(1)}/5\n`;
    }
    if (input.checkInData.avgEnergy !== undefined) {
      prompt += `- Average Energy: ${input.checkInData.avgEnergy.toFixed(1)}/10\n`;
    }
    if (input.checkInData.avgSleep !== undefined) {
      prompt += `- Average Sleep Quality: ${input.checkInData.avgSleep.toFixed(1)}/10\n`;
    }
    if (input.checkInData.avgStress !== undefined) {
      prompt += `- Average Stress Level: ${input.checkInData.avgStress.toFixed(1)}/10 (higher = more stress)\n`;
    }
    if (input.checkInData.adherencePercentage !== undefined) {
      prompt += `- Program Adherence: ${input.checkInData.adherencePercentage.toFixed(0)}%\n`;
    }
    if (input.checkInData.recentWorkoutsCompleted !== undefined) {
      prompt += `- Recent Workouts Completed: ${input.checkInData.recentWorkoutsCompleted}\n`;
    }
    if (input.checkInData.recentChallenges) {
      prompt += `- Recent Challenges: ${input.checkInData.recentChallenges}\n`;
    }
    if (input.checkInData.recentPRs) {
      prompt += `- Recent PRs: ${input.checkInData.recentPRs}\n`;
    }
  }

  prompt += `\n## Task:\nGenerate a complete training program based on the coach's request and all the client data above. The program should be practical, evidence-based, and tailored to this specific client's situation.`;

  // Add reminder about activities if present
  if (input.externalActivities && input.externalActivities.length > 0) {
    if (input.allowSameDayTraining) {
      prompt += ` Remember to assign specific days of the week to each session. You CAN schedule training on the same days as external activities - just ensure you choose complementary muscle groups.`;
    } else {
      prompt += ` Remember to assign specific days of the week to each session, ensuring they do NOT overlap with the client's external activity days.`;
    }
  }

  return prompt;
};

// Calculate check-in averages from recent check-ins
export const calculateCheckInAverages = (
  checkIns: Array<{
    mood?: number;
    energy?: number;
    sleep?: number;
    stress?: number;
    adherencePercentage?: number;
    workoutsCompleted?: number;
    challenges?: string;
    prs?: string;
  }>
): {
  avgMood?: number;
  avgEnergy?: number;
  avgSleep?: number;
  avgStress?: number;
  adherencePercentage?: number;
  recentWorkoutsCompleted?: number;
  recentChallenges?: string;
  recentPRs?: string;
} => {
  if (!checkIns || checkIns.length === 0) return {};

  const sum = (arr: (number | undefined)[]) => {
    const valid = arr.filter((v): v is number => v !== undefined);
    return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : undefined;
  };

  const mostRecent = checkIns[0];

  return {
    avgMood: sum(checkIns.map((c) => c.mood)),
    avgEnergy: sum(checkIns.map((c) => c.energy)),
    avgSleep: sum(checkIns.map((c) => c.sleep)),
    avgStress: sum(checkIns.map((c) => c.stress)),
    adherencePercentage: sum(checkIns.map((c) => c.adherencePercentage)),
    recentWorkoutsCompleted: mostRecent?.workoutsCompleted,
    recentChallenges: mostRecent?.challenges,
    recentPRs: mostRecent?.prs,
  };
};

// System prompt for refreshing exercises only
const REFRESH_EXERCISES_SYSTEM_PROMPT = `You are an expert strength and conditioning coach. Your task is to generate NEW exercises for an existing training program structure.

IMPORTANT: Always respond with valid JSON only - no markdown, no code blocks, just the raw JSON object.

You will be given the current session structure. You must:
1. KEEP the exact same session names, days, and focus areas
2. GENERATE completely NEW exercises that still match each session's focus
3. Vary exercise selection from typical choices to add variety
4. Maintain similar volume (sets x reps) and intensity (RPE) structure
5. Include appropriate warm-up exercises

The JSON must follow this exact structure:
{
  "sessions": [
    {
      "sessionId": "the-session-id-provided",
      "exercises": [
        {
          "name": "Exercise Name",
          "sets": 3-5,
          "repsMin": 6 (optional),
          "repsMax": 12 (optional),
          "repsTarget": "8-12" or "AMRAP" (alternative to min/max, optional),
          "rpeTarget": 7-9 (optional),
          "percentage1rm": null (optional),
          "tempo": "3-1-2-0" (optional),
          "restSeconds": 90-180,
          "notes": "Form cues, variations, or progressions (optional)",
          "supersetGroup": "A" (for pairing exercises, optional),
          "isWarmup": false
        }
      ]
    }
  ]
}

Guidelines:
1. Generate variety - if the current exercise is bench press, suggest incline dumbbell press, etc.
2. Match the movement patterns and muscle groups of the session's focus
3. Maintain similar training stimulus (strength, hypertrophy, power)
4. Include practical notes for form cues
5. Keep warm-up exercises relevant to the main work`;

// Input type for refreshing exercises
type RefreshExercisesInput = {
  sessions: Array<{
    id: string;
    name: string;
    focus?: string;
    estimatedDurationMinutes?: number;
    currentExerciseCount: number;
  }>;
  clientContext?: {
    name: string;
    experience?: string;
    equipment?: string;
  };
};

// Output type from AI
type RefreshExercisesOutput = {
  sessions: Array<{
    sessionId: string;
    exercises: Array<{
      name: string;
      sets: number;
      repsMin?: number;
      repsMax?: number;
      repsTarget?: string;
      rpeTarget?: number;
      percentage1rm?: number;
      tempo?: string;
      restSeconds?: number;
      notes?: string;
      supersetGroup?: string;
      isWarmup?: boolean;
    }>;
  }>;
};

// Regenerate exercises for existing sessions
export const regenerateExercisesAI = async (
  input: RefreshExercisesInput
): Promise<{ result: RefreshExercisesOutput; rawResponse: string }> => {
  let prompt = `## Current Training Program Sessions:\n\n`;

  for (const session of input.sessions) {
    prompt += `### Session: ${session.name}\n`;
    prompt += `- Session ID: ${session.id}\n`;
    if (session.focus) prompt += `- Focus: ${session.focus}\n`;
    if (session.estimatedDurationMinutes) {
      prompt += `- Target Duration: ${session.estimatedDurationMinutes} minutes\n`;
    }
    prompt += `- Current Exercise Count: ${session.currentExerciseCount}\n`;
    prompt += `\n`;
  }

  if (input.clientContext) {
    prompt += `## Client Context:\n`;
    prompt += `- Name: ${input.clientContext.name}\n`;
    if (input.clientContext.experience) {
      prompt += `- Experience: ${input.clientContext.experience}\n`;
    }
    if (input.clientContext.equipment) {
      prompt += `- Available Equipment: ${input.clientContext.equipment}\n`;
    }
    prompt += `\n`;
  }

  prompt += `## Task:\nGenerate NEW exercises for each session above. The exercises should be different from typical choices to provide variety, but still match the session's focus and goals. Generate approximately the same number of exercises as currently in each session. Include 1-2 warm-up exercises per session.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: REFRESH_EXERCISES_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    temperature: 0.8, // Higher temperature for more variety
    max_tokens: 4000,
    response_format: { type: "json_object" },
  });

  const rawResponse = completion.choices[0]?.message?.content || "";

  try {
    const result = JSON.parse(rawResponse) as RefreshExercisesOutput;

    // Validate sessions
    if (!result.sessions || result.sessions.length === 0) {
      throw new Error("AI generated response with no sessions");
    }

    // Ensure each exercise has required fields
    result.sessions = result.sessions.map((session) => ({
      ...session,
      exercises: (session.exercises || []).map((exercise) => ({
        ...exercise,
        name: exercise.name || "Exercise",
        sets: Math.max(1, Math.min(20, exercise.sets || 3)),
        isWarmup: exercise.isWarmup || false,
      })),
    }));

    return { result, rawResponse };
  } catch (error) {
    console.error("Failed to parse AI refresh exercises response:", error);
    console.error("Raw response:", rawResponse);
    throw new Error("Failed to parse AI-generated exercises");
  }
};
