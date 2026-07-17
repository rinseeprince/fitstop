"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "@/components/programs/shared/segmented-control";
import { LibrarySessionList } from "./library-session-list";
import { LibraryExerciseList } from "./library-exercise-list";
import { TEXT_PRIMARY, TEXT_SECONDARY, TRAINING_CARD_BORDER } from "./builder-tokens";

// The builder's single tabbed library panel (S4.5) — the left column of the
// 3-column frame (icon strip · panel · builder). Absorbs the retired standalone
// Sessions + Exercises pages: both tabs are drag sources from one place and
// carry all session/exercise CRUD. Always present (view + edit); it sits inside
// the builder's DndContext so its cards drag onto the grid. Fixed width — the
// grid keeps its own horizontal scroll, so no collapse is needed.
type LibraryTab = "sessions" | "exercises";

const TAB_OPTIONS = [
  { value: "sessions", label: "Sessions" },
  { value: "exercises", label: "Exercises" },
];

export function BuilderLibraryPanel({ mode }: { mode: "view" | "edit" }) {
  const [tab, setTab] = useState<LibraryTab>("sessions");
  const editable = mode === "edit";

  return (
    <aside
      className={cn(
        "sticky top-4 flex max-h-[calc(100vh-8rem)] w-[296px] shrink-0 flex-col rounded-[6px] bg-white",
        TRAINING_CARD_BORDER,
      )}
    >
      <div className="px-3 pt-3">
        <Link
          href="/dashboard/programs"
          className={cn(
            "inline-flex items-center gap-1.5 rounded text-xs font-medium transition-colors hover:text-[#0a5c55]",
            TEXT_SECONDARY,
          )}
        >
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
          All programs
        </Link>
        <h2 className={cn("mb-2.5 mt-2 text-sm font-semibold", TEXT_PRIMARY)}>
          Library
        </h2>
        <div className="mb-3">
          <SegmentedControl
            options={TAB_OPTIONS}
            value={tab}
            onChange={(v) => setTab(v as LibraryTab)}
          />
        </div>
      </div>

      {tab === "sessions" ? (
        <LibrarySessionList editable={editable} />
      ) : (
        <LibraryExerciseList editable={editable} />
      )}
    </aside>
  );
}
