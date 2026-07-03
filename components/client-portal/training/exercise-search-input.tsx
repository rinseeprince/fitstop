"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
} from "react";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

type CatalogExercise = {
  id: string;
  name: string;
  muscleGroup?: string | null;
  equipment?: string | null;
};

export type ExerciseSearchSelection = {
  name: string;
  exerciseId: string | undefined;
};

type ExerciseSearchInputProps = {
  value: string;
  onChange: (next: ExerciseSearchSelection) => void;
  placeholder?: string;
  ariaLabel?: string;
  testId?: string;
  disabled?: boolean;
  autoFocus?: boolean;
};

const DEBOUNCE_MS = 300;
const MIN_QUERY_CHARS = 2;

export function ExerciseSearchInput({
  value,
  onChange,
  placeholder = "Search or type exercise name...",
  ariaLabel = "Exercise name",
  testId,
  disabled,
  autoFocus,
}: ExerciseSearchInputProps) {
  const [results, setResults] = useState<CatalogExercise[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (query: string) => {
    if (query.length < MIN_QUERY_CHARS) {
      setResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const res = await fetch(
        `/api/client/exercises?search=${encodeURIComponent(query)}`,
      );
      if (res.ok) {
        const data = (await res.json()) as { exercises?: CatalogExercise[] };
        // Every match renders — the dropdown scrolls (max-h-48), so nothing
        // needs to be dropped.
        setResults(data.exercises ?? []);
      }
    } catch {
      // Non-critical — free-text fallback still works.
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleChange = (next: string) => {
    onChange({ name: next, exerciseId: undefined });
    setShowSuggestions(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void search(next);
    }, DEBOUNCE_MS);
  };

  const handleSelect = (exercise: CatalogExercise) => {
    onChange({ name: exercise.name, exerciseId: exercise.id });
    setShowSuggestions(false);
    setResults([]);
  };

  const handleBlur = (_e: FocusEvent<HTMLInputElement>) => {
    // Delay so onMouseDown on a result has a chance to fire first.
    setTimeout(() => setShowSuggestions(false), 200);
  };

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#93b0b4]" />
      <Input
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => results.length > 0 && setShowSuggestions(true)}
        onBlur={handleBlur}
        placeholder={placeholder}
        aria-label={ariaLabel}
        data-testid={testId}
        autoComplete="off"
        disabled={disabled}
        autoFocus={autoFocus}
        className="pl-8"
      />
      {isSearching && (
        <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-[#93b0b4]" />
      )}
      {showSuggestions && results.length > 0 && (
        <div
          data-testid={testId ? `${testId}-dropdown` : undefined}
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-[6px] border border-[rgba(13,148,136,0.12)] bg-white shadow-lg"
        >
          {results.map((exercise) => (
            <button
              key={exercise.id}
              type="button"
              data-testid={
                testId ? `${testId}-option-${exercise.id}` : undefined
              }
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(exercise);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[rgba(13,148,136,0.05)]"
            >
              <span className="text-[#0c1a1e]">{exercise.name}</span>
              {exercise.muscleGroup && (
                <span className="rounded-[3px] bg-[rgba(13,148,136,0.05)] px-1.5 py-0.5 text-[10px] text-[#93b0b4]">
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
