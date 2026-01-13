"use client";

import { useState, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  const [open, setOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredExercises = query.trim()
    ? commonExercises.filter((e) =>
        e.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 6)
    : [];

  const handleSelect = (exerciseName: string) => {
    onSelect(exerciseName);
    setQuery("");
    setOpen(false);
    setSelectedIndex(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || filteredExercises.length === 0) {
      if (e.key === "Enter" && query.trim()) {
        e.preventDefault();
        handleSelect(query.trim());
      }
      return;
    }

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
      setOpen(false);
    }
  };

  const showPopover = open && filteredExercises.length > 0;

  return (
    <Popover open={showPopover} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setSelectedIndex(0);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder="Add exercise..."
            className="h-8 pl-8 pr-8 text-sm"
          />
          {query.trim() && (
            <button
              onClick={() => handleSelect(query.trim())}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-primary transition-colors"
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
        sideOffset={4}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="max-h-[200px] overflow-y-auto">
          {filteredExercises.map((exercise, idx) => (
            <button
              key={exercise}
              onClick={() => handleSelect(exercise)}
              className={cn(
                "w-full text-left px-3 py-2 text-sm transition-colors",
                idx === selectedIndex
                  ? "bg-primary/10 text-primary"
                  : "text-foreground hover:bg-muted"
              )}
            >
              {exercise}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
