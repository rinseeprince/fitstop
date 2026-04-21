import OpenAI from "openai";
import type { AITrainingPlanInput, AIGeneratedPlan, TrainingSplitType } from "@/types/training";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const TRAINING_PLAN_SYSTEM_PROMPT = `You are an expert strength and conditioning coach creating personalized training programs.

Your task is to generate science-based training plans tailored to the client's goals, current fitness level, and constraints.

IMPORTANT: Always respond with valid JSON only - no markdown, no code blocks, just the raw JSON object.
Do NOT include coaching notes, form cues, or descriptions - this tool is for professional coaches who write their own cues.

The JSON must follow this exact structure:
{
  "name": "Program Name (e.g., 'Strength & Hypertrophy Program')",
  "description": "Brief 1-2 sentence description of the program approach and goals",
  "splitType": "push_pull_legs" | "upper_lower" | "full_body" | "bro_split" | "push_pull" | "custom",
  "frequencyPerWeek": 3-6,
  "programDurationWeeks": 4-16 (optional, can be null),
  "cycleLength": total days in one repeating cycle including rest days,
  "restDayPositions": [0-indexed positions within the cycle that are rest days],
  "sessions": [
    {
      "name": "Session Name (e.g., 'Push Day A', 'Upper Body')",
      "dayOfWeek": null (do NOT assign days - the coach decides placement dates),
      "focus": "Primary muscle groups or movement patterns",
      "estimatedDurationMinutes": 45-90,
      "exercises": [
        {
          "name": "Exercise Name",
          "sets": 3-5,
          "repsMin": 6 (optional),
          "repsMax": 12 (optional),
          "repsTarget": "8-12" or "AMRAP" (alternative to min/max, optional),
          "rpeTarget": 7-9,
          "percentage1rm": null (use for strength-focused exercises, optional),
          "restSeconds": 60-180,
          "supersetGroup": "A" (for pairing exercises, optional),
          "isWarmup": false
        }
      ]
    }
  ]
}

## Rest & RPE Rules (MANDATORY for every non-warmup exercise)
ALWAYS set rpeTarget and restSeconds based on exercise type:
- Heavy compounds (squat, deadlift, bench press, overhead press): restSeconds 150-180, rpeTarget 7-9
- Moderate compounds (rows, lunges, RDLs, pull-ups, dips): restSeconds 90-120, rpeTarget 7-8
- Isolation/accessories (curls, laterals, flyes, extensions): restSeconds 60-90, rpeTarget 7-8
- Warm-up exercises (isWarmup: true): restSeconds 30-60, omit rpeTarget

## Cycle Definition (MANDATORY)
Define the complete training cycle including rest days using cycleLength and restDayPositions.
- cycleLength = total days in one repeating cycle (training days + rest days)
- restDayPositions = 0-indexed positions within the cycle that are rest days
- The number of training sessions MUST equal cycleLength minus restDayPositions.length
- Examples:
  - Push/Pull/Legs/Rest: cycleLength: 4, restDayPositions: [3] (3 sessions)
  - PPL x2 + Rest: cycleLength: 7, restDayPositions: [6] (6 sessions)
  - Upper/Lower/Rest: cycleLength: 3, restDayPositions: [2] (2 sessions)
  - Upper/Lower x2 + Rest: cycleLength: 5, restDayPositions: [4] (4 sessions)
  - Full Body 3x (every other day): cycleLength: 2, restDayPositions: [1] (1 session, cycles through all sessions)

Guidelines for creating effective programs:
1. Consider the client's stated goals, current metrics, and recovery capacity
2. Adjust volume and intensity based on check-in data (sleep, stress, energy levels)
3. Include appropriate warm-up exercises marked with "isWarmup": true
4. Use progressive overload principles
5. Balance pushing and pulling movements
6. Consider training age and experience level when selecting exercises

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
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: TRAINING_PLAN_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 4000,
    response_format: { type: "json_object" },
  }, { timeout: 45000 });

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
    throw new Error("Failed to parse AI-generated training plan", { cause: error });
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

  // Remind AI not to assign days - coach decides placement dates
  prompt += ` Do NOT assign dayOfWeek to any session. Sessions are an ordered sequence - the coach will decide which calendar dates they land on.`;

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

