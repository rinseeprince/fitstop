"use client";

import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { DAY_NAMES, getTodayDateString } from "@/lib/date-helpers";
import {
  FOCUS_RING,
  LABEL_CLASS,
  MONO,
  MONO_INPUT_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { formatDateOnlyWeekday, pluralize } from "@/components/clients/overview/overview-format";
import { UNSET } from "@/components/clients/overview/use-client-profile-edit";
import type { ClientProfileEdit } from "@/components/clients/overview/use-client-profile-edit";
import { useUnits } from "@/contexts/units-context";
import { formatWeight } from "@/utils/unit-conversions";
import type { ActivityLevel, CheckInFrequency, Client, DayOfWeek } from "@/types/check-in";
import type { CheckInTiming } from "@/types/coach-brief";

// The six railed groups inside the client details sheet. Split from the sheet
// shell so neither file carries both the chrome and every field.

const ACTIVITY_OPTIONS: { value: ActivityLevel; label: string }[] = [
  { value: "sedentary", label: "Sedentary (desk job)" },
  { value: "lightly_active", label: "Lightly active" },
  { value: "moderately_active", label: "Moderately active" },
  { value: "very_active", label: "Very active" },
  { value: "extremely_active", label: "Extremely active" },
];

// Monday-first, off the shared weekday map so the names cannot drift.
const DAY_OPTIONS: DayOfWeek[] = [1, 2, 3, 4, 5, 6, 0].map((n) => DAY_NAMES[n]);

const sentenceCase = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

/** A white card holding one group's fields. */
function Card({ children }: { children: ReactNode }) {
  return <div className="mb-5 rounded-[6px] bg-white px-[18px] py-4">{children}</div>;
}

function Grid({ cols, children }: { cols: 2 | 3; children: ReactNode }) {
  return (
    <div
      className={cn(
        "grid gap-3.5",
        cols === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-3"
      )}
    >
      {children}
    </div>
  );
}

function Field({
  label,
  children,
  hint,
  className,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className={LABEL_CLASS}>{label}</span>
      {children}
      {hint}
    </div>
  );
}

/** A value the sheet shows but does not write, with where it comes from. */
function ReadOnly({ value, note }: { value: string; note?: string }) {
  return (
    <div className="flex h-8 items-center justify-between gap-2 rounded-[6px] bg-[#f0f5f4] px-2.5">
      <span className={cn(MONO, "truncate text-[12.5px] text-[#5a7d82]")}>{value}</span>
      {note && <span className="shrink-0 text-[10.5px] text-[#93b0b4]">{note}</span>}
    </div>
  );
}

const HINT_CLASS = "text-[11px] text-[#93b0b4]";

/** A numeric input with its unit pinned inside the field. */
function UnitInput({
  ariaLabel,
  value,
  onChange,
  unit,
  placeholder,
}: {
  ariaLabel: string;
  value: string;
  onChange: (next: string) => void;
  unit: string;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <Input
        aria-label={ariaLabel}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cn(MONO_INPUT_CLASS, FOCUS_RING, "h-8 pr-8 text-[12.5px]")}
      />
      <span
        className={cn(
          MONO,
          "pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10.5px] text-[#93b0b4]"
        )}
      >
        {unit}
      </span>
    </div>
  );
}

