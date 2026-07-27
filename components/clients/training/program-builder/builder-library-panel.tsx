"use client";

import { useState, type MouseEvent } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "@/components/programs/shared/segmented-control";
import { LibrarySessionList } from "./library-session-list";
import { LibraryExerciseList } from "./library-exercise-list";
import { LABEL_CLASS, TEXT_PRIMARY } from "./builder-tokens";

// The builder's single tabbed library panel (S4.5/S4.75) — the left column of
// the 3-column frame (icon strip · panel · builder): a flush 296px white
// column with a right border (not a floating card), a back-arrow header, the
// Sessions|Exercises switch, then the active list. Absorbs the retired
// standalone Sessions + Exercises pages: both tabs are drag sources from one
// place and carry all session/exercise CRUD. The page title moved out to the
// main column's header band (program-builder.tsx), mirroring the client
// detail pages where the sidebar names the context and the content area
// carries the title.
// Always present (view + edit); sits inside the builder's DndContext.
type LibraryTab = "sessions" | "exercises";

const TAB_OPTIONS = [
  { value: "sessions", label: "Sessions" },
  { value: "exercises", label: "Exercises" },
];

// The panel header follows the client-profile sidebar's grammar
// (components/clients/client-sidebar.tsx): a muted ArrowLeft on the left, the
// context it returns to named beside it. Same icon size, gap, colours and
// 13.5px/600 label so the two sidebars read as one system.
const BACK_ICON_CLASS =
  "h-4 w-4 shrink-0 text-[#93b0b4] transition-colors group-hover:text-[#5a7d82]";
const HEADER_TITLE_CLASS = "truncate text-[13.5px] font-semibold";

export function BuilderLibraryPanel({
  mode,
  // Present only in the client-scoped remounts (client-draft / placed-plan):
  // the header names the CLIENT under an "Editing for" eyebrow instead of a
  // destination, so only the arrow is interactive — a client's name is not
  // somewhere to navigate to. Library mode gets the "All programs" back link.
  clientName,
  // Accessible name for the icon-only back control (the client-scoped shape).
  backLabel,
  // The builder's single exit on EVERY target — the dark hero no longer
  // carries a back arrow, so this is also where the unsaved-changes guard runs.
  onBack,
}: {
  mode: "view" | "edit";
  clientName?: string;
  backLabel: string;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<LibraryTab>("sessions");
  const editable = mode === "edit";

  // Modified clicks open a new tab/window and cannot drop the current draft,
  // so leave those to the browser and keep the href meaningful. A plain click
  // routes through the builder's guarded exit instead of navigating.
  const handleBackLinkClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    onBack();
  };

  return (
    <aside className="sticky top-0 flex h-screen w-[296px] shrink-0 flex-col border-r border-[rgba(13,148,136,0.08)] bg-white">
      <div className="px-[18px] pt-[18px]">
        <div className="mb-3.5 flex items-center gap-2.5">
          {clientName ? (
            <>
              <button
                type="button"
                aria-label={backLabel}
                onClick={onBack}
                className="group shrink-0 rounded"
              >
                <ArrowLeft className={BACK_ICON_CLASS} />
              </button>
              <div className="min-w-0">
                <p className={LABEL_CLASS}>Editing for</p>
                <h2 className={cn(HEADER_TITLE_CLASS, TEXT_PRIMARY)}>{clientName}</h2>
              </div>
            </>
          ) : (
            <Link
              href="/dashboard/programs"
              onClick={handleBackLinkClick}
              className="group flex min-w-0 items-center gap-2.5 rounded"
            >
              <ArrowLeft className={BACK_ICON_CLASS} />
              <span className={cn("min-w-0", HEADER_TITLE_CLASS, TEXT_PRIMARY)}>
                All programs
              </span>
            </Link>
          )}
        </div>
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
