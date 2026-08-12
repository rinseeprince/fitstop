"use client";

import { Calendar, Mail } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { DAY_NAMES } from "@/lib/date-helpers";
import { InlineSelect, InlineTextInput } from "./inline-edit-fields";
import { UNSET } from "./use-client-profile-edit";
import type { ClientProfileEdit } from "./use-client-profile-edit";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LABEL_CLASS,
  MONO,
  MONO_META_CLASS,
  THUMB_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { OverviewCard } from "./overview-primitives";
import { formatDateOnlyWeekday, pluralize, relativeDayPhrase } from "./overview-format";
import type { Client, DayOfWeek } from "@/types/check-in";
import type { CheckInTiming } from "@/types/coach-brief";
import { useUnits } from "@/contexts/units-context";
import { formatHeight, type UnitSystem } from "@/utils/unit-conversions";

// Imperial height is COMPOSITE — 5'11", never 71 in — which is why formatHeight
// returns a discriminated union rather than {value, unit} like the others.
function formatHeightLabel(valueCm: number, viewer: UnitSystem): string {
  const h = formatHeight(valueCm, viewer);
  return h.system === "metric"
    ? `${Math.round(h.value)} ${h.unit}`
    : `${h.feet}'${h.inches}"`;
}

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
  /** Inline edit state, owned by the section rail above both cards. */
  edit: ClientProfileEdit;
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