export function DetailsGroups({
  client,
  checkInTiming,
  edit,
  status,
  onLogMeasurement,
}: {
  client: Client;
  checkInTiming: CheckInTiming | null;
  edit: ClientProfileEdit;
  status: string;
  onLogMeasurement: () => void;
}) {
  const { preference } = useUnits();
  const { form } = edit;
  const weightUnit = formatWeight(0, preference).unit;

  // A deadline can be neither in the past (the goals PUT rejects it against the
  // coach's day) nor before the goal's own start (the schema's cross-field
  // refine rejects it). Both compose into ONE native `min`, so the impossible
  // days are unclickable rather than picked and then rejected.
  //
  // The goal START deliberately has no bound: a goal that began three weeks ago
  // is a real thing to record, and the route puts no bound on it either.
  const todayString = getTodayDateString();
  const goalStartValue = form.watch("goalStartDate");
  const deadlineMin =
    goalStartValue && goalStartValue > todayString ? goalStartValue : todayString;

  // Activation owns the start date; a client still being set up has none to
  // correct — and an editable box before then was worse than useless, because
  // the activation dialog prefills today and always sends it, silently
  // replacing a date the coach set in advance. `paused` counts as started.
  const hasStarted =
    client.onboardingStatus === "active" || client.onboardingStatus === "paused";

  // `custom` stays selectable ONLY for a client already on it. It is an
  // interval (`checkInFrequencyDays`) this sheet has no field for, so offering
  // it to everyone would let a coach pick a frequency with no number behind it
  // — while omitting it from a custom client's list would silently rewrite them
  // to weekly on a save that never touched the field.
  const frequencyOptions: { value: CheckInFrequency; label: string }[] = [
    { value: "weekly", label: "Weekly" },
    { value: "biweekly", label: "Bi-weekly" },
    { value: "monthly", label: "Monthly" },
    ...(client.checkInFrequency === "custom"
      ? ([
          {
            value: "custom",
            label: `Every ${pluralize(client.checkInFrequencyDays ?? 0, "day")}`,
          },
        ] as const)
      : []),
    { value: "none", label: "No schedule" },
  ];

  const nextCheckIn = checkInTiming?.nextDueDate
    ? formatDateOnlyWeekday(checkInTiming.nextDueDate)
    : null;
  const dueNote =
    checkInTiming?.daysUntilDue == null
      ? undefined
      : checkInTiming.daysUntilDue === 0
        ? "due today"
        : checkInTiming.daysUntilDue < 0
          ? `in ${pluralize(-checkInTiming.daysUntilDue, "day")}`
          : `${pluralize(checkInTiming.daysUntilDue, "day")} overdue`;

  const currentWeight =
    client.currentWeight == null
      ? null
      : formatWeight(client.currentWeight, preference);

  return (
    <>
      <SectionLabel label="Contact" />
      <Card>
        <Grid cols={2}>
          <Field label="Full name">
            <Input
              aria-label="Full name"
              value={form.watch("name")}
              onChange={(e) => form.setValue("name", e.target.value)}
              className={cn(FOCUS_RING, "h-8 text-[12.5px]")}
            />
          </Field>
          <Field
            label="Email"
            hint={
              !hasStarted ? (
                <span className={HINT_CLASS}>
                  An invitation already sent stays addressed to the old email.
                </span>
              ) : undefined
            }
          >
            <Input
              aria-label="Email"
              type="email"
              value={form.watch("email")}
              onChange={(e) => form.setValue("email", e.target.value)}
              className={cn(FOCUS_RING, "h-8 text-[12.5px]")}
            />
          </Field>
          <Field label="Phone">
            <Input
              aria-label="Phone"
              type="tel"
              placeholder="Not set"
              value={form.watch("phone")}
              onChange={(e) => form.setValue("phone", e.target.value)}
              className={cn(FOCUS_RING, "h-8 text-[12.5px]")}
            />
          </Field>
          {/* Read-only: the ladder that produces it (lib/roster-views.ts) reads
              onboarding stage with deactivation winning over it, and neither is
              a field. Archiving is the only status ACTION, and it is not built. */}
          <Field label="Status">
            <ReadOnly value={status} note="set by activation" />
          </Field>
        </Grid>
      </Card>

      <SectionLabel label="Profile" />
      <Card>
        <Grid cols={3}>
          <Field label="Gender">
            <Select
              value={form.watch("gender")}
              onValueChange={(v) => form.setValue("gender", v as "male" | "female" | "other")}
            >
              <SelectTrigger aria-label="Gender" className="h-8 text-[12.5px] font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNSET}>Not set</SelectItem>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="Date of birth"
            hint={
              edit.showBirthDateNudge ? (
                <span className="text-[11px] leading-[1.4] text-[#c8923a]">
                  Add one for a more accurate BMR — age is assumed 30 without it.
                </span>
              ) : undefined
            }
          >
            <Input
              aria-label="Date of birth"
              type="date"
              value={form.watch("dateOfBirth")}
              onChange={(e) => form.setValue("dateOfBirth", e.target.value)}
              className={cn(MONO_INPUT_CLASS, FOCUS_RING, "h-8 text-[12.5px]")}
            />
          </Field>
          <Field
            label="Height"
            hint={
              edit.height.hasParseError ? (
                <span className="text-[11px] text-[#c06060]">Enter a height above 0</span>
              ) : undefined
            }
          >
            {/* Imperial height is COMPOSITE — 5'11", never 71 in — so it takes
                two boxes rather than one with a unit suffix. */}
            {edit.height.system === "imperial" ? (
              <div className="flex gap-1.5">
                <UnitInput
                  ariaLabel="Height feet"
                  value={edit.height.fields.feet}
                  onChange={edit.height.setFeet}
                  unit="ft"
                />
                <UnitInput
                  ariaLabel="Height inches"
                  value={edit.height.fields.inches}
                  onChange={edit.height.setInches}
                  unit="in"
                />
              </div>
            ) : (
              <UnitInput
                ariaLabel="Height"
                value={edit.height.fields.cm}
                onChange={edit.height.setCm}
                unit="cm"
              />
            )}
          </Field>
        </Grid>
        <div className="mt-3.5 border-t border-[rgba(13,148,136,0.06)] pt-3.5">
          <Grid cols={3}>
            <Field label="Started">
              {hasStarted ? (
                <Input
                  aria-label="Start date"
                  type="date"
                  value={form.watch("startDate")}
                  onChange={(e) => form.setValue("startDate", e.target.value)}
                  className={cn(MONO_INPUT_CLASS, FOCUS_RING, "h-8 text-[12.5px]")}
                />
              ) : (
                <ReadOnly value="Not started" note="set on activation" />
              )}
            </Field>
            <Field
              label="Activity level"
              className="sm:col-span-2"
              hint={
                <span className={HINT_CLASS}>Drives their TDEE, and nothing else.</span>
              }
            >
              <Select
                value={form.watch("workActivityLevel")}
                onValueChange={(v) => form.setValue("workActivityLevel", v as ActivityLevel)}
              >
                <SelectTrigger
                  aria-label="Work activity level"
                  className="h-8 text-[12.5px] font-medium"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTIVITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </Grid>
        </div>
      </Card>

      <SectionLabel label="Check-ins" />
      <Card>
        <Grid cols={3}>
          <Field label="Frequency">
            <Select
              value={form.watch("checkInFrequency")}
              onValueChange={(v) => form.setValue("checkInFrequency", v as CheckInFrequency)}
            >
              <SelectTrigger aria-label="Check-in frequency" className="h-8 text-[12.5px] font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {frequencyOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Check-in day">
            <Select
              value={form.watch("expectedCheckInDay")}
              onValueChange={(v) => form.setValue("expectedCheckInDay", v)}
            >
              <SelectTrigger aria-label="Check-in day" className="h-8 text-[12.5px] font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNSET}>Any day</SelectItem>
                {DAY_OPTIONS.map((day) => (
                  <SelectItem key={day} value={day}>
                    {sentenceCase(day)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {/* Read-only because it is derived, and NOT live-previewed because
              the derivation needs the client's last check-in period — which
              this record does not carry, so a browser-side preview would
              disagree with the date the server computes. */}
          <Field
            label="Next check-in"
            hint={<span className={HINT_CLASS}>Recalculates when you save.</span>}
          >
            <ReadOnly value={nextCheckIn ?? "Not scheduled"} note={dueNote} />
          </Field>
        </Grid>
      </Card>

      <SectionLabel label="Baseline" />
      <Card>
        <Grid cols={2}>
          <Field label="Start weight">
            <UnitInput
              ariaLabel="Start weight"
              value={edit.startWeight.value}
              onChange={edit.startWeight.setValue}
              unit={weightUnit}
            />
          </Field>
          <Field label="Start body fat">
            <UnitInput
              ariaLabel="Start body fat percentage"
              value={form.watch("startingBodyFatPercentage")}
              onChange={(v) => form.setValue("startingBodyFatPercentage", v)}
              unit="%"
            />
          </Field>
          <Field label="Current weight">
            <ReadOnly
              value={currentWeight ? `${currentWeight.value.toFixed(1)} ${currentWeight.unit}` : "Not recorded"}
            />
          </Field>
          <Field label="Current body fat">
            <ReadOnly
              value={
                client.currentBodyFatPercentage != null
                  ? `${client.currentBodyFatPercentage.toFixed(1)} %`
                  : "Not recorded"
              }
            />
          </Field>
          <div className="sm:col-span-2">
            <p className={HINT_CLASS}>
              Start values are the recorded beginning of this client&apos;s journey — correct them
              only if one was entered wrong. Current values come from logged measurements, so the
              chart and this form cannot disagree.{" "}
              <button
                type="button"
                onClick={onLogMeasurement}
                className="font-medium text-[#0d9488] transition-colors hover:text-[#0b7f75]"
              >
                Log a measurement
              </button>
            </p>
          </div>
        </Grid>
      </Card>

      <SectionLabel label="Goals & energy" />
      <Card>
        <Grid cols={2}>
          <Field label="Goal weight">
            <UnitInput
              ariaLabel="Goal weight"
              value={edit.goalWeight.value}
              onChange={edit.goalWeight.setValue}
              unit={weightUnit}
            />
          </Field>
          <Field label="Goal body fat">
            <UnitInput
              ariaLabel="Goal body fat percentage"
              value={form.watch("goalBodyFatPercentage")}
              onChange={(v) => form.setValue("goalBodyFatPercentage", v)}
              unit="%"
            />
          </Field>
        </Grid>
        <div className="mt-3.5 border-t border-[rgba(13,148,136,0.06)] pt-3.5">
          <Grid cols={2}>
            <Field label="Goal start">
              <Input
                aria-label="Goal start date"
                type="date"
                value={form.watch("goalStartDate")}
                onChange={(e) => form.setValue("goalStartDate", e.target.value)}
                className={cn(MONO_INPUT_CLASS, FOCUS_RING, "h-8 text-[12.5px]")}
              />
            </Field>
            <Field label="Deadline">
              <Input
                aria-label="Goal deadline"
                type="date"
                min={deadlineMin}
                value={form.watch("goalDeadline")}
                onChange={(e) => form.setValue("goalDeadline", e.target.value)}
                className={cn(MONO_INPUT_CLASS, FOCUS_RING, "h-8 text-[12.5px]")}
              />
            </Field>
          </Grid>
        </div>
        <div className="mt-3.5 border-t border-[rgba(13,148,136,0.06)] pt-3.5">
          <Grid cols={2}>
            {/* BMR has no editor here: the pair recomputes server-side from the
                profile whenever an input to it changes. */}
            <Field label="BMR">
              <ReadOnly
                value={client.bmr ? String(Math.round(client.bmr)) : "—"}
                note="cal/day"
              />
            </Field>
            <Field
              label="TDEE"
              hint={
                edit.customTdeeBelowBmr && edit.autoEnergy ? (
                  <span className="text-[11px] text-[#c06060]">
                    Can&apos;t be below BMR ({edit.autoEnergy.bmr})
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => edit.setIsCustomTdee(!edit.isCustomTdee)}
                    className="self-start text-[11px] font-medium text-[#0d9488] transition-colors hover:text-[#0b7f75]"
                  >
                    {edit.isCustomTdee
                      ? `Reset to calculated${edit.autoEnergy ? ` (${edit.autoEnergy.tdee})` : ""}`
                      : "Set a custom TDEE"}
                  </button>
                )
              }
            >
              {edit.isCustomTdee ? (
                <UnitInput
                  ariaLabel="Custom TDEE"
                  value={edit.customTdee}
                  onChange={edit.setCustomTdee}
                  unit="cal"
                />
              ) : (
                <ReadOnly
                  value={edit.autoEnergy ? String(edit.autoEnergy.tdee) : "—"}
                  note="calculated"
                />
              )}
            </Field>
          </Grid>
        </div>

        {/* What saving ACTUALLY does. The nutrition plan snapshots its calorie
            targets and the TDEE it was built from (services/nutrition-plan-service.ts),
            so nothing here moves a target — it creates goal drift, which the
            Nutrition tab surfaces as "Goal changed — regenerate". Saying the
            targets recalculate would be a comfortable lie. */}
        <div className="mt-4 flex items-start gap-2.5 rounded-[6px] bg-[rgba(245,158,11,0.07)] px-3 py-2.5">
          <AlertTriangle
            className="mt-px h-[15px] w-[15px] shrink-0 text-[#d97706]"
            strokeWidth={1.5}
          />
          <p className="text-[11.5px] leading-[1.5] text-[#d97706]">
            Saving records a new goal and refreshes this client&apos;s BMR and TDEE. Their
            nutrition plan keeps the targets it was built with — the Nutrition tab will offer to
            regenerate it. Logged history is unchanged.
          </p>
        </div>
      </Card>
    </>
  );
}
