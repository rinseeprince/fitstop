"use client";

import { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { ChevronsLeft, ChevronsRight, GripVertical, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useStandaloneSessions } from "@/hooks/use-standalone-sessions";
import type { SavedSession } from "@/types/training";
import type { LibrarySessionDragData } from "./use-program-dnd";
import {
  CHIP_NEUTRAL_CLASS,
  FOCUS_RING,
  MONO_LABEL_CLASS,
  TEXT_MUTED,
  TEXT_PRIMARY,
  TRAINING_CARD_BORDER,
} from "./builder-tokens";

// In-flow sticky session-library rail beside the grid (mockup `libdrawer`).
// Deliberately NOT a Sheet: being part of the flex row keeps it inside the
// builder's single DndContext with no overlay to fight. Cards drag onto REST
// day cells (insert-as-clone; occupied cells are filtered out of collision).
// Collapsible to a slim rail so wide programs get the space back.
function LibrarySessionCard({ session }: { session: SavedSession }) {
  const dragData: LibrarySessionDragData = { type: "library-session", session };
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `lib-${session.id}`,
    data: dragData,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex cursor-grab items-start gap-1.5 rounded-[6px] bg-white p-2 transition-all active:cursor-grabbing",
        TRAINING_CARD_BORDER,
        isDragging && "opacity-40",
        "hover:-translate-y-px hover:shadow-[0_6px_20px_rgba(13,148,136,0.08)]",
      )}
      {...attributes}
      {...listeners}
    >
      <GripVertical className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", TEXT_MUTED)} strokeWidth={1.5} />
      <div className="min-w-0">
        <div className={cn("truncate text-xs font-semibold", TEXT_PRIMARY)}>
          {session.name}
        </div>
        <div className={cn("mt-0.5", MONO_LABEL_CLASS, "normal-case tracking-normal")}>
          {session.exercises.length} exercises
          {session.estimatedDurationMinutes != null &&
            ` · ${session.estimatedDurationMinutes} min`}
        </div>
        {session.focus && (
          <span className={cn("mt-1 inline-block", CHIP_NEUTRAL_CLASS)}>
            {session.focus}
          </span>
        )}
      </div>
    </div>
  );
}

export function SessionLibraryDrawer({ mode }: { mode: "view" | "edit" }) {
  const { sessions, isLoading } = useStandaloneSessions();
  const [query, setQuery] = useState("");
  const [minimized, setMinimized] = useState(false);

  // The drawer is a drag SOURCE — nothing to offer in view mode.
  if (mode !== "edit") return null;

  if (minimized) {
    return (
      <aside className="sticky top-4 shrink-0">
        <button
          type="button"
          aria-label="Expand session library"
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-[6px] bg-white text-[#5a7d82] transition-colors hover:bg-[#f0f5f4]",
            TRAINING_CARD_BORDER,
          )}
          onClick={() => setMinimized(false)}
        >
          <ChevronsLeft className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </aside>
    );
  }

  const q = query.trim().toLowerCase();
  const filtered = q
    ? sessions.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.focus ?? "").toLowerCase().includes(q),
      )
    : sessions;

  return (
    <aside
      className={cn(
        "sticky top-4 flex max-h-[calc(100vh-8rem)] w-[260px] shrink-0 flex-col rounded-[6px] bg-white p-3",
        TRAINING_CARD_BORDER,
      )}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className={cn("text-[13px] font-semibold", TEXT_PRIMARY)}>
          Session library
        </span>
        <button
          type="button"
          aria-label="Collapse session library"
          className="rounded p-1 text-[#93b0b4] transition-colors hover:bg-[#f0f5f4] hover:text-[#5a7d82]"
          onClick={() => setMinimized(true)}
        >
          <ChevronsRight className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>

      <div className="relative mb-2">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#93b0b4]"
          strokeWidth={1.5}
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sessions"
          className={cn("h-8 pl-8 text-xs", FOCUS_RING)}
        />
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
        {isLoading ? (
          <p className={cn("py-4 text-center text-xs", TEXT_MUTED)}>Loading…</p>
        ) : filtered.length === 0 ? (
          <p className={cn("px-1 py-4 text-center text-xs", TEXT_MUTED)}>
            {sessions.length === 0
              ? "No saved sessions yet — create one from any rest day."
              : "No sessions match your search."}
          </p>
        ) : (
          filtered.map((session) => (
            <LibrarySessionCard key={session.id} session={session} />
          ))
        )}
      </div>

      <p className={cn("mt-2 border-t border-[rgba(13,148,136,0.06)] pt-2 text-[11px] leading-relaxed", TEXT_MUTED)}>
        Drag a session onto a rest day, or click any rest day to add one there.
      </p>
    </aside>
  );
}
