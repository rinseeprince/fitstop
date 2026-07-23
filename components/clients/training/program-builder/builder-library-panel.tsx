"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "@/components/programs/shared/segmented-control";
import { LibrarySessionList } from "./library-session-list";
import { LibraryExerciseList } from "./library-exercise-list";
import { LABEL_CLASS, TEXT_PRIMARY, TEXT_SECONDARY } from "./builder-tokens";

// The builder's single tabbed library panel (S4.5/S4.75) — the left column of
// the 3-column frame (icon strip · panel · builder), matched to the reference
// `.library`: a flush 296px white column with a right border (not a floating
// card), the `.lib-head` (crumb + title + Sessions|Exercises switch), then the
// active list. Absorbs the retired standalone Sessions + Exercises pages: both
// tabs are drag sources from one place and carry all session/exercise CRUD.
// Always present (view + edit); sits inside the builder's DndContext.
type LibraryTab = "sessions" | "exercises";

const TAB_OPTIONS = [
  { value: "sessions", label: "Sessions" },
  { value: "exercises", label: "Exercises" },
];

export function BuilderLibraryPanel({
  mode,
  // Library mode links back to /dashboard/programs. In the client-draft
  // remount (Phase 5) the panel lives in the coach's client drawer, where that
  // link would navigate away from the client page — hide it (the builder's own
  // back arrow returns to the library list).
  showBackLink = true,
  // Present only in the client-draft remount: titles the panel with the
  // client's name ("Editing for {name}") so the coach can tell this apart from
  // the generic /dashboard/programs "Program Builder".
  clientName,
}: {
  mode: "view" | "edit";
  showBackLink?: boolean;
  clientName?: string;
}) {
  const [tab, setTab] = useState<LibraryTab>("sessions");
  const editable = mode === "edit";

  return (
    <aside className="sticky top-0 flex h-screen w-[296px] shrink-0 flex-col border-r border-[rgba(13,148,136,0.08)] bg-white">
      <div className="px-[18px] pt-[18px]">
        {showBackLink && (
          <Link
            href="/dashboard/programs"
            className={cn(
              "mb-3.5 inline-flex items-center gap-1.5 rounded text-[12.5px] font-medium transition-colors hover:text-[#0a5c55]",
              TEXT_SECONDARY,
            )}
          >
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
            All programs
          </Link>
        )}
        {clientName ? (
          <div className="mb-3.5">
            <p className={LABEL_CLASS}>Editing for</p>
            <h2
              className={cn(
                "mt-0.5 truncate text-base font-semibold tracking-[-0.01em]",
                TEXT_PRIMARY,
              )}
            >
              {clientName}
            </h2>
          </div>
        ) : (
          <h2 className={cn("mb-3.5 text-base font-semibold tracking-[-0.01em]", TEXT_PRIMARY)}>
            Program Builder
          </h2>
        )}
        <div className="mb-3">
          <SegmentedControl
            fullWidth
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
