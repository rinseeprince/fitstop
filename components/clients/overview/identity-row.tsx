"use client";

import { Calendar, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { clientInitials } from "@/lib/client-initials";
import { getRosterStatus, rosterStatusLabel } from "@/lib/roster-views";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LABEL_CLASS,
  MONO,
  THUMB_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { InlineMono, OverviewCard } from "./overview-primitives";
import { formatDateOnlyWeekday, pluralize } from "./overview-format";
import type { Client } from "@/types/check-in";
import type { CheckInTiming } from "@/types/coach-brief";

/**
 * Who this client is, in one row: name, status, how to reach them, when they
 * are next due, and the way in to everything editable about them.
 *
 * It replaces the Client & Schedule card, which carried the same identity plus
 * seven read-only profile fields. Those fields moved into the details sheet
 * with their editors, so keeping display copies here would have been a second
 * place to read a value that has one owner.
 *
 * **"Last submitted" is deliberately not here** (owner decision, Q4). It was
 * the schedule card's sub-line and nothing else renders it; the check-in tab
 * owns that history.
 */
type IdentityRowProps = {
  client: Client;
  checkInTiming: CheckInTiming | null;
  /**
   * True until the brief resolves. Without it a null `checkInTiming` is
   * ambiguous, and the row would claim "never asked to check in" about a
   * client who simply hasn't loaded yet.
   */
  isTimingLoading: boolean;
  /** Opens the client details sheet — where every editable fact lives. */
  onOpenDetails: () => void;
};

/** Distance-to-due chip; word-only "Due today" stays sans, the rest are counts. */
function DueChip({ timing }: { timing: CheckInTiming }) {
  if (timing.daysUntilDue === null) return null;

  const base = "shrink-0 rounded-[6px] px-2 py-0.5 text-[10px] font-medium";
  const tone = timing.isOverdue
    ? "bg-[rgba(245,158,11,0.07)] text-[#d97706]"
    : "bg-[rgba(13,148,136,0.08)] text-[#0a5c55]";

  if (timing.daysUntilDue === 0) return <span className={cn(base, tone)}>Due today</span>;

  // Sign convention (types/coach-brief.ts): negative = days until, positive = overdue.
  const text =
    timing.daysUntilDue < 0
      ? `in ${pluralize(-timing.daysUntilDue, "day")}`
      : `${pluralize(timing.daysUntilDue, "day")} overdue`;

  return <span className={cn(base, tone, MONO)}>{text}</span>;
}

function CheckInCluster({
  timing,
  isLoading,
  onOpenDetails,
}: {
  timing: CheckInTiming | null;
  isLoading: boolean;
  onOpenDetails: () => void;
}) {
  if (isLoading && timing === null) {
    return <Skeleton className="h-[38px] w-[190px] rounded-[6px]" />;
  }

  if (timing === null) {
    return (
      <div className="flex items-center gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-[#f0f5f4] text-[#5a7d82]">
          <Calendar className="h-4 w-4" strokeWidth={1.5} />
        </span>
        <div className="min-w-0">
          <p className={LABEL_CLASS}>Next check-in</p>
          <p className="mt-0.5 text-[13px] font-semibold text-[#0c1a1e]">Not scheduled</p>
        </div>
        <button
          type="button"
          onClick={onOpenDetails}
          className="shrink-0 text-[11px] font-medium text-[#0d9488] transition-colors hover:text-[#0b7f75]"
        >
          Set a schedule
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-[6px]",
          timing.isOverdue ? "bg-[rgba(245,158,11,0.07)] text-[#d97706]" : THUMB_CLASS
        )}
      >
        <Calendar className="h-4 w-4" strokeWidth={1.5} />
      </span>
      <div className="min-w-0">
        <p className={LABEL_CLASS}>Next check-in</p>
        <p className="mt-0.5 truncate text-[13px] font-semibold text-[#0c1a1e]">
          {timing.nextDueDate ? (
            <span className={MONO}>{formatDateOnlyWeekday(timing.nextDueDate)}</span>
          ) : (
            "Not scheduled"
          )}
        </p>
      </div>
      <DueChip timing={timing} />
    </div>
  );
}

export function IdentityRow({
  client,
  checkInTiming,
  isTimingLoading,
  onOpenDetails,
}: IdentityRowProps) {
  // One status derivation, shared with the details sheet's hero. `paused` is a
  // designed-but-never-built onboarding state with zero writers, so it reads
  // through here as "Active" — a second spelling of the status would be the
  // five-getInitials mistake in another shape.
  const status = getRosterStatus(client);
  const statusLabel = rosterStatusLabel(status);
  const isActive = status === "active";

  return (
    <OverviewCard className="px-5 py-3.5" animationDelay="0.02s">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div
          className="grid h-11 w-11 shrink-0 place-items-center rounded-[6px] text-[14px] font-semibold text-white"
          style={{ background: "linear-gradient(135deg, #0d9488, #0f766e)" }}
          aria-hidden
        >
          {clientInitials(client.name)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-[#0c1a1e]">
              {client.name}
            </h2>
            <span className="flex shrink-0 items-center gap-1.5">
              {isActive && (
                <span className="h-[5px] w-[5px] rounded-full bg-[#0d9488]" aria-hidden />
              )}
              <span
                className={cn(
                  "text-[11px] font-medium",
                  isActive ? "text-[#0d9488]" : "text-[#93b0b4]"
                )}
              >
                {statusLabel}
              </span>
            </span>
          </div>
          {/* A standalone meta line, not a sentence, so the date is mono —
              InlineMono owns its own leading gap and the call site adds none. */}
          <p className="mt-0.5 truncate text-[11.5px] text-[#93b0b4]">
            {client.email}
            {client.startDate && (
              <>
                {" · started"}
                <InlineMono>{formatDateOnlyWeekday(client.startDate)}</InlineMono>
              </>
            )}
          </p>
        </div>

        <CheckInCluster
          timing={checkInTiming}
          isLoading={isTimingLoading}
          onOpenDetails={onOpenDetails}
        />

        <button
          type="button"
          onClick={onOpenDetails}
          aria-label="Edit client details"
          title="Edit client details"
          className="shrink-0 rounded p-1 text-[#93b0b4] transition-colors hover:text-[#0d9488]"
        >
          <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </div>
    </OverviewCard>
  );
}
