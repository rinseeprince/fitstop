"use client";

import { motion } from "framer-motion";
import { Dumbbell, CheckCircle2, CircleDashed, XCircle, Trophy } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CheckInWithDetails, CheckInSessionCompletion } from "@/types/check-in";
import type { SessionStatus, SessionSummary } from "@/lib/check-in/adherence";
import { classifySession } from "@/lib/check-in/adherence";
import { cn } from "@/lib/utils";
import {
  LABEL_CLASS,
  MONO,
  SECTION_LABEL_CLASS,
  TEXT_PRIMARY,
} from "@/components/clients/training/program-builder/builder-tokens";

type TrainingSectionProps = {
  checkIn: CheckInWithDetails;
  // Shared training adherence so the panel header matches the hero card exactly.
  adherence: SessionSummary;
};

const DAY_LABEL: Record<string, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

// Teal Summit two-colour status: teal completed, amber partial, muted missed (no red).
const STATUS_META: Record<SessionStatus, { label: string; icon: LucideIcon; pill: string }> = {
  completed: { label: "Completed", icon: CheckCircle2, pill: "bg-[rgba(13,148,136,0.08)] text-[#0d9488]" },
  partial: { label: "Partial", icon: CircleDashed, pill: "bg-[rgba(245,158,11,0.07)] text-[#d97706]" },
  missed: { label: "Missed", icon: XCircle, pill: "bg-[rgba(13,148,136,0.04)] text-[#93b0b4]" },
};

// Detail line built only from fields already on the check-in payload (status +
// logged quality). No exercise/set counts are fetched.
function detailLine(session: CheckInSessionCompletion, status: SessionStatus): string {
  if (status === "completed") {
    return session.completionQuality === "full" ? "Logged in full" : "Marked complete";
  }
  if (status === "partial") {
    return "Stopped early";
  }
  return session.completionQuality === "skipped" ? "Skipped" : "Not logged";
}

export const TrainingSection = ({ checkIn, adherence }: TrainingSectionProps) => {
  const sessions = checkIn.sessionCompletions ?? [];
  const prHighlights = (checkIn.exerciseHighlights ?? []).filter(
    (h) => h.highlightType === "pr"
  );

  if (sessions.length === 0 && prHighlights.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: 0.1 }}
      className="bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] p-5"
    >
      <div className="flex items-center justify-between mb-4">
        <div className={cn(SECTION_LABEL_CLASS, "flex items-center gap-2")}>
          <Dumbbell className="w-4 h-4" strokeWidth={1.5} />
          Training
        </div>
        {adherence.prescribed > 0 && (
          <span className="text-xs font-medium text-[#5a7d82]">
            <span className={cn(MONO, TEXT_PRIMARY)}>
              {adherence.completed} of {adherence.prescribed}
            </span>{" "}
            completed
          </span>
        )}
      </div>

      {sessions.length > 0 && (
        <div className="flex flex-col gap-2">
          {sessions.map((session, i) => {
            const status = classifySession(session);
            const meta = STATUS_META[status];
            const Icon = meta.icon;
            const day = session.dayOfWeek ? DAY_LABEL[session.dayOfWeek] : undefined;
            return (
              <div
                key={session.id ?? `${session.sessionName}-${i}`}
                className="flex items-center gap-3 px-3 py-2.5 bg-[rgba(13,148,136,0.03)] rounded-[6px]"
              >
                {day && (
                  <span className={cn(LABEL_CLASS, "w-8 shrink-0")}>
                    {day}
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate text-[#0c1a1e]">{session.sessionName}</div>
                  <div className="text-xs text-[#93b0b4]">{detailLine(session, status)}</div>
                  {session.notes && (
                    <div className="text-xs text-[#93b0b4] italic truncate">
                      &ldquo;{session.notes}&rdquo;
                    </div>
                  )}
                </div>
                <span
                  className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${meta.pill}`}
                >
                  <Icon className="w-3 h-3" />
                  {meta.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* PR highlight strip - structured exercise PRs flagged this week */}
      {prHighlights.length > 0 && (
        <div className="mt-3 p-3 bg-[rgba(13,148,136,0.05)] border-l-[3px] border-l-[#0d9488] rounded-[6px] flex items-center gap-2.5">
          <Trophy className="w-5 h-5 text-[#0d9488] shrink-0" strokeWidth={1.5} />
          <div className="text-sm font-medium text-[#0c1a1e]">
            {prHighlights.map((pr, i) => (
              <span key={pr.id ?? i}>
                {pr.exerciseName}
                {(pr.weightValue || pr.reps) && (
                  <span className={cn("font-bold", MONO, "text-[#0d9488]")}>
                    {" "}
                    {pr.weightValue && `${pr.weightValue}${pr.weightUnit || "kg"}`}
                    {pr.weightValue && pr.reps && " x "}
                    {pr.reps && `${pr.reps} reps`}
                  </span>
                )}
                {pr.details && ` - ${pr.details}`}
                {i < prHighlights.length - 1 && " | "}
              </span>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
};
