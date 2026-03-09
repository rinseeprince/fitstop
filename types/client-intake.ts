// Client intake status
export type IntakeStatus = "pending" | "in_progress" | "completed" | "reviewed";

// Intake enum types
export type PrimaryGoal =
  | "lose_weight"
  | "build_muscle"
  | "recomposition"
  | "general_fitness"
  | "event_prep"
  | "maintain";

export type WorkActivityLevel =
  | "sedentary"
  | "lightly_active"
  | "moderately_active"
  | "very_active"
  | "extremely_active";

export type TrainingLocation =
  | "commercial_gym"
  | "home_gym"
  | "home_no_equipment"
  | "outdoor"
  | "mixed";

export type TrainingTimePreference =
  | "morning"
  | "midday"
  | "evening"
  | "flexible";

export type CookingFrequency =
  | "mostly_cook"
  | "mix_of_both"
  | "mostly_eat_out"
  | "meal_prep";

export type TrainingExperience =
  | "complete_beginner"
  | "some_experience"
  | "intermediate"
  | "advanced";

export type OnboardingStatus =
  | "pending_intake"
  | "intake_completed"
  | "setup_in_progress"
  | "active"
  | "paused";

// Full client intake record (matches database schema)
export type ClientIntake = {
  id: string;
  clientId: string;
  status: IntakeStatus;

  // Step 1: Body & lifestyle
  dateOfBirth?: string;
  gender?: string;
  height?: number;
  heightUnit?: string;
  currentWeight?: number;
  weightUnit?: string;
  bodyFatPercentage?: number;
  workActivityLevel?: WorkActivityLevel;

  // Step 2: Goals
  primaryGoal?: PrimaryGoal;
  goalDetails?: string;
  targetWeight?: number;
  goalDeadline?: string;
  goalDescription?: string;
  motivation?: string;

  // Step 3: Training
  trainingExperienceLevel?: TrainingExperience;
  trainingTimePreference?: TrainingTimePreference;
  trainingLocation?: TrainingLocation;
  availableEquipment?: string[];
  daysPerWeek?: number;
  sessionDurationMinutes?: number;

  // Step 4: Nutrition
  dietaryRequirements?: string[];
  cookingFrequency?: CookingFrequency;
  nutritionNotes?: string;
  foodAllergies?: string;
  dietDescription?: string;
  hasTrackedMacrosBefore?: boolean;
  mealsPerDay?: number;
  biggestNutritionChallenge?: string;

  // Step 5: Medical & background
  injuriesOrLimitations?: string;
  medicalNotes?: string;
  previousCoachingExperience?: boolean;
  previousCoachingDetails?: string;
  anythingElse?: string;

  // Coach review
  reviewedAt?: string;
  reviewedBy?: string;
  coachReviewNotes?: string;

  // Metadata
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
};

// Input type for client-submitted data (excludes server-managed fields)
export type ClientIntakeInput = Omit<
  ClientIntake,
  | "id"
  | "clientId"
  | "status"
  | "reviewedAt"
  | "reviewedBy"
  | "coachReviewNotes"
  | "startedAt"
  | "completedAt"
  | "createdAt"
  | "updatedAt"
>;

// Database row shape (until types/database.ts is regenerated)
export type ClientIntakeRow = {
  id: string;
  client_id: string;
  status: string;
  date_of_birth: string | null;
  gender: string | null;
  height: number | null;
  height_unit: string | null;
  current_weight: number | null;
  weight_unit: string | null;
  body_fat_percentage: number | null;
  work_activity_level: string | null;
  primary_goal: string | null;
  goal_details: string | null;
  target_weight: number | null;
  goal_deadline: string | null;
  goal_description: string | null;
  motivation: string | null;
  training_experience_level: string | null;
  training_time_preference: string | null;
  training_location: string | null;
  available_equipment: string[] | null;
  days_per_week: number | null;
  session_duration_minutes: number | null;
  dietary_requirements: string[] | null;
  cooking_frequency: string | null;
  nutrition_notes: string | null;
  food_allergies: string | null;
  diet_description: string | null;
  has_tracked_macros_before: boolean | null;
  meals_per_day: number | null;
  biggest_nutrition_challenge: string | null;
  injuries_or_limitations: string | null;
  medical_notes: string | null;
  previous_coaching_experience: boolean | null;
  previous_coaching_details: string | null;
  anything_else: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  coach_review_notes: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};
