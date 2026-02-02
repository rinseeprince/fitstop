import type { QuickSuggestion, WorkoutTemplate } from "@/types/training";

// Quick suggestion templates organized by category
export const quickSuggestions: QuickSuggestion[] = [
  // Goal-based suggestions
  {
    id: "fat-loss",
    label: "Fat loss",
    prompt: "Focus on fat loss while preserving muscle mass. Include a mix of resistance training and metabolic conditioning. Higher rep ranges (10-15) with shorter rest periods.",
    category: "goal",
  },
  {
    id: "muscle-building",
    label: "Muscle building",
    prompt: "Hypertrophy-focused program for muscle growth. Moderate rep ranges (8-12), progressive overload emphasis, adequate volume per muscle group.",
    category: "goal",
  },
  {
    id: "strength",
    label: "Strength",
    prompt: "Strength-focused program with heavy compound movements. Lower rep ranges (3-6), longer rest periods, emphasis on progressive overload.",
    category: "goal",
  },
  {
    id: "athletic-performance",
    label: "Athletic performance",
    prompt: "Athletic performance training combining strength, power, and conditioning. Include explosive movements, agility work, and sport-specific exercises.",
    category: "goal",
  },

  // Training style suggestions
  {
    id: "ppl",
    label: "Push/Pull/Legs",
    prompt: "Push/Pull/Legs split. Organize workouts by movement patterns - pushing exercises, pulling exercises, and leg/lower body work.",
    category: "style",
  },
  {
    id: "upper-lower",
    label: "Upper/Lower",
    prompt: "Upper/Lower split, 4 days per week. Alternate between upper body and lower body sessions for balanced development.",
    category: "style",
  },
  {
    id: "full-body",
    label: "Full Body 3x",
    prompt: "Full body workouts 3 times per week. Each session hits all major muscle groups with compound movements. Great for beginners or busy schedules.",
    category: "style",
  },
  {
    id: "bro-split",
    label: "Body part split",
    prompt: "Traditional body part split. Dedicate each day to specific muscle groups for high volume and focused training.",
    category: "style",
  },

  // Equipment-based suggestions
  {
    id: "home-dumbbells",
    label: "Home (dumbbells)",
    prompt: "Home workout program using only dumbbells. Focus on exercises that can be performed in limited space with adjustable dumbbells.",
    category: "equipment",
  },
  {
    id: "full-gym",
    label: "Full gym access",
    prompt: "Full commercial gym program utilizing barbells, machines, cables, and free weights. Take advantage of all available equipment.",
    category: "equipment",
  },
  {
    id: "minimal-equipment",
    label: "Minimal equipment",
    prompt: "Minimal equipment workout using bodyweight exercises and resistance bands. Perfect for travel or home training with limited gear.",
    category: "equipment",
  },
  {
    id: "barbell-only",
    label: "Barbell only",
    prompt: "Barbell-focused program. Build strength with classic barbell movements - squats, deadlifts, bench press, rows, and overhead press.",
    category: "equipment",
  },
];

