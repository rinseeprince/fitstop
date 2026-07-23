"use client";

import { useRef, useState } from "react";
import { History, Plus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MIN_SEARCH_CHARS, useExerciseSearch } from "@/hooks/use-exercise-search";
import { useRecentExercises } from "@/hooks/use-recent-exercises";
import { FOCUS_RING, LABEL_CLASS, TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY } from "./builder-tokens";

// Single-EXERCISE catalog picker (saved-session insertion is Phase 3).
// Instant search over the SWR-cached catalog (name + aliases) — every match
// renders inside a scrollable list, nothing is dropped. Free-text fallback
// adds by name with exerciseId null; the server resolves / creates the
// catalog row on save (resolveExercises). While the query is empty, a
// focused picker offers the coach's recently used exercises instead.
type ExercisePickerProps = {
  onPick: (pick: { name: string; exerciseId: string | null }) => void;
};

const ROW_CLASS =
  "flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[rgba(13,148,136,0.05)]";

export function ExercisePicker({ onPick }: ExercisePickerProps) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { results, isLoading } = useExerciseSearch(query);
  const { recent } = useRecentExercises();

  const pick = (name: string, exerciseId: string | null) => {
    onPick({ name, exerciseId });
    setQuery("");
    // Re-focus the input: picking unmounts the clicked row, and a focused
    // element removed from the DOM fires no blur — `focused` would strand
    // true with nothing inside the container focused (keyboard picks hit
    // this in every browser). Also keeps multi-add flowing.
    inputRef.current?.focus();
  };

  const trimmed = query.trim();
  const exactMatch = results.some(
    (r) => r.name.toLowerCase() === trimmed.toLowerCase(),
  );
  const showResults = trimmed.length >= MIN_SEARCH_CHARS;
  const showRecent = !showResults && focused && recent.length > 0;

  return (
    <div
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        // Focus-within: keep the recents strip up while tabbing onto its rows.
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
    >
      <div className="relative">
        <Search
          className={cn("absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2", TEXT_MUTED)}
          strokeWidth={1.5}
        />
        <Input
          ref={inputRef}
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

      {showResults && (
        <div className="mt-1 overflow-hidden rounded-[6px] border border-[rgba(13,148,136,0.08)] bg-white">
          <div className="max-h-64 overflow-y-auto">
            {results.map((exercise) => (
              <button
                key={exercise.id}
                type="button"
                className={ROW_CLASS}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(exercise.name, exercise.id)}
              >
                <span className={cn("min-w-0 flex-1 truncate text-xs", TEXT_PRIMARY)}>
                  {exercise.name}
                </span>
                {exercise.muscleGroup && (
                  <span className={cn("shrink-0", LABEL_CLASS)}>
                    {exercise.muscleGroup}
                  </span>
                )}
              </button>
            ))}
            {isLoading && results.length === 0 && (
              <div className={cn("px-2.5 py-1.5 text-xs", TEXT_MUTED)}>Searching…</div>
            )}
          </div>
          {!exactMatch && !isLoading && (
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-1.5 border-t border-[rgba(13,148,136,0.08)] px-2.5 py-1.5 text-left text-xs hover:bg-[rgba(13,148,136,0.05)]",
                TEXT_SECONDARY,
              )}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(trimmed, null)}
            >
              <Plus className="h-3 w-3" strokeWidth={1.5} />
              Use &ldquo;{trimmed}&rdquo;
            </button>
          )}
        </div>
      )}

      {showRecent && (
        <div className="mt-1 overflow-hidden rounded-[6px] border border-[rgba(13,148,136,0.08)] bg-white">
          <div
            className={cn(
              "flex items-center gap-1.5 px-2.5 pb-1 pt-1.5",
              LABEL_CLASS,
            )}
          >
            <History className="h-3 w-3" strokeWidth={1.5} />
            Recently used
          </div>
          {recent.map((exercise) => (
            <button
              key={exercise.exerciseId}
              type="button"
              className={ROW_CLASS}
              // Keep the input focused through the click (Safari never focuses
              // buttons on mousedown, so relatedTarget alone can't cover this).
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(exercise.name, exercise.exerciseId)}
            >
              <span className={cn("min-w-0 flex-1 truncate text-xs", TEXT_PRIMARY)}>
                {exercise.name}
              </span>
              {exercise.muscleGroup && (
                <span className={cn("shrink-0", LABEL_CLASS)}>
                  {exercise.muscleGroup}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
