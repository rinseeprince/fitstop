"use client";

import { useState, useMemo } from "react";
import { useDraggable } from "@dnd-kit/core";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSavedPlans } from "@/hooks/use-saved-plans";
import { useStandaloneSessions } from "@/hooks/use-standalone-sessions";
import { LayoutGrid, Dumbbell, Loader2, GripVertical } from "lucide-react";
import type { SavedPlan, SavedSession } from "@/types/training";

type LibraryPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function LibraryPanel({ open, onOpenChange }: LibraryPanelProps) {
  const { plans, isLoading: plansLoading } = useSavedPlans();
  const { sessions, isLoading: sessionsLoading } = useStandaloneSessions();
  const [search, setSearch] = useState("");

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
        className="w-[280px] p-0 flex flex-col"
        overlayClassName="bg-transparent pointer-events-none"
      >
        <SheetHeader className="p-3 pb-2">
          <SheetTitle className="text-sm font-semibold">Library</SheetTitle>
          <Input
            placeholder="Search..."
            className="h-7 text-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </SheetHeader>

        <Tabs defaultValue="plans" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="mx-3 h-8">
            <TabsTrigger value="plans" className="text-[11px]">
              <LayoutGrid className="h-3 w-3 mr-1" /> Plans
            </TabsTrigger>
            <TabsTrigger value="sessions" className="text-[11px]">
              <Dumbbell className="h-3 w-3 mr-1" /> Sessions
            </TabsTrigger>
          </TabsList>

          <TabsContent value="plans" className="flex-1 overflow-y-auto px-3 pb-3 mt-2">
            {plansLoading ? (
              <LoadingState />
            ) : filteredPlans.length === 0 ? (
              <EmptyState label="No saved plans" />
            ) : (
              <div className="space-y-2">
                {filteredPlans.map((plan) => (
                  <DraggablePlanCard key={plan.id} plan={plan} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="sessions" className="flex-1 overflow-y-auto px-3 pb-3 mt-2">
            {sessionsLoading ? (
              <LoadingState />
            ) : filteredSessions.length === 0 ? (
              <EmptyState label="No standalone sessions" />
            ) : (
              <div className="space-y-2">
                {filteredSessions.map((session) => (
                  <DraggableSessionCard key={session.id} session={session} />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

// --- Draggable cards ---

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
      className={`bg-card border rounded-md p-2 cursor-grab active:cursor-grabbing ${isDragging ? "opacity-50" : ""}`}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-start gap-1.5">
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium line-clamp-1">{plan.name}</p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {plan.splitType && (
              <Badge variant="outline" className="text-[9px] h-4">
                {plan.splitType.replace(/_/g, " ")}
              </Badge>
            )}
            <Badge variant="secondary" className="text-[9px] h-4">
              {trainingCount} sessions
            </Badge>
            {plan.programDurationWeeks && (
              <Badge variant="secondary" className="text-[9px] h-4">
                {plan.programDurationWeeks} wk
              </Badge>
            )}
          </div>
        </div>
      </div>
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
      className={`bg-card border rounded-md p-2 cursor-grab active:cursor-grabbing ${isDragging ? "opacity-50" : ""}`}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-start gap-1.5">
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium line-clamp-1">{session.name}</p>
          <div className="flex items-center gap-1.5 mt-1">
            {session.focus && (
              <Badge variant="outline" className="text-[9px] h-4">
                {session.focus}
              </Badge>
            )}
            <Badge variant="secondary" className="text-[9px] h-4">
              {exerciseCount} exercises
            </Badge>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-8">
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="text-center py-8 text-muted-foreground">
      <p className="text-xs">{label}</p>
    </div>
  );
}