// Pre-built workout templates for manual creation
export const workoutTemplates: WorkoutTemplate[] = [
  {
    id: "ppl-6day",
    name: "Push/Pull/Legs (6-day)",
    description: "Classic PPL split hitting each muscle group twice per week",
    splitType: "push_pull_legs",
    frequency: 6,
    sessions: [
      {
        name: "Push Day A",
        focus: "Chest, Shoulders, Triceps",
        exercises: [
          { name: "Barbell Bench Press", sets: 4, repsTarget: "6-8" },
          { name: "Overhead Press", sets: 3, repsTarget: "8-10" },
          { name: "Incline Dumbbell Press", sets: 3, repsTarget: "10-12" },
          { name: "Lateral Raises", sets: 3, repsTarget: "12-15" },
          { name: "Tricep Pushdowns", sets: 3, repsTarget: "10-12" },
        ],
      },
      {
        name: "Pull Day A",
        focus: "Back, Biceps",
        exercises: [
          { name: "Barbell Rows", sets: 4, repsTarget: "6-8" },
          { name: "Pull-ups", sets: 3, repsTarget: "8-10" },
          { name: "Seated Cable Rows", sets: 3, repsTarget: "10-12" },
          { name: "Face Pulls", sets: 3, repsTarget: "12-15" },
          { name: "Barbell Curls", sets: 3, repsTarget: "10-12" },
        ],
      },
      {
        name: "Legs Day A",
        focus: "Quads, Hamstrings, Glutes",
        exercises: [
          { name: "Barbell Squats", sets: 4, repsTarget: "6-8" },
          { name: "Romanian Deadlifts", sets: 3, repsTarget: "8-10" },
          { name: "Leg Press", sets: 3, repsTarget: "10-12" },
          { name: "Leg Curls", sets: 3, repsTarget: "10-12" },
          { name: "Calf Raises", sets: 4, repsTarget: "12-15" },
        ],
      },
      {
        name: "Push Day B",
        focus: "Chest, Shoulders, Triceps",
        exercises: [
          { name: "Incline Barbell Press", sets: 4, repsTarget: "6-8" },
          { name: "Dumbbell Shoulder Press", sets: 3, repsTarget: "8-10" },
          { name: "Cable Flyes", sets: 3, repsTarget: "12-15" },
          { name: "Rear Delt Flyes", sets: 3, repsTarget: "12-15" },
          { name: "Overhead Tricep Extension", sets: 3, repsTarget: "10-12" },
        ],
      },
      {
        name: "Pull Day B",
        focus: "Back, Biceps",
        exercises: [
          { name: "Deadlifts", sets: 4, repsTarget: "5-6" },
          { name: "Lat Pulldowns", sets: 3, repsTarget: "10-12" },
          { name: "Dumbbell Rows", sets: 3, repsTarget: "8-10" },
          { name: "Shrugs", sets: 3, repsTarget: "10-12" },
          { name: "Hammer Curls", sets: 3, repsTarget: "10-12" },
        ],
      },
      {
        name: "Legs Day B",
        focus: "Quads, Hamstrings, Glutes",
        exercises: [
          { name: "Front Squats", sets: 4, repsTarget: "6-8" },
          { name: "Walking Lunges", sets: 3, repsTarget: "10-12 each" },
          { name: "Leg Extensions", sets: 3, repsTarget: "12-15" },
          { name: "Glute Bridges", sets: 3, repsTarget: "10-12" },
          { name: "Seated Calf Raises", sets: 4, repsTarget: "12-15" },
        ],
      },
    ],
  },
  {
    id: "upper-lower-4day",
    name: "Upper/Lower (4-day)",
    description: "Balanced 4-day split alternating upper and lower body",
    splitType: "upper_lower",
    frequency: 4,
    sessions: [
      {
        name: "Upper Body A",
        focus: "Chest, Back, Shoulders, Arms",
        exercises: [
          { name: "Barbell Bench Press", sets: 4, repsTarget: "6-8" },
          { name: "Barbell Rows", sets: 4, repsTarget: "6-8" },
          { name: "Overhead Press", sets: 3, repsTarget: "8-10" },
          { name: "Pull-ups", sets: 3, repsTarget: "8-10" },
          { name: "Dumbbell Curls", sets: 2, repsTarget: "10-12" },
          { name: "Tricep Dips", sets: 2, repsTarget: "10-12" },
        ],
      },
      {
        name: "Lower Body A",
        focus: "Quads, Hamstrings, Glutes",
        exercises: [
          { name: "Barbell Squats", sets: 4, repsTarget: "6-8" },
          { name: "Romanian Deadlifts", sets: 4, repsTarget: "8-10" },
          { name: "Leg Press", sets: 3, repsTarget: "10-12" },
          { name: "Leg Curls", sets: 3, repsTarget: "10-12" },
          { name: "Calf Raises", sets: 4, repsTarget: "12-15" },
        ],
      },
      {
        name: "Upper Body B",
        focus: "Back, Chest, Shoulders, Arms",
        exercises: [
          { name: "Deadlifts", sets: 4, repsTarget: "5-6" },
          { name: "Incline Dumbbell Press", sets: 3, repsTarget: "8-10" },
          { name: "Lat Pulldowns", sets: 3, repsTarget: "10-12" },
          { name: "Dumbbell Shoulder Press", sets: 3, repsTarget: "8-10" },
          { name: "Face Pulls", sets: 3, repsTarget: "12-15" },
          { name: "Hammer Curls", sets: 2, repsTarget: "10-12" },
        ],
      },
      {
        name: "Lower Body B",
        focus: "Glutes, Hamstrings, Quads",
        exercises: [
          { name: "Hip Thrusts", sets: 4, repsTarget: "8-10" },
          { name: "Front Squats", sets: 3, repsTarget: "8-10" },
          { name: "Walking Lunges", sets: 3, repsTarget: "10-12 each" },
          { name: "Good Mornings", sets: 3, repsTarget: "10-12" },
          { name: "Leg Extensions", sets: 3, repsTarget: "12-15" },
        ],
      },
    ],
  },
  {
    id: "full-body-3day",
    name: "Full Body (3-day)",
    description: "Efficient 3-day program hitting all muscle groups each session",
    splitType: "full_body",
    frequency: 3,
    sessions: [
      {
        name: "Full Body A",
        focus: "Compound Focus",
        exercises: [
          { name: "Barbell Squats", sets: 4, repsTarget: "6-8" },
          { name: "Barbell Bench Press", sets: 4, repsTarget: "6-8" },
          { name: "Barbell Rows", sets: 4, repsTarget: "6-8" },
          { name: "Overhead Press", sets: 3, repsTarget: "8-10" },
          { name: "Plank", sets: 3, repsTarget: "30-60 sec" },
        ],
      },
      {
        name: "Full Body B",
        focus: "Strength & Hypertrophy",
        exercises: [
          { name: "Deadlifts", sets: 4, repsTarget: "5-6" },
          { name: "Incline Dumbbell Press", sets: 3, repsTarget: "8-10" },
          { name: "Pull-ups", sets: 3, repsTarget: "8-10" },
          { name: "Dumbbell Lunges", sets: 3, repsTarget: "10-12 each" },
          { name: "Face Pulls", sets: 3, repsTarget: "12-15" },
        ],
      },
      {
        name: "Full Body C",
        focus: "Volume & Accessory",
        exercises: [
          { name: "Front Squats", sets: 3, repsTarget: "8-10" },
          { name: "Dumbbell Bench Press", sets: 3, repsTarget: "10-12" },
          { name: "Seated Cable Rows", sets: 3, repsTarget: "10-12" },
          { name: "Romanian Deadlifts", sets: 3, repsTarget: "10-12" },
          { name: "Lateral Raises", sets: 3, repsTarget: "12-15" },
        ],
      },
    ],
  },
];

// Get suggestions by category
export const getSuggestionsByCategory = (category: QuickSuggestion["category"]) => {
  return quickSuggestions.filter((s) => s.category === category);
};

// Get template by ID
export const getTemplateById = (id: string) => {
  return workoutTemplates.find((t) => t.id === id);
};
