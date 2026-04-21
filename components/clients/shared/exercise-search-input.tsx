"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Plus, Search, Loader2, Sparkles } from "lucide-react";

type CatalogExercise = {
  id: string;
  name: string;
  muscleGroup?: string | null;
  coachId?: string | null;
};

type ExerciseSearchInputProps = {
  onSelect: (exerciseName: string) => void;
};

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

export function ExerciseSearchInput({ onSelect }: ExerciseSearchInputProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [results, setResults] = useState<CatalogExercise[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runSearch = useCallback(async (q: string) => {
    if (q.trim().length < MIN_QUERY_LENGTH) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsSearching(true);
    try {
      const res = await fetch(
        `/api/training/exercises?search=${encodeURIComponent(q.trim())}`,
        { signal: controller.signal }
      );
      if (!res.ok) {
        setResults([]);
        return;
      }
      const data = await res.json();
      setResults((data.exercises ?? []).slice(0, 8));
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setResults([]);
      }
    } finally {
      if (abortRef.current === controller) {
        setIsSearching(false);
      }
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void runSearch(query);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const trimmed = query.trim();
  const exactMatchExists = results.some(
    (r) => r.name.toLowerCase() === trimmed.toLowerCase()
  );
  const showCreateRow = trimmed.length > 0 && !exactMatchExists;

  // Combined list for keyboard navigation: catalog results, optionally followed by "create" row
  const totalItems = results.length + (showCreateRow ? 1 : 0);
  const createRowIndex = showCreateRow ? results.length : -1;

  const handleSelect = (exerciseName: string) => {
    onSelect(exerciseName);
    setQuery("");
    setResults([]);
    setOpen(false);
    setSelectedIndex(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || totalItems === 0) {
      if (e.key === "Enter" && trimmed) {
        e.preventDefault();
        handleSelect(trimmed);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < totalItems - 1 ? prev + 1 : prev));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIndex === createRowIndex && trimmed) {
        handleSelect(trimmed);
      } else if (results[selectedIndex]) {
        handleSelect(results[selectedIndex].name);
      } else if (trimmed) {
        handleSelect(trimmed);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const showPopover = open && (totalItems > 0 || isSearching);

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
            placeholder="Search exercise library..."
            className="h-8 pl-8 pr-8 text-sm"
          />
          {isSearching ? (
            <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-slate-400" />
          ) : (
            trimmed && (
              <button
                onClick={() => handleSelect(trimmed)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-primary transition-colors"
                aria-label="Add exercise"
              >
                <Plus className="h-4 w-4" />
              </button>
            )
          )}
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
        sideOffset={4}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="max-h-[260px] overflow-y-auto">
          {isSearching && results.length === 0 && (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Searching exercise library...
            </div>
          )}

          {!isSearching && results.length === 0 && trimmed.length < MIN_QUERY_LENGTH && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              Type at least {MIN_QUERY_LENGTH} characters to search
            </div>
          )}

          {results.map((exercise, idx) => (
            <button
              key={exercise.id}
              onClick={() => handleSelect(exercise.name)}
              className={cn(
                "w-full text-left px-3 py-2 text-sm transition-colors flex items-center justify-between gap-2",
                idx === selectedIndex
                  ? "bg-primary/10 text-primary"
                  : "text-foreground hover:bg-muted"
              )}
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="truncate">{exercise.name}</span>
                {exercise.coachId && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 flex-shrink-0">
                    Mine
                  </span>
                )}
              </span>
              {exercise.muscleGroup && (
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide flex-shrink-0">
                  {exercise.muscleGroup}
                </span>
              )}
            </button>
          ))}

          {showCreateRow && (
            <button
              onClick={() => handleSelect(trimmed)}
              className={cn(
                "w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2 border-t border-border",
                selectedIndex === createRowIndex
                  ? "bg-primary/10 text-primary"
                  : "text-foreground hover:bg-muted"
              )}
            >
              <Sparkles className="h-3.5 w-3.5 text-primary flex-shrink-0" />
              <span className="truncate">
                Create <span className="font-semibold">&ldquo;{trimmed}&rdquo;</span> as new exercise
              </span>
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