// Monday-first, off the shared weekday map so the names cannot drift.
const DAY_OPTIONS: DayOfWeek[] = [1, 2, 3, 4, 5, 6, 0].map((n) => DAY_NAMES[n]);

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
  editor,
  hint,
}: {
  label: string;
  value: string | null;
  isNumeric?: boolean;
  onAdd?: () => void;
  /** Replaces the value while the section is in edit mode. The value's own
   *  typography below is untouched: MONO is the DISPLAY token, whereas
   *  MONO_INPUT_CLASS centres its text and belongs only inside an input —
   *  using it here is what once rendered these values centre-aligned. */
  editor?: ReactNode;
  hint?: ReactNode;
}) {
  if (editor) {
    return (
      <div className="min-w-0">
        <p className={LABEL_CLASS}>{label}</p>
        <div className="mt-0.5">{editor}</div>
        {hint}
      </div>
    );
  }

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
  timing,
  isLoading,
  onOpenSettings,
}: {
  timing: CheckInTiming | null;
  isLoading: boolean;
  onOpenSettings: () => void;
}) {
  if (isLoading && timing === null) {
    return <Skeleton className="h-[62px] w-full rounded-[6px]" />;
  }

  if (timing === null) {
    return (
      <div className="flex items-center gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-[#f0f5f4] text-[#5a7d82]">
          <Calendar className="h-4 w-4" strokeWidth={1.5} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={LABEL_CLASS}>Next check-in</p>
          <p className="mt-0.5 text-[13px] font-semibold text-[#0c1a1e]">Not scheduled</p>
          <p className="mt-0.5 truncate text-[11px] text-[#93b0b4]">
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

  // Cadence is deliberately absent — the Frequency and Check-in day fields
  // directly below already carry it.
  const submitted = timing.lastSubmittedAt ? relativeDayPhrase(timing.lastSubmittedAt) : null;
  const subline = submitted ? `Last submitted ${submitted.text}` : "Not submitted yet";

  return (
    // No nested card: this zone is separated by the card's own hairline, and
    // reads with the same label-over-value grammar as the fields below it.
    <div className="flex items-center gap-3">
      <span
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-[6px]",
          timing.isOverdue ? "bg-[rgba(245,158,11,0.07)] text-[#d97706]" : THUMB_CLASS
        )}
      >
        <Calendar className="h-4 w-4" strokeWidth={1.5} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={LABEL_CLASS}>Next check-in</p>
        <p className="mt-0.5 truncate text-[13px] font-semibold text-[#0c1a1e]">
          {timing.nextDueDate ? (
            <span className={MONO}>{formatDateOnlyWeekday(timing.nextDueDate)}</span>
          ) : (
            "Not scheduled"
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
  edit,
}: ClientScheduleCardProps) {
  const { preference } = useUnits();
  const openSettings = edit.start;
  const editing = edit.isEditing;
  const form = edit.form;

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
        </div>

        <div className="mx-5 border-t border-[rgba(13,148,136,0.06)]" />

        <div className="border-t border-[rgba(13,148,136,0.06)] px-5 py-4">
          <CheckInStrip
            timing={checkInTiming}
            isLoading={isTimingLoading}
            onOpenSettings={openSettings}
          />
        </div>

        <div className="grid grid-cols-2 items-start gap-x-3 gap-y-4 border-t border-[rgba(13,148,136,0.06)] px-5 pb-5 pt-4">
          <Field label="Frequency" value={frequencyLabel(client)} />
          <Field
            label="Check-in day"
            value={dayLabel(client.expectedCheckInDay)}
            editor={
              editing ? (
                <InlineSelect
                  ariaLabel="Check-in day"
                  value={form.watch("expectedCheckInDay")}
                  onChange={(v) => form.setValue("expectedCheckInDay", v)}
                  options={[
                    { value: UNSET, label: "Any day" },
                    ...DAY_OPTIONS.map((d) => ({ value: d, label: sentenceCase(d) })),
                  ]}
                />
              ) : undefined
            }
          />
          <Field
            label="Gender"
            value={client.gender ? sentenceCase(client.gender) : null}
            editor={
              editing ? (
                <InlineSelect
                  ariaLabel="Gender"
                  value={form.watch("gender")}
                  onChange={(v) => form.setValue("gender", v as "male" | "female" | "other")}
                  options={[
                    { value: UNSET, label: "Not set" },
                    { value: "male", label: "Male" },
                    { value: "female", label: "Female" },
                    { value: "other", label: "Other" },
                  ]}
                />
              ) : undefined
            }
          />
          <Field
            label="Date of birth"
            value={client.dateOfBirth ? formatDateOnlyWeekday(client.dateOfBirth) : null}
            isNumeric
            editor={
              editing ? (
                <InlineTextInput
                  ariaLabel="Date of birth"
                  type="date"
                  value={form.watch("dateOfBirth")}
                  onChange={(v) => form.setValue("dateOfBirth", v)}
                />
              ) : undefined
            }
            hint={
              edit.showBirthDateNudge && editing ? (
                <p className="mt-1 text-[10px] leading-[1.4] text-[#c8923a]">
                  Add one for a more accurate BMR — age is assumed 30 without it.
                </p>
              ) : undefined
            }
          />
          <Field
            label="Started"
            value={client.startDate ? formatDateOnlyWeekday(client.startDate) : null}
            isNumeric
            editor={
              editing ? (
                <InlineTextInput
                  ariaLabel="Start date"
                  type="date"
                  value={form.watch("startDate")}
                  onChange={(v) => form.setValue("startDate", v)}
                />
              ) : undefined
            }
          />
          <Field
            label="Height"
            value={client.height != null ? formatHeightLabel(client.height, preference) : null}
            isNumeric
            editor={
              editing ? (
                edit.height.system === "imperial" ? (
                  <div className="flex gap-1.5">
                    <InlineTextInput
                      ariaLabel="Height feet"
                      isNumeric
                      placeholder="ft"
                      value={edit.height.fields.feet}
                      onChange={edit.height.setFeet}
                    />
                    <InlineTextInput
                      ariaLabel="Height inches"
                      isNumeric
                      placeholder="in"
                      value={edit.height.fields.inches}
                      onChange={edit.height.setInches}
                    />
                  </div>
                ) : (
                  <InlineTextInput
                    ariaLabel="Height"
                    isNumeric
                    placeholder="cm"
                    value={edit.height.fields.cm}
                    onChange={edit.height.setCm}
                  />
                )
              ) : undefined
            }
            hint={
              editing && edit.height.hasParseError ? (
                <p className="mt-1 text-[10px] text-[#c06060]">Enter a height above 0</p>
              ) : undefined
            }
          />
          <Field
            label="Phone"
            value={client.phone || null}
            isNumeric
            editor={
              editing ? (
                <InlineTextInput
                  ariaLabel="Phone"
                  type="tel"
                  placeholder="Not set"
                  value={form.watch("phone")}
                  onChange={(v) => form.setValue("phone", v)}
                />
              ) : undefined
            }
          />
        </div>
      </OverviewCard>

    </>
  );
}
