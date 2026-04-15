"use client";

import { useState, useCallback } from "react";
import { Loader2, Save, Trash2, Calendar } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useSavedPlan } from "@/hooks/use-saved-plan";
import { PreviewSessionCard } from "./preview-session-card";
import type { SavedSession, SavedExercise } from "@/types/training";

type PlanPreviewDrawerProps = {
  savedPlanId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDiscard?: () => void;
};

export function PlanPreviewDrawer({
  savedPlanId,
  open,
  onOpenChange,
  onDiscard,
}: PlanPreviewDrawerProps) {
  const { toast } = useToast();
  const { plan, isLoading, mutate } = useSavedPlan(savedPlanId);
  const [isPromoting, setIsPromoting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const baseUrl = `/api/training/saved-plans/${savedPlanId}`;

  /** Shared fetch helper: makes the request, checks response, toasts on failure, mutates on success. */
  const apiCall = useCallback(async (url: string, options: RequestInit, errorMessage: string) => {
    try {
      const res = await fetch(url, options);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast({ title: "Error", description: data.error || errorMessage, variant: "destructive" });
        return;
      }
      await mutate();
    } catch {
      toast({ title: "Error", description: errorMessage, variant: "destructive" });
    }
  }, [mutate, toast]);

  const patchPlan = useCallback((updates: Record<string, unknown>) =>
    apiCall(baseUrl, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates) }, "Failed to update plan"),
  [baseUrl, apiCall]);

  const patchSession = useCallback((sessionId: string, updates: Partial<SavedSession>) =>
    apiCall(`${baseUrl}/sessions/${sessionId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates) }, "Failed to update session"),
  [baseUrl, apiCall]);

  const patchExercise = useCallback((sessionId: string, exerciseId: string, updates: Partial<SavedExercise>) =>
    apiCall(`${baseUrl}/sessions/${sessionId}/exercises/${exerciseId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates) }, "Failed to update exercise"),
  [baseUrl, apiCall]);

  const removeSession = useCallback((sessionId: string) =>
    apiCall(`${baseUrl}/sessions/${sessionId}`, { method: "DELETE" }, "Failed to remove session"),
  [baseUrl, apiCall]);

  const removeExercise = useCallback((sessionId: string, exerciseId: string) =>
    apiCall(`${baseUrl}/sessions/${sessionId}/exercises/${exerciseId}`, { method: "DELETE" }, "Failed to remove exercise"),
  [baseUrl, apiCall]);

  const handlePromote = async () => {
    setIsPromoting(true);
    try {
      const res = await fetch(`${baseUrl}/promote`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      if (data.nameConflict) {
        toast({ title: "Name conflict", description: data.nameConflict, variant: "destructive" });
        return;
      }
      toast({ title: "Saved to library" });
      onOpenChange(false);
    } catch (error) {
      toast({ title: "Error", description: error instanceof Error ? error.message : "Failed to save", variant: "destructive" });
    } finally {
      setIsPromoting(false);
    }
  };

  const handleDiscard = async () => {
    setIsDeleting(true);
    try {
      await fetch(baseUrl, { method: "DELETE" });
      toast({ title: "Draft discarded" });
      onDiscard?.();
      onOpenChange(false);
    } catch {
      toast({ title: "Error", description: "Failed to discard", variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  };

  const defaultSurplus = plan?.defaultSurplusPercentage ?? 15;
  const sessions = plan?.sessions ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:w-[600px] md:w-[700px] p-0 flex flex-col [&>[data-slot=sheet-close]]:hidden"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Plan Preview</SheetTitle>
        </SheetHeader>

        {isLoading || !plan ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Top bar */}
            <div className="border-b p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Input
                  className="text-lg font-semibold border-0 p-0 h-auto focus-visible:ring-0"
                  defaultValue={plan.name}
                  onBlur={(e) => void patchPlan({ name: e.target.value })}
                />
                {plan.splitType && (
                  <Badge variant="outline" className="text-[10px] flex-shrink-0">
                    {plan.splitType.replace(/_/g, " ")}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                {plan.cycleLength && (
                  <span>{plan.cycleLength}-day cycle</span>
                )}
                <div className="flex items-center gap-1">
                  <span>Default surplus:</span>
                  <Input
                    className="h-5 w-12 text-xs text-center px-1 inline-block"
                    type="number"
                    defaultValue={defaultSurplus}
                    onBlur={(e) => void patchPlan({ defaultSurplusPercentage: parseFloat(e.target.value) || 15 })}
                  />
                  <span>%</span>
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 px-4 py-2 border-b">
              <Button
                size="sm"
                variant="default"
                onClick={() => void handlePromote()}
                disabled={isPromoting}
              >
                {isPromoting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
                Save to Library
              </Button>
              <Button size="sm" variant="outline" disabled>
                <Calendar className="h-3.5 w-3.5 mr-1.5" />
                Apply to Client
              </Button>
              <div className="flex-1" />
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={() => void handleDiscard()}
                disabled={isDeleting}
              >
                {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
                Discard
              </Button>
            </div>

            {/* Session list */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {sessions.map((session) => (
                <PreviewSessionCard
                  key={session.id}
                  session={session}
                  defaultSurplus={defaultSurplus}
                  onUpdateSession={(updates) => void patchSession(session.id, updates)}
                  onRemoveSession={() => void removeSession(session.id)}
                  onUpdateExercise={(exId, updates) => void patchExercise(session.id, exId, updates)}
                  onRemoveExercise={(exId) => void removeExercise(session.id, exId)}
                  onAddExercise={() => {
                    // Placeholder for add exercise dialog
                    toast({ title: "Add exercise", description: "Exercise catalog dialog coming in a future update" });
                  }}
                />
              ))}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
