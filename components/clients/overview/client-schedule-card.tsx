"use client";

import { useState } from "react";
import { Calendar, Mail, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LABEL_CLASS,
  MONO,
  MONO_META_CLASS,
  THUMB_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { OverviewCard } from "./overview-primitives";
import { ClientSettingsDialog } from "./client-settings-dialog";
import { formatDateOnlyWeekday, pluralize, relativeDayPhrase } from "./overview-format";
import type { Client } from "@/types/check-in";
import type { CheckInTiming } from "@/types/coach-brief";

type ClientScheduleCardProps = {
  client: Client;
  checkInTiming: CheckInTiming | null;
  /**
   * True until the brief resolves. Without it a null `checkInTiming` is
   * ambiguous, and the strip would claim "never asked to check in" about a
   * client who simply hasn't loaded yet.
   */
  isTimingLoading: boolean;
  /** Revalidates the client record AND the brief — check-in day drives timing. */
  onClientUpdated: () => void;
};

const FREQUENCY_LABELS: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Bi-weekly",
  monthly: "Monthly",
  none: "No schedule",
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function frequencyLabel(client: Client): string {
  if (client.checkInFrequency === "custom") return `Every ${client.checkInFrequencyDays} days`;
  return FREQUENCY_LABELS[client.checkInFrequency ?? "weekly"] ?? "Weekly";
}

function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function dayLabel(day: string | null | undefined): string {
  return day ? sentenceCase(day) : "Any day";
}

/** One cell of the profile grid; an unset field names the gap and offers the fix. */
function Field({
  label,
  value,
  isNumeric,
  onAdd,
}: {
  label: string;
  value: string | null;
  isNumeric?: boolean;
  onAdd?: () => void;
}) {
  return (
    <div className="min-w-0">
      <p className={LABEL_CLASS}>{label}</p>
      {value === null ? (
        <p className="mt-0.5 flex items-baseline gap-2 text-[13px]">
          <span className="text-[#93b0b4]">Not set</span>
          {onAdd && (
            <button
              type="button"
              onClick={onAdd}
              className="text-[11px] font-medium text-[#0d9488] transition-colors hover:text-[#0b7f75]"
            >
              Add
            </button>
          )}
        </p>
      ) : (
        <p
          className={cn(
            "mt-0.5 truncate text-[13px] font-semibold text-[#0c1a1e]",
            isNumeric && MONO
          )}
        >
          {value}
        </p>
      )}
    </div>
  );
}

/** Distance-to-due chip; word-only "Due today" stays sans, the rest are counts. */
function DueChip({ timing }: { timing: CheckInTiming }) {
  if (timing.daysUntilDue === null) return null;

  const base = "shrink-0 rounded-[6px] px-2 py-0.5 text-[10px] font-medium";
  const tone = timing.isOverdue
    ? "bg-[rgba(245,158,11,0.07)] text-[#d97706]"
    : "bg-[rgba(13,148,136,0.08)] text-[#0a5c55]";

  if (timing.daysUntilDue === 0) return <span className={cn(base, tone)}>Due today</span>;

  const text =
    timing.daysUntilDue < 0
      ? `in ${pluralize(-timing.daysUntilDue, "day")}`
      : `${pluralize(timing.daysUntilDue, "day")} overdue`;

  return <span className={cn(base, tone, MONO)}>{text}</span>;
}

function CheckInStrip({
  client,
  timing,
  isLoading,
  onOpenSettings,
}: {
  client: Client;
  timing: CheckInTiming | null;
  isLoading: boolean;
  onOpenSettings: () => void;
}) {
  if (isLoading && timing === null) {
    return <Skeleton className="h-[62px] w-full rounded-[6px]" />;
  }

  if (timing === null) {
    return (
      <div className="flex items-center gap-3 rounded-[6px] border border-[rgba(13,148,136,0.08)] p-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-[#f0f5f4] text-[#5a7d82]">
          <Calendar className="h-4 w-4" strokeWidth={1.5} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-[#0c1a1e]">No check-in schedule</p>
          <p className="mt-0.5 text-[11px] text-[#93b0b4]">
            This client is never asked to check in.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenSettings}
          className="shrink-0 text-[11px] font-medium text-[#0d9488] transition-colors hover:text-[#0b7f75]"
        >
          Set a schedule
        </button>
      </div>
    );
  }

  const submitted = timing.lastSubmittedAt ? relativeDayPhrase(timing.lastSubmittedAt) : null;
  const cadence = `${frequencyLabel(client).toLowerCase()}, ${dayLabel(timing.expectedCheckInDay).toLowerCase()}`;
  const subline = submitted
    ? `Last submitted ${submitted.text} · ${cadence}`
    : `Not submitted yet · ${cadence}`;

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-[6px] border p-3",
        timing.isOverdue
          ? "border-[rgba(245,158,11,0.25)] bg-[rgba(245,158,11,0.04)]"
          : "border-[rgba(13,148,136,0.08)]"
      )}
    >
      <span
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-[6px]",
          timing.isOverdue ? "bg-[rgba(245,158,11,0.07)] text-[#d97706]" : THUMB_CLASS
        )}
      >
        <Calendar className="h-4 w-4" strokeWidth={1.5} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-[#0c1a1e]">
          {timing.nextDueDate ? (
            <>
              Next check-in due{" "}
              <span className={MONO}>{formatDateOnlyWeekday(timing.nextDueDate)}</span>
            </>
          ) : (
            "Next check-in not scheduled"
          )}
        </p>
        <p
          className={cn(
            "mt-0.5 truncate text-[11px]",
            submitted?.isNumeric ? MONO_META_CLASS : "text-[#93b0b4]"
          )}
        >
          {subline}
        </p>
      </div>
      <DueChip timing={timing} />
    </div>
  );
}

