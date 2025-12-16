"use client";

import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Plus, Search } from "lucide-react";

// Common exercises for autocomplete
const commonExercises = [
  // Chest
  "Barbell Bench Press", "Incline Barbell Press", "Dumbbell Bench Press", "Incline Dumbbell Press",
  "Cable Flyes", "Dumbbell Flyes", "Push-ups", "Chest Dips",
  // Back
  "Barbell Rows", "Dumbbell Rows", "Pull-ups", "Chin-ups", "Lat Pulldowns",
  "Seated Cable Rows", "T-Bar Rows", "Face Pulls", "Deadlifts", "Rack Pulls",
  // Shoulders
  "Overhead Press", "Dumbbell Shoulder Press", "Lateral Raises", "Front Raises",
  "Rear Delt Flyes", "Arnold Press", "Shrugs", "Upright Rows",
  // Legs
  "Barbell Squats", "Front Squats", "Leg Press", "Leg Extensions", "Leg Curls",
  "Romanian Deadlifts", "Walking Lunges", "Bulgarian Split Squats", "Hip Thrusts",
  "Glute Bridges", "Calf Raises", "Seated Calf Raises", "Good Mornings",
  // Arms
  "Barbell Curls", "Dumbbell Curls", "Hammer Curls", "Preacher Curls",
  "Tricep Pushdowns", "Overhead Tricep Extension", "Skull Crushers", "Tricep Dips",
  // Core
  "Plank", "Ab Rollouts", "Hanging Leg Raises", "Cable Crunches",
  "Russian Twists", "Dead Bug", "Bird Dog",
];

type ExerciseSearchInputProps = {
  onSelect: (exerciseName: string) => void;
};

export function ExerciseSearchInput({ onSelect }: ExerciseSearchInputProps) {
  const [query, setQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const filteredExercises = query.trim()
    ? commonExercises.filter((e) =>
        e.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 6)
    : [];

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (exerciseName: string) => {
    onSelect(exerciseName);
    setQuery("");
    setShowSuggestions(false);
    setSelectedIndex(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev < filteredExercises.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredExercises[selectedIndex]) {
        handleSelect(filteredExercises[selectedIndex]);
      } else if (query.trim()) {
        handleSelect(query.trim());
      }
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowSuggestions(true);
            setSelectedIndex(0);
          }}
          onFocus={() => setShowSuggestions(true)}
          onKeyDown={handleKeyDown}
          placeholder="Add exercise..."
          className="h-8 pl-8 pr-8 text-sm"
        />
        {query.trim() && (
          <button
            onClick={() => handleSelect(query.trim())}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-indigo-600"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Suggestions Dropdown */}
      {showSuggestions && filteredExercises.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border rounded-lg shadow-lg overflow-hidden">
          {filteredExercises.map((exercise, idx) => (
            <button
              key={exercise}
              onClick={() => handleSelect(exercise)}
              className={cn(
                "w-full text-left px-3 py-2 text-sm transition-colors",
                idx === selectedIndex
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-slate-700 hover:bg-slate-50"
              )}
            >
              {exercise}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
