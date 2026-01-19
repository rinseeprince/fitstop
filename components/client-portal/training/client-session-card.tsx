"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  CheckCircle2,
  Circle,
  ChevronDown,
  Clock,
  Dumbbell,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TrainingSession } from "@/types/training";

interface ClientSessionCardProps {
  session: TrainingSession;
  isCompleted: boolean;
  onToggleComplete: (isComplete: boolean) => void;
}

export function ClientSessionCard({
  session,
  isCompleted,
  onToggleComplete,
}: ClientSessionCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isToggling, setIsToggling] = useState(false);

  const handleToggle = async () => {
    setIsToggling(true);
    try {
      await onToggleComplete(!isCompleted);
    } finally {
      setIsToggling(false);
    }
  };

  const exerciseCount = session.exercises.filter((e) => !e.isWarmup).length;
  const warmupCount = session.exercises.filter((e) => e.isWarmup).length;

  return (
    <Card className={cn(isCompleted && "border-primary/30 bg-primary/5")}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base truncate">{session.name}</CardTitle>
              {session.dayOfWeek && (
                <Badge variant="outline" className="shrink-0 capitalize">
                  {session.dayOfWeek}
                </Badge>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Dumbbell className="h-3.5 w-3.5" />
                {exerciseCount} exercises
              </span>
              {session.estimatedDurationMinutes && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {session.estimatedDurationMinutes} min
                </span>
              )}
            </div>
          </div>

          <Button
            variant={isCompleted ? "default" : "outline"}
            size="sm"
            onClick={handleToggle}
            disabled={isToggling}
            className={cn(
              "shrink-0",
              isCompleted && "bg-primary hover:bg-primary/90"
            )}
          >
            {isCompleted ? (
              <>
                <CheckCircle2 className="mr-1 h-4 w-4" />
                Done
              </>
            ) : (
              <>
                <Circle className="mr-1 h-4 w-4" />
                Mark Done
              </>
            )}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-2">
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-between text-muted-foreground hover:text-foreground"
            >
              <span>View exercises</span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform",
                  isOpen && "rotate-180"
                )}
              />
            </Button>
          </CollapsibleTrigger>

          <CollapsibleContent className="mt-3">
            <div className="space-y-2">
              {warmupCount > 0 && (
                <>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Warm-up
                  </p>
                  {session.exercises
                    .filter((e) => e.isWarmup)
                    .map((exercise) => (
                      <ExerciseRow key={exercise.id} exercise={exercise} />
                    ))}
                  <p className="mt-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Main Workout
                  </p>
                </>
              )}
              {session.exercises
                .filter((e) => !e.isWarmup)
                .map((exercise) => (
                  <ExerciseRow key={exercise.id} exercise={exercise} />
                ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

function ExerciseRow({
  exercise,
}: {
  exercise: TrainingSession["exercises"][0];
}) {
  const repsDisplay = exercise.repsTarget
    ? exercise.repsTarget
    : exercise.repsMin && exercise.repsMax
    ? `${exercise.repsMin}-${exercise.repsMax}`
    : exercise.repsMin
    ? `${exercise.repsMin}+`
    : "";

  return (
    <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
      <span className="font-medium">{exercise.name}</span>
      <div className="flex items-center gap-3 text-muted-foreground">
        <span>{exercise.sets} sets</span>
        {repsDisplay && <span>{repsDisplay} reps</span>}
        {exercise.rpeTarget && <span>RPE {exercise.rpeTarget}</span>}
      </div>
    </div>
  );
}
