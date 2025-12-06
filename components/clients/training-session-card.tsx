"use client";

import { useState } from "react";
import type { TrainingSession } from "@/types/training";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { TrainingExerciseRow } from "./training-exercise-row";
import { AddExerciseDialog } from "./add-exercise-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Plus, Clock, Trash2, Check, X, Loader2 } from "lucide-react";

type TrainingSessionCardProps = {
  session: TrainingSession;
  clientId: string;
  planId: string;
  editMode: boolean;
  onUpdate: () => void;
};

export function TrainingSessionCard({
  session,
  clientId,
  planId,
  editMode,
  onUpdate,
}: TrainingSessionCardProps) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editedName, setEditedName] = useState(session.name);
  const [editedFocus, setEditedFocus] = useState(session.focus || "");
  const [showAddExercise, setShowAddExercise] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/training/${planId}/sessions/${session.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: editedName,
            focus: editedFocus || null,
          }),
        }
      );

      if (!res.ok) throw new Error("Failed to update session");

      toast({ title: "Session updated" });
      setIsEditing(false);
      onUpdate();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update session",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/training/${planId}/sessions/${session.id}`,
        { method: "DELETE" }
      );

      if (!res.ok) throw new Error("Failed to delete session");

      toast({ title: "Session deleted" });
      onUpdate();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete session",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const getDayLabel = (day?: string) => {
    if (!day) return null;
    return day.charAt(0).toUpperCase() + day.slice(1);
  };

  return (
    <>
      <Accordion type="single" collapsible className="border rounded-lg">
        <AccordionItem value={session.id} className="border-0">
          <AccordionTrigger className="px-4 hover:no-underline">
            <div className="flex flex-1 items-center justify-between pr-2">
              <div className="flex items-center gap-3">
                {isEditing && editMode ? (
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <Input
                      value={editedName}
                      onChange={(e) => setEditedName(e.target.value)}
                      className="h-8 w-40"
                    />
                    <Button size="sm" variant="ghost" onClick={handleSave} disabled={isSaving}>
                      {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isSaving}
                      onClick={() => {
                        setIsEditing(false);
                        setEditedName(session.name);
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <span
                    className="font-medium"
                    onClick={(e) => {
                      if (editMode) {
                        e.stopPropagation();
                        setIsEditing(true);
                      }
                    }}
                  >
                    {session.name}
                  </span>
                )}
                {session.focus && !isEditing && (
                  <span className="text-sm text-muted-foreground">- {session.focus}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {session.dayOfWeek && (
                  <Badge variant="outline" className="text-xs">
                    {getDayLabel(session.dayOfWeek)}
                  </Badge>
                )}
                {session.estimatedDurationMinutes && (
                  <Badge variant="secondary" className="text-xs">
                    <Clock className="h-3 w-3 mr-1" />
                    {session.estimatedDurationMinutes}min
                  </Badge>
                )}
                <Badge variant="secondary" className="text-xs">
                  {session.exercises.length} exercises
                </Badge>
                {editMode && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDeleteConfirm(true);
                    }}
                    disabled={isDeleting}
                  >
                    {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                )}
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4">
            {session.notes && (
              <p className="text-sm text-muted-foreground mb-3 italic">{session.notes}</p>
            )}

            {/* Exercises Table */}
            <div className="space-y-1">
              {/* Header */}
              <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-2 py-1">
                <div className="col-span-4">Exercise</div>
                <div className="col-span-2 text-center">Sets × Reps</div>
                <div className="col-span-2 text-center">RPE</div>
                <div className="col-span-2 text-center">Rest</div>
                <div className="col-span-2"></div>
              </div>

              {/* Exercise Rows */}
              {session.exercises.map((exercise) => (
                <TrainingExerciseRow
                  key={exercise.id}
                  exercise={exercise}
                  clientId={clientId}
                  planId={planId}
                  sessionId={session.id}
                  editMode={editMode}
                  onUpdate={onUpdate}
                />
              ))}

              {/* Add Exercise Button */}
              {editMode && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full mt-2"
                  onClick={() => setShowAddExercise(true)}
                >
                  <Plus className="h-4 w-4 mr-1" /> Add Exercise
                </Button>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <AddExerciseDialog
        clientId={clientId}
        planId={planId}
        sessionId={session.id}
        open={showAddExercise}
        onOpenChange={setShowAddExercise}
        onSuccess={onUpdate}
      />

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete Session"
        description={`Are you sure you want to delete "${session.name}" and all its exercises? This action cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        destructive
      />
    </>
  );
}
