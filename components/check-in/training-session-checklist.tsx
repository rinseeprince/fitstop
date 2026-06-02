"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dumbbell, Calendar, Lock } from "lucide-react";
import { canEditDay } from "@/lib/daily-log-permissions";
import type {
  CheckInTrainingEventDetail,
  SessionCompletionQuality,
} from "@/types/check-in";

// Map a completionQuality back to its UI status label. A completed event with no
// logged quality (e.g. marked complete elsewhere) shows as "full".
const statusLabel = (
  detail: CheckInTrainingEventDetail
): "full" | "partial" | "skipped" | "not_logged" => {
  if (detail.logStatus === "not_logged") return "not_logged";
  return detail.completionQuality ?? "full";
};

const QUALITY_OPTIONS: { value: SessionCompletionQuality; label: string }[] = [
  { value: "full", label: "Completed" },
  { value: "partial", label: "Partial" },
  { value: "skipped", label: "Skipped" },
];

const formatDay = (date: string) => {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

type TrainingSessionChecklistProps = {
  /** Per-event training detail for the period (Session 6.2+ shape). */
  events: CheckInTrainingEventDetail[];
  /** Client IANA timezone — drives canEditDay's "today" computation. */
  clientTimezone: string;
  /**
   * Fill-gap log writer. Registers an in-flight POST so the page can flush+await
   * all pending writes before submitting the check-in (Pin 3). Resolves when the
   * write completes; rejects on failure (surfaced inline on the row).
   */
  onLogEvent: (
    eventId: string,
    payload: { completionQuality: SessionCompletionQuality; notes?: string }
  ) => Promise<void>;
};

/**
 * Training section of the check-in form (Session 6.4).
 *
 * Daily logs are the source of truth — this is a VIEWER over the period's
 * training_events. Each row is either:
 *   - locked (display-only) when canEditDay(date, loggedStatus, tz) === false —
 *     i.e. a future day, or a past day that was already logged; OR
 *   - editable (quick mark complete/partial/skipped + optional notes) which
 *     POSTs to /api/client/training/events/[eventId]/log via onLogEvent.
 *
 * canEditDay is the ONLY lock rule. loggedStatus comes from logStatus
 * ("logged" when the event has a session_log, else "never-logged").
 */
export const TrainingSessionChecklist = ({
  events,
  clientTimezone,
  onLogEvent,
}: TrainingSessionChecklistProps) => {
  // Local optimistic state per editable row (status + notes + saving/error).
  const [rowState, setRowState] = useState<
    Record<string, { quality?: SessionCompletionQuality; notes: string; saving: boolean; error?: string }>
  >({});

  const completedCount = events.filter((e) => e.status === "completed").length;

  const setRow = (
    eventId: string,
    patch: Partial<{ quality: SessionCompletionQuality; notes: string; saving: boolean; error?: string }>
  ) =>
    setRowState((prev) => {
      const base = prev[eventId] ?? { notes: "", saving: false };
      return {
        ...prev,
        [eventId]: { ...base, ...patch },
      };
    });

  const saveRow = async (
    eventId: string,
    quality: SessionCompletionQuality,
    notes: string
  ) => {
    setRow(eventId, { quality, notes, saving: true, error: undefined });
    try {
      await onLogEvent(eventId, { completionQuality: quality, notes: notes || undefined });
      setRow(eventId, { saving: false });
    } catch (err) {
      setRow(eventId, {
        saving: false,
        error: err instanceof Error ? err.message : "Failed to save",
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-base font-medium">Training Sessions</Label>
        <span className="text-sm text-muted-foreground">
          {completedCount}/{events.length} completed
        </span>
      </div>

      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No training sessions were scheduled this period.
        </p>
      ) : (
        <div className="space-y-3">
          {events.map((event) => {
            const loggedStatus = event.logStatus === "logged" ? "logged" : "never-logged";
            const editable = canEditDay(event.date, loggedStatus, clientTimezone);
            const label = statusLabel(event);
            const isCompleted = event.status === "completed";
            const local = rowState[event.eventId];
            const displayName = event.performedSessionName ?? event.sessionName;

            return (
              <div
                key={event.eventId}
                className={`p-3 rounded-lg border transition-colors ${
                  isCompleted
                    ? "bg-success/10 border-success/30"
                    : "bg-muted/30 border-border"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Dumbbell className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <span className="text-sm font-medium">{displayName}</span>
                      {!editable && (
                        <Lock className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDay(event.date)}
                      </span>
                    </div>

                    {/* Display-only status for locked rows; logged notes shown read-only. */}
                    {!editable && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        {label === "not_logged" ? (
                          <span>Not logged</span>
                        ) : (
                          <span className="capitalize">{label}</span>
                        )}
                        {event.notes && (
                          <p className="mt-1 italic">&ldquo;{event.notes}&rdquo;</p>
                        )}
                      </div>
                    )}

                    {/* Editable quick inputs for never-logged editable days. */}
                    {editable && (
                      <div className="mt-2 space-y-2">
                        <Select
                          value={local?.quality ?? (label === "not_logged" ? undefined : label)}
                          onValueChange={(v) =>
                            saveRow(
                              event.eventId,
                              v as SessionCompletionQuality,
                              local?.notes ?? event.notes ?? ""
                            )
                          }
                        >
                          <SelectTrigger className="w-36 h-8 text-xs">
                            <SelectValue placeholder="Mark status" />
                          </SelectTrigger>
                          <SelectContent>
                            {QUALITY_OPTIONS.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Textarea
                          placeholder="Notes (optional)"
                          value={local?.notes ?? event.notes ?? ""}
                          onChange={(e) =>
                            setRow(event.eventId, { notes: e.target.value })
                          }
                          onBlur={() => {
                            const q = local?.quality;
                            if (q) void saveRow(event.eventId, q, local?.notes ?? "");
                          }}
                          rows={2}
                          className="resize-none text-xs"
                        />
                        {local?.saving && (
                          <p className="text-xs text-muted-foreground">Saving…</p>
                        )}
                        {local?.error && (
                          <p className="text-xs text-destructive">{local.error}</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Days you already logged are locked. You can still fill in any sessions you
        missed logging.
      </p>
    </div>
  );
};