export function ClientScheduleCard({
  client,
  checkInTiming,
  isTimingLoading,
  onClientUpdated,
}: ClientScheduleCardProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openSettings = () => setSettingsOpen(true);

  return (
    <>
      <OverviewCard animationDelay="0.08s">
        <div className="flex items-start gap-3 px-5 pb-4 pt-5">
          <div
            className="grid h-12 w-12 shrink-0 place-items-center rounded-[6px] text-[15px] font-bold text-white"
            style={{ background: "linear-gradient(135deg, #0d9488, #0f766e)" }}
            aria-hidden
          >
            {getInitials(client.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-[15px] font-semibold text-[#0c1a1e]">{client.name}</h3>
              {client.active && (
                <span className="flex shrink-0 items-center gap-1">
                  <span className="h-[5px] w-[5px] rounded-full bg-[#0d9488]" aria-hidden />
                  <span className="text-[11px] font-medium text-[#0d9488]">Active</span>
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5 shrink-0 text-[#93b0b4]" strokeWidth={1.5} />
              <p className="truncate text-[12px] text-[#5a7d82]">{client.email}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={openSettings}
            aria-label="Edit client settings"
            title="Edit client settings"
            className="shrink-0 rounded p-1 text-[#93b0b4] transition-colors hover:text-[#0d9488]"
          >
            <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        </div>

        <div className="mx-5 border-t border-[rgba(13,148,136,0.06)]" />

        <div className="px-5 pt-4">
          <CheckInStrip
            client={client}
            timing={checkInTiming}
            isLoading={isTimingLoading}
            onOpenSettings={openSettings}
          />
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-3 px-5 pb-5 pt-4">
          <Field label="Frequency" value={frequencyLabel(client)} />
          <Field label="Check-in day" value={dayLabel(client.expectedCheckInDay)} />
          <Field
            label="Gender"
            value={client.gender ? sentenceCase(client.gender) : null}
            onAdd={openSettings}
          />
          <Field
            label="Started"
            value={client.startDate ? formatDateOnlyWeekday(client.startDate) : null}
            isNumeric
            onAdd={openSettings}
          />
          <Field
            label="Height"
            value={client.height != null ? `${client.height} ${client.heightUnit ?? "in"}` : null}
            isNumeric
            onAdd={openSettings}
          />
          <Field label="Phone" value={client.phone || null} isNumeric onAdd={openSettings} />
        </div>
      </OverviewCard>

      <ClientSettingsDialog
        client={client}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSaved={onClientUpdated}
      />
    </>
  );
}
