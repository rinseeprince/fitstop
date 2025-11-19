import OpenAI from "openai";
import type { Client } from "@/types/check-in";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export type BMRCalculationData = {
  weight: number; // in lbs or kg
  weightUnit: "lbs" | "kg";
  height: number; // in inches or cm
  heightUnit: "in" | "cm";
  gender: "male" | "female" | "other";
  age?: number; // Age in years (optional, defaults to 30 if not provided)
  bodyFatPercentage?: number; // Optional for more accurate calculation
};

export type BMRResult = {
  bmr: number; // Basal Metabolic Rate in calories/day
  tdee: number; // Total Daily Energy Expenditure (assuming sedentary)
  method: string; // Which formula was used
  explanation: string; // AI explanation of the calculation
};

/**
 * Calculate BMR using AI to determine the best formula and provide explanation
 */
export async function calculateBMRWithAI(
  data: BMRCalculationData
): Promise<BMRResult> {
  // Convert to metric if needed
  const weightKg =
    data.weightUnit === "lbs" ? data.weight * 0.453592 : data.weight;
  const heightCm = data.heightUnit === "in" ? data.height * 2.54 : data.height;

  const age = data.age ?? 30; // Default to 30 if age not provided

  const prompt = `Calculate the Basal Metabolic Rate (BMR) for a person with the following characteristics:
- Weight: ${weightKg.toFixed(1)} kg
- Height: ${heightCm.toFixed(1)} cm
- Age: ${age} years
- Gender: ${data.gender}
${data.bodyFatPercentage ? `- Body Fat Percentage: ${data.bodyFatPercentage}%` : ""}

Please:
1. Calculate BMR using the most appropriate formula (Mifflin-St Jeor if no body fat %, Katch-McArdle if body fat % is available)
2. Calculate TDEE assuming sedentary activity level (BMR × 1.2)
3. Provide a brief explanation of which formula you used and why

Return your response in this exact JSON format:
{
  "bmr": <number>,
  "tdee": <number>,
  "method": "<formula name>",
  "explanation": "<brief 1-2 sentence explanation>"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a fitness nutrition expert. Calculate BMR and TDEE accurately and return only valid JSON.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });

    const result = JSON.parse(
      response.choices[0].message.content || "{}"
    ) as BMRResult;

    return result;
  } catch (error) {
    console.error("Error calculating BMR with AI:", error);
    // Fallback to Mifflin-St Jeor formula if AI fails
    const bmr = calculateMifflinStJeor(weightKg, heightCm, age, data.gender);
    const tdee = bmr * 1.2;

    return {
      bmr: Math.round(bmr),
      tdee: Math.round(tdee),
      method: "Mifflin-St Jeor (fallback)",
      explanation:
        "Calculated using the Mifflin-St Jeor equation, a widely accepted BMR formula.",
    };
  }
}

/**
 * Fallback: Mifflin-St Jeor BMR calculation
 */
function calculateMifflinStJeor(
  weightKg: number,
  heightCm: number,
  age: number,
  gender: string
): number {
  // Mifflin-St Jeor Equation:
  // Men: BMR = (10 × weight in kg) + (6.25 × height in cm) - (5 × age in years) + 5
  // Women: BMR = (10 × weight in kg) + (6.25 × height in cm) - (5 × age in years) - 161

  let bmr = 10 * weightKg + 6.25 * heightCm - 5 * age;

  if (gender === "male") {
    bmr += 5;
  } else if (gender === "female") {
    bmr -= 161;
  } else {
    // For 'other', use average of male and female formulas
    bmr -= 78; // Average of +5 and -161
  }

  return bmr;
}

/**
 * Calculate age from date of birth
 */
function calculateAge(dateOfBirth: string): number {
  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();

  // Adjust age if birthday hasn't occurred yet this year
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }

  return age;
}

/**
 * Update client's BMR in the database after check-in
 */
export async function updateClientBMR(client: Client): Promise<number | null> {
  // Check if we have all required data
  if (
    !client.currentWeight ||
    !client.height ||
    !client.gender ||
    !client.weightUnit ||
    !client.heightUnit
  ) {
    return null;
  }

  // Calculate age from date of birth if available
  const age = client.dateOfBirth ? calculateAge(client.dateOfBirth) : undefined;

  const data: BMRCalculationData = {
    weight: client.currentWeight,
    weightUnit: client.weightUnit,
    height: client.height,
    heightUnit: client.heightUnit,
    gender: client.gender,
    age,
    bodyFatPercentage: client.currentBodyFatPercentage,
  };

  try {
    const result = await calculateBMRWithAI(data);
    return result.bmr;
  } catch (error) {
    console.error("Failed to calculate BMR:", error);
    return null;
  }
}
