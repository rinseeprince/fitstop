"use client";

import { CheckCircle2, CircleDashed, XCircle, Trophy } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CheckInWithDetails } from "@/types/check-in";
import type { SessionStatus, SessionSummary } from "@/lib/check-in/adherence";
import { classifySession } from "@/lib/check-in/adherence";
import { cn } from "@/lib/utils";
import { useUnits } from "@/contexts/units-context";
import { formatLoad } from "@/utils/unit-conversions";
import { SectionLabel } from "@/components/programs/shared/section-label";
import {
  LABEL_CLASS,
  MONO,
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

export const TrainingSection = ({ checkIn, adherence }: TrainingSectionProps) => {
  const { preference } = useUnits();
  const sessions = checkIn.sessionCompletions ?? [];
  const prHighlights = (checkIn.exerciseHighlights ?? []).filter(
    (h) => h.highlightType === "pr"
  );

  if (sessions.length === 0 && prHighlights.length === 0) return null;

  return (
    // A flex ITEM, not a grid cell: the page puts this beside its sibling, and
    // either section can return null on an empty week. A null child emits no
    // node, so the survivor takes the full row without the page having to know
    // which one rendered. `min-w-0` stops the mono numerals setting the basis.
    <div className="flex min-w-0 flex-1 flex-col">
      {/* The completed count keeps its `prescribed > 0` condition, and it is a
          number-bearing meta, so the rail's own MONO_META_CLASS is correct
          (docs/newdesignsystem.md → Typography: "Metas that contain numbers"). */}
      <SectionLabel
        label="Training"
        meta={
          adherence.prescribed > 0
            ? `${adherence.completed} of ${adherence.prescribed} completed`
            : undefined
        }
      />
      <div className="flex-1 rounded-[6px] bg-white p-5">
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
                      {/* A PR is a barbell load, so formatLoad — it snaps an
                          imperial conversion to something loadable. */}
                      {pr.weightValue &&
                        `${formatLoad(pr.weightValue, preference).value}${formatLoad(pr.weightValue, preference).unit}`}
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
      </div>
    </div>
  );
};
