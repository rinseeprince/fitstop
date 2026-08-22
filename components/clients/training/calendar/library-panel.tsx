"use client";

import { useState, useMemo } from "react";
import { useDraggable } from "@dnd-kit/core";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "@/components/programs/shared/segmented-control";
import {
  CHIP_NEUTRAL_CLASS,
  LABEL_CLASS,
  MONO_LABEL_CLASS,
  THUMB_CLASS,
  TRAINING_CARD_BORDER,
} from "@/components/clients/training/program-builder/builder-tokens";
import { useSavedPlans } from "@/hooks/use-saved-plans";
import { useStandaloneSessions } from "@/hooks/use-standalone-sessions";
import { LayoutGrid, Dumbbell, Loader2, GripVertical } from "lucide-react";
import type { SavedPlan, SavedSession } from "@/types/training";
import { LibrarySearchInput } from "@/components/programs/shared/library-search-input";

type LibraryPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// Non-modal left Sheet for dragging library plans/sessions onto the calendar.
// The Sheet mechanics and the drag-data shapes ({type, id, plan|session} —
// use-calendar-dnd reads `.type` and `.id`) are load-bearing; the card
// language mirrors the builder's library panel.
export function LibraryPanel({ open, onOpenChange }: LibraryPanelProps) {
  const { plans, isLoading: plansLoading } = useSavedPlans();
  const { sessions, isLoading: sessionsLoading } = useStandaloneSessions();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"plans" | "sessions">("plans");

  const savedPlans = useMemo(
    () => plans.filter((p) => p.status === "saved"),
    [plans]
  );

  const filteredPlans = useMemo(() => {
    if (!search.trim()) return savedPlans;
    const q = search.toLowerCase();
    return savedPlans.filter(
      (p) => p.name.toLowerCase().includes(q) || p.splitType?.toLowerCase().includes(q)
    );
  }, [savedPlans, search]);

  const filteredSessions = useMemo(() => {
    if (!search.trim()) return sessions;
    const q = search.toLowerCase();
    return sessions.filter(
      (s) => s.name.toLowerCase().includes(q) || s.focus?.toLowerCase().includes(q)
    );
  }, [sessions, search]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="left"
        className="flex w-[280px] flex-col gap-0 bg-white p-0"
        overlayClassName="bg-transparent pointer-events-none"
      >
        <SheetHeader className="space-y-2 px-[14px] pb-2 pt-[14px]">
          <SheetTitle className="text-base font-semibold tracking-[-0.01em] text-[#0c1a1e]">
            Library
          </SheetTitle>
          <SegmentedControl
            fullWidth
            options={[
              { value: "plans", label: "Plans" },
              { value: "sessions", label: "Sessions" },
            ]}
            value={tab}
            onChange={(value) => setTab(value as "plans" | "sessions")}
          />
          <LibrarySearchInput
            size="panel"
            value={search}
            onChange={setSearch}
            placeholder="Search"
          />
        </SheetHeader>

        <p className={cn(LABEL_CLASS, "px-[14px] pb-1.5")}>
          Drag onto a calendar day
        </p>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-[14px] pb-3">
          {tab === "plans" ? (
            plansLoading ? (
              <LoadingState />
            ) : filteredPlans.length === 0 ? (
              <EmptyState icon="plans" label="No saved plans" />
            ) : (
              filteredPlans.map((plan) => (
                <DraggablePlanCard key={plan.id} plan={plan} />
              ))
            )
          ) : sessionsLoading ? (
            <LoadingState />
          ) : filteredSessions.length === 0 ? (
            <EmptyState icon="sessions" label="No standalone sessions" />
          ) : (
            filteredSessions.map((session) => (
              <DraggableSessionCard key={session.id} session={session} />
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// --- Draggable cards ---

const CARD_CLASS = cn(
  "flex cursor-grab items-center gap-2 rounded-[6px] bg-white p-2 pl-1.5 transition-all active:cursor-grabbing hover:-translate-y-px hover:shadow-[0_6px_20px_rgba(13,148,136,0.08)]",
  TRAINING_CARD_BORDER
);

function DraggablePlanCard({ plan }: { plan: SavedPlan }) {
  const trainingCount = plan.sessions?.filter((s) => !s.isRest).length ?? 0;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `library-plan-${plan.id}`,
    data: { type: "library-plan", id: plan.id, plan },
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(CARD_CLASS, isDragging && "opacity-40")}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="h-3.5 w-3.5 shrink-0 text-[#93b0b4]" strokeWidth={1.5} />
      <div className={cn(THUMB_CLASS, "h-[30px] w-[30px]")}>
        <LayoutGrid className="h-[15px] w-[15px]" strokeWidth={1.5} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-[#0c1a1e]">{plan.name}</p>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className={cn(MONO_LABEL_CLASS, "normal-case tracking-normal")}>
            {trainingCount} sessions
            {plan.programDurationWeeks ? ` · ${plan.programDurationWeeks} wk` : ""}
          </span>
        </div>
      </div>
      {plan.splitType && (
        <span className={cn(CHIP_NEUTRAL_CLASS, "shrink-0 truncate max-w-[72px]")}>
          {plan.splitType.replace(/_/g, " ")}
        </span>
      )}
    </div>
  );
}

function DraggableSessionCard({ session }: { session: SavedSession }) {
  const exerciseCount = session.exercises?.length ?? 0;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `library-session-${session.id}`,
    data: { type: "library-session", id: session.id, session },
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(CARD_CLASS, isDragging && "opacity-40")}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="h-3.5 w-3.5 shrink-0 text-[#93b0b4]" strokeWidth={1.5} />
      <div className={cn(THUMB_CLASS, "h-[30px] w-[30px]")}>
        <Dumbbell className="h-[15px] w-[15px]" strokeWidth={1.5} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-[#0c1a1e]">{session.name}</p>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className={cn(MONO_LABEL_CLASS, "normal-case tracking-normal")}>
            {exerciseCount} exercises
          </span>
        </div>
      </div>
      {session.focus && (
        <span className={cn(CHIP_NEUTRAL_CLASS, "shrink-0 truncate max-w-[72px]")}>
          {session.focus}
        </span>
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-8">
      <Loader2 className="h-4 w-4 animate-spin text-[#93b0b4]" />
    </div>
  );
}

function EmptyState({ icon, label }: { icon: "plans" | "sessions"; label: string }) {
  const Icon = icon === "plans" ? LayoutGrid : Dumbbell;
  return (
    <div className="py-8 text-center text-[#5a7d82]">
      <Icon className="mx-auto mb-2 h-8 w-8 opacity-50" strokeWidth={1.5} />
      <p className="text-xs text-[#93b0b4]">{label}</p>
    </div>
  );
}
