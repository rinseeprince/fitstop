import type { Client } from "@/types/check-in";

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
  explanation: string; // Explanation of the calculation
};

/**
 * Calculate BMR using deterministic formulas.
 * Uses Katch-McArdle when body fat % is available (more accurate),
 * otherwise falls back to Mifflin-St Jeor.
 *
 * @param data - Client metrics for BMR calculation
 * @returns BMR result with calculated values and method used
 */
export function calculateBMR(data: BMRCalculationData): BMRResult {
  // Convert to metric if needed
  const weightKg =
    data.weightUnit === "lbs" ? data.weight * 0.453592 : data.weight;
  const heightCm = data.heightUnit === "in" ? data.height * 2.54 : data.height;
  const age = data.age ?? 30;

  let bmr: number;
  let method: string;
  let explanation: string;

  if (data.bodyFatPercentage !== undefined && data.bodyFatPercentage > 0) {
    // Katch-McArdle formula (uses lean body mass)
    bmr = calculateKatchMcArdle(weightKg, data.bodyFatPercentage);
    method = "Katch-McArdle";
    explanation =
      "Calculated using the Katch-McArdle formula based on lean body mass, which provides more accurate results when body fat percentage is known.";
  } else {
    // Mifflin-St Jeor formula
    bmr = calculateMifflinStJeor(weightKg, heightCm, age, data.gender);
    method = "Mifflin-St Jeor";
    explanation =
      "Calculated using the Mifflin-St Jeor equation, the most accurate BMR formula when body fat percentage is not available.";
  }

  const tdee = bmr * 1.2; // Sedentary activity level

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    method,
    explanation,
  };
}

/**
 * Katch-McArdle BMR calculation (requires body fat percentage).
 * Formula: BMR = 370 + (21.6 × lean body mass in kg)
 */
function calculateKatchMcArdle(
  weightKg: number,
  bodyFatPercentage: number
): number {
  const leanBodyMass = weightKg * (1 - bodyFatPercentage / 100);
  return 370 + 21.6 * leanBodyMass;
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
 * Calculate BMR for a client using their current metrics.
 * Returns null if required data is missing.
 *
 * @param client - Client object with metrics
 * @returns BMR value in calories/day, or null if data is missing
 */
export function updateClientBMR(client: Client): number | null {
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

  const result = calculateBMR(data);
  return result.bmr;
}
