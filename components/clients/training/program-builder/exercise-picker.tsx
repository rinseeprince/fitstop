"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Exercise } from "@/types/training";
import { FOCUS_RING, TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY } from "./builder-tokens";

// Single-EXERCISE catalog picker (saved-session insertion is Phase 3).
// Debounced search against GET /api/training/exercises?search= — the response
// is the camelCase Exercise domain type (muscleGroup, NOT muscle_group).
// Free-text fallback adds by name with exerciseId null; the server resolves /
// creates the catalog row on save (resolveExercises).
type ExercisePickerProps = {
  onPick: (pick: { name: string; exerciseId: string | null }) => void;
};

export function ExercisePicker({ onPick }: ExercisePickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Exercise[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    debounceRef.current = setTimeout(() => {
      fetch(`/api/training/exercises?search=${encodeURIComponent(trimmed)}`)
        .then((res) => (res.ok ? res.json() : { exercises: [] }))
        .then((data: { exercises?: Exercise[] }) => {
          setResults((data.exercises ?? []).slice(0, 8));
        })
        .catch(() => setResults([]))
        .finally(() => setIsSearching(false));
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const pick = (name: string, exerciseId: string | null) => {
    onPick({ name, exerciseId });
    setQuery("");
    setResults([]);
  };

  const trimmed = query.trim();
  const exactMatch = results.some(
    (r) => r.name.toLowerCase() === trimmed.toLowerCase(),
  );

  return (
    <div>
      <div className="relative">
        <Search
          className={cn("absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2", TEXT_MUTED)}
          strokeWidth={1.5}
        />
        <Input
          value={query}
          // savedExerciseInputSchema caps names at 200 — a longer free-text
          // pick would block the whole save.
          maxLength={200}
          placeholder="Add exercise — search the catalog…"
          aria-label="Search exercises"
          className={cn("h-8 pl-7 text-xs", FOCUS_RING)}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {trimmed.length >= 2 && (
        <div className="mt-1 overflow-hidden rounded-[6px] border border-[rgba(13,148,136,0.08)] bg-white">
          {results.map((exercise) => (
            <button
              key={exercise.id}
              type="button"
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[rgba(13,148,136,0.05)]"
              onClick={() => pick(exercise.name, exercise.id)}
            >
              <span className={cn("min-w-0 flex-1 truncate text-xs", TEXT_PRIMARY)}>
                {exercise.name}
              </span>
              {exercise.muscleGroup && (
                <span className={cn("shrink-0 text-[10px] uppercase tracking-[0.06em]", TEXT_MUTED)}>
                  {exercise.muscleGroup}
                </span>
              )}
            </button>
          ))}
          {isSearching && results.length === 0 && (
            <div className={cn("px-2.5 py-1.5 text-xs", TEXT_MUTED)}>Searching…</div>
          )}
          {!exactMatch && !isSearching && (
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-1.5 border-t border-[rgba(13,148,136,0.08)] px-2.5 py-1.5 text-left text-xs hover:bg-[rgba(13,148,136,0.05)]",
                TEXT_SECONDARY,
              )}
              onClick={() => pick(trimmed, null)}
            >
              <Plus className="h-3 w-3" strokeWidth={1.5} />
              Use &ldquo;{trimmed}&rdquo;
            </button>
          )}
        </div>
      )}
    </div>
  );
}
