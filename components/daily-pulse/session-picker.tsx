"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dumbbell } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TrainingSession } from "@/types/training";

interface SessionPickerProps {
  currentTrainingSession: TrainingSession | null;
  originalScheduledSessionId: string | null;
  selectedAlternativeSession: string | null;
  allTrainingSessions: TrainingSession[];
  showSessionPicker: boolean;
  setShowSessionPicker: (show: boolean) => void;
  onAlternativeSessionSelect: (sessionId: string | null) => void;
  isOrphaned?: boolean;
}

export function SessionPicker({
  currentTrainingSession,
  originalScheduledSessionId,
  selectedAlternativeSession,
  allTrainingSessions,
  showSessionPicker,
  setShowSessionPicker,
  onAlternativeSessionSelect,
  isOrphaned = false,
}: SessionPickerProps) {
  if (currentTrainingSession) {
    return (
      <div className="space-y-3">
        <Label className="text-base">
          {isOrphaned ? (
            <>
              Logged Session: {currentTrainingSession.name}
              <span className="text-xs text-muted-foreground ml-2">(from previous plan)</span>
            </>
          ) : (
            <>Today's Session: {currentTrainingSession.name}</>
          )}
        </Label>
        
        {!showSessionPicker && !selectedAlternativeSession && !isOrphaned && (
          <Button
            variant="outline"
            size="sm"
            className="h-auto p-0"
            onClick={() => setShowSessionPicker(true)}
          >
            Do a different session
          </Button>
        )}

        {!showSessionPicker && selectedAlternativeSession && !isOrphaned && (
          <Button
            variant="outline"
            size="sm"
            className="h-auto p-0"
            onClick={() => setShowSessionPicker(true)}
          >
            Change session
          </Button>
        )}

        {showSessionPicker && !isOrphaned && (
          <div className="space-y-2">
            <Select
              value={selectedAlternativeSession || currentTrainingSession.id}
              onValueChange={(value) => {
                onAlternativeSessionSelect(value === originalScheduledSessionId ? null : value);
                setShowSessionPicker(false);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {allTrainingSessions.map((session) => (
                  <SelectItem key={session.id} value={session.id}>
                    {session.name}
                    {session.id === originalScheduledSessionId && " (scheduled)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {originalScheduledSessionId === null && selectedAlternativeSession && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onAlternativeSessionSelect(null)}
          >
            Back to rest day
          </Button>
        )}
      </div>
    );
  }

  // Rest day
  return (
    <div className="space-y-3">
      <Label className="text-base">Rest Day</Label>
      {!showSessionPicker ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowSessionPicker(true)}
        >
          <Dumbbell className="h-4 w-4 mr-2" />
          Want to train today?
        </Button>
      ) : (
        <Select
          value=""
          onValueChange={(value) => {
            onAlternativeSessionSelect(value);
            setShowSessionPicker(false);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a session..." />
          </SelectTrigger>
          <SelectContent>
            {allTrainingSessions.map((session) => (
              <SelectItem key={session.id} value={session.id}>
                {session.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}