export type NutritionHistoryRow = {
  date: string;
  calories_consumed: number | null;
  target_calories: number | null;
  protein_g: number | null;
  target_protein_g: number | null;
  carbs_g: number | null;
  target_carbs_g: number | null;
  fat_g: number | null;
  target_fat_g: number | null;
  calorie_surplus_deficit: number | null;
  nutrition_adherence: "hit" | "partial" | "missed" | null;
};

export type WellnessHistoryRow = {
  date: string;
  mood: number | null;    // 1-5
  energy: number | null;  // 1-10
  sleep: number | null;   // 1-10
  stress: number | null;  // 1-10
  notes: string | null;
};
