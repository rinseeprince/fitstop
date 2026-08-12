"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  FOCUS_RING,
  LABEL_CLASS,
  MONO_INPUT_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { DAY_NAMES } from "@/lib/date-helpers";
import { useUnits } from "@/contexts/units-context";
import { useHeightInput } from "@/hooks/use-unit-inputs";
import { computeEnergyPair } from "@/services/client-energy-calc";
import type { ActivityLevel, Client, DayOfWeek } from "@/types/check-in";

// Select recipes match the Metrics "Log measurement" dialog so every
// Teal-Summit dialog field reads the same.
const TRIGGER_CLASS =
  "bg-white border border-[rgba(13,148,136,0.08)] rounded-[6px] text-[13px] font-medium text-[#0c1a1e] focus:border-[rgba(13,148,136,0.25)] focus:shadow-[0_0_0_3px_rgba(13,148,136,0.06)] focus:ring-0 transition-all hover:border-[rgba(13,148,136,0.25)] [&>svg]:text-[#93b0b4] [&>svg]:hover:text-[#0d9488] [&>svg]:transition-colors";

const ITEM_CLASS =
  "rounded-[6px] cursor-pointer text-[13px] text-[#0c1a1e] focus:bg-[rgba(13,148,136,0.05)]";

const UNSET = "unset";

/** Numeric field with an inline unit suffix — the Metrics log dialog's recipe. */
function SuffixedInput({
  id,
  ariaLabel,
  suffix,
  placeholder,
  value,
  onChange,
}: {
  id?: string;
  ariaLabel?: string;
  suffix: string;
  placeholder?: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="relative flex-1">
      <Input
        id={id}
        aria-label={ariaLabel}
        inputMode="decimal"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(MONO_INPUT_CLASS, FOCUS_RING, "h-8 pr-9 text-[13px]")}
      />
      <span
        className={cn(
          "pointer-events-none absolute inset-y-0 right-2.5 flex items-center",
          LABEL_CLASS,
        )}
      >
        {suffix}
      </span>
    </div>
  );
}

// Monday-first, off the shared weekday map so the names cannot drift.
const DAY_OPTIONS: DayOfWeek[] = [1, 2, 3, 4, 5, 6, 0].map((n) => DAY_NAMES[n]);

/**
 * Coercing mirror of the profile slice of `updateClientSchema`.
 *
 * Height is NOT here. It is composite for an imperial viewer (feet + inches)
 * and lives in `useHeightInput`, which owns the conversion to canonical
 * centimetres and the untouched-field guard. The old shape — a bare number
 * plus a per-record `heightUnit` <Select> — is what made ANY save of this
 * dialog multiply a stored 178 cm by 2.54 into 452 once the unit tag stopped
 * describing the value. The tag is gone; the viewer's preference decides how
 * the same canonical number is shown.
 */
const settingsFormSchema = z.object({
  gender: z.enum([UNSET, "male", "female", "other"]),
  dateOfBirth: z
    .string()
    .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), { message: "Use a valid date" }),
  startDate: z
    .string()
    .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), { message: "Use a valid date" }),
  phone: z.string().trim().max(30, "Phone must be less than 30 characters"),
  expectedCheckInDay: z.string(),
  workActivityLevel: z.enum([
    "sedentary",
    "lightly_active",
    "moderately_active",
    "very_active",
    "extremely_active",
  ]),
});

type SettingsFormValues = z.infer<typeof settingsFormSchema>;

type ClientSettingsDialogProps = {
  client: Client;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Revalidates the client record and the brief (check-in day drives timing). */
  onSaved: () => void;
};

function toDefaults(client: Client): SettingsFormValues {
  return {
    gender: client.gender ?? UNSET,
    dateOfBirth: client.dateOfBirth ?? "",
    startDate: client.startDate ?? "",
    phone: client.phone ?? "",
    expectedCheckInDay: client.expectedCheckInDay ?? UNSET,
    // Sedentary is the default everywhere — the column default, the
    // calculator's fallback for NULL, and what a coach sees here. There is no
    // "not set" to choose: it was an option that could only ever mean
    // "sedentary", worded to look like it meant something else.
    workActivityLevel: client.workActivityLevel ?? "sedentary",
  };
}

const ACTIVITY_OPTIONS: { value: ActivityLevel; label: string }[] = [
  { value: "sedentary", label: "Sedentary (desk job)" },
  { value: "lightly_active", label: "Lightly active (light movement)" },
  { value: "moderately_active", label: "Moderately active (on feet most of day)" },
  { value: "very_active", label: "Very active (physical job)" },
  { value: "extremely_active", label: "Extremely active (athlete/heavy labor)" },
];

function formatCalories(value: number): string {
  return value.toLocaleString("en-US");
}

async function putJson(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await res.json()) as { success?: boolean; error?: string };
  if (!res.ok || payload.success === false) {
    throw new Error(payload.error || "Failed to save changes");
  }
}

async function patchJson(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await res.json()) as { success?: boolean; error?: string };
  if (!res.ok || payload.success === false) {
    throw new Error(payload.error || "Failed to save changes");
  }
}

export function ClientSettingsDialog({
  client,
  open,
  onOpenChange,
  onSaved,
}: ClientSettingsDialogProps) {
  const { toast } = useToast();
  const { preference } = useUnits();
  const [isSaving, setIsSaving] = useState(false);

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: toDefaults(client),
  });

  const height = useHeightInput(preference, client.height);

  // Custom TDEE is a separate control from the activity ladder: the ladder
  // describes the client, the override replaces the number the ladder produces.
  const [customTdee, setCustomTdee] = useState<string>("");
  const [isCustomTdee, setIsCustomTdee] = useState(false);

  // Always-mounted dialog: re-seed from the live client record on each open so
  // a cancelled edit never persists into the next one.
  const { reset } = form;
  const resetHeight = height.reset;
  useEffect(() => {
    if (open) {
      reset(toDefaults(client));
      resetHeight(client.height);
      setIsCustomTdee(client.tdeeManualOverride === true);
      setCustomTdee(client.tdee != null ? String(Math.round(client.tdee)) : "");
    }
  }, [open, client, reset, resetHeight]);

  // The live preview runs the SAME pure calculator the server writes with, so
  // "auto would be" can never disagree with what a save actually stores.
  const watchedActivity = form.watch("workActivityLevel");
  const watchedGender = form.watch("gender");
  const watchedDob = form.watch("dateOfBirth");
  const autoEnergy = computeEnergyPair({
    weightKg: client.currentWeight,
    heightCm: height.commitCm ?? client.height,
    gender: watchedGender === UNSET ? undefined : watchedGender,
    bodyFatPercentage: client.currentBodyFatPercentage,
    dateOfBirth: watchedDob === "" ? null : watchedDob,
    activityLevel: watchedActivity,
  });
  const autoReady = autoEnergy.status === "ready" ? autoEnergy : null;
  // Only surfaced when it actually changes the answer: Katch-McArdle uses lean
  // mass and has no age term, so a missing birth date costs nothing there.
  const showBirthDateNudge =
    watchedDob === "" && autoReady?.ageSource === "assumed_default";

  // TDEE is BMR x a multiplier that is never below 1.2, so a custom value under
  // the BMR is impossible rather than merely unusual. Caught here so the coach
  // sees it as they type; the server rejects it too (that is the real guard).
  const parsedCustomTdee = Number(customTdee);
  const customTdeeBelowBmr =
    isCustomTdee &&
    customTdee.trim() !== "" &&
    Number.isFinite(parsedCustomTdee) &&
    autoReady != null &&
    parsedCustomTdee < autoReady.bmr;

  const onSubmit = async (values: SettingsFormValues) => {
    if (height.hasParseError) {
      toast({
        title: "Save failed",
        description: "Enter a height above 0, or clear the field.",
        variant: "destructive",
      });
      return;
    }

    if (customTdeeBelowBmr) {
      toast({
        title: "Save failed",
        description: `TDEE can't be below BMR (${formatCalories(autoReady.bmr)} cal/day).`,
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const profile: Record<string, unknown> = { phone: values.phone };
      if (values.gender !== UNSET) profile.gender = values.gender;
      // `commitCm` is the untouched seed unless the field was edited, so a save
      // that changed only the phone number cannot drift the stored height
      // through a rounded display string (178 cm shows as 5'10" = 177.8).
      if (height.commitCm != null) profile.height = height.commitCm;
      if (values.startDate !== "") profile.startDate = values.startDate;
      if (values.dateOfBirth !== "") profile.dateOfBirth = values.dateOfBirth;
      profile.workActivityLevel = values.workActivityLevel;

      // This PATCH recomputes BMR/TDEE server-side whenever it carries an
      // energy input, so the activity change lands and the pair follows in one
      // request. The override below is applied after, so a coach who sets both
      // in one save ends with their typed number rather than the recompute.
      await patchJson(`/api/clients/${client.id}`, profile);

      const storedOverride = client.tdeeManualOverride === true;
      const parsedCustom = Number(customTdee);
      if (isCustomTdee && Number.isFinite(parsedCustom) && parsedCustom > 0) {
        await putJson(`/api/clients/${client.id}/metrics`, { tdee: parsedCustom });
      } else if (!isCustomTdee && storedOverride) {
        await putJson(`/api/clients/${client.id}/metrics`, { tdeeManualOverride: false });
      }

      // The check-in config schema requires frequency + reminder preferences on
      // every write, so the untouched ones are echoed back verbatim.
      const nextDay = values.expectedCheckInDay === UNSET ? null : values.expectedCheckInDay;
      if (nextDay !== (client.expectedCheckInDay ?? null)) {
        await patchJson(`/api/clients/${client.id}/check-in-config`, {
          checkInFrequency: client.checkInFrequency ?? "weekly",
          ...(client.checkInFrequencyDays != null
            ? { checkInFrequencyDays: client.checkInFrequencyDays }
            : {}),
          expectedCheckInDay: nextDay,
          reminderPreferences: client.reminderPreferences ?? {
            enabled: true,
            autoSend: false,
            sendBeforeHours: 24,
          },
        });
      }

      onSaved();
      onOpenChange(false);
      toast({ title: "Client settings saved" });
    } catch (error) {
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Client settings</DialogTitle>
          <DialogDescription>
            Profile details and the day this client is expected to check in.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)}>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="settings-gender">Gender</Label>
              <Select
                value={form.watch("gender")}
                onValueChange={(v) => form.setValue("gender", v as SettingsFormValues["gender"])}
              >
                <SelectTrigger id="settings-gender" className={TRIGGER_CLASS}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-[6px] border border-[rgba(13,148,136,0.08)] bg-white p-1 shadow-lg">
                  <SelectItem value={UNSET} className={ITEM_CLASS}>
                    Not set
                  </SelectItem>
                  <SelectItem value="male" className={ITEM_CLASS}>
                    Male
                  </SelectItem>
                  <SelectItem value="female" className={ITEM_CLASS}>
                    Female
                  </SelectItem>
                  <SelectItem value="other" className={ITEM_CLASS}>
                    Other
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="settings-height">Height</Label>
              {/* No unit picker. The stored value is centimetres either way;
                  this renders it in whichever units the COACH reading the
                  screen prefers, and feet+inches rather than decimal inches
                  because that is how imperial height is spoken. */}
              {height.system === "imperial" ? (
                <div className="flex gap-2">
                  <SuffixedInput
                    id="settings-height"
                    suffix="ft"
                    placeholder="Not set"
                    value={height.fields.feet}
                    onChange={height.setFeet}
                  />
                  <SuffixedInput
                    ariaLabel="Height, inches"
                    suffix="in"
                    placeholder="0"
                    value={height.fields.inches}
                    onChange={height.setInches}
                  />
                </div>
              ) : (
                <SuffixedInput
                  id="settings-height"
                  suffix="cm"
                  placeholder="Not set"
                  value={height.fields.cm}
                  onChange={height.setCm}
                />
              )}
              {height.hasParseError && (
                <p className="text-[11px] text-[#c06060]">Enter a height above 0</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="settings-dob">Date of birth</Label>
              <Input
                id="settings-dob"
                type="date"
                {...form.register("dateOfBirth")}
                className={cn(FOCUS_RING, "h-8 text-[13px]")}
              />
              {form.formState.errors.dateOfBirth && (
                <p className="text-[11px] text-[#c06060]">
                  {form.formState.errors.dateOfBirth.message}
                </p>
              )}
            </div>

            {/* Energy. The activity ladder describes the CLIENT — it is the one
                place it is set, and nothing in the nutrition builder writes it. */}
            <div className="space-y-1.5">
              <Label htmlFor="settings-activity">Work activity level</Label>
              <Select
                value={form.watch("workActivityLevel")}
                onValueChange={(v) =>
                  form.setValue("workActivityLevel", v as ActivityLevel)
                }
              >
                <SelectTrigger id="settings-activity" className={cn(TRIGGER_CLASS, "h-8")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTIVITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value} className={ITEM_CLASS}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-[#5c7a80]">
                How active their daily life is, outside training. It sets their TDEE.
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="settings-tdee">TDEE</Label>
                <button
                  type="button"
                  onClick={() => setIsCustomTdee((v) => !v)}
                  className="text-[11px] font-medium text-[#0d9488] hover:underline"
                >
                  {isCustomTdee ? "Back to auto" : "Set a custom value"}
                </button>
              </div>

              {isCustomTdee ? (
                <>
                  <Input
                    id="settings-tdee"
                    type="number"
                    inputMode="numeric"
                    value={customTdee}
                    onChange={(e) => setCustomTdee(e.target.value)}
                    className={cn(FOCUS_RING, MONO_INPUT_CLASS, "h-8 text-[13px]")}
                  />
                  {customTdeeBelowBmr ? (
                    <p className="text-[11px] text-[#c06060]">
                      Can&apos;t be below BMR ({formatCalories(autoReady.bmr)} cal/day) —
                      total daily energy always exceeds resting energy.
                    </p>
                  ) : (
                    <p className="text-[11px] text-[#5c7a80]">
                      {autoReady
                        ? `Frozen at your number. Auto would be ${formatCalories(autoReady.tdee)} cal/day.`
                        : "Frozen at your number."}
                    </p>
                  )}
                </>
              ) : autoReady ? (
                <p className="text-[11px] text-[#5c7a80]">
                  <span className={MONO_INPUT_CLASS}>{formatCalories(autoReady.tdee)}</span> cal/day
                  {" — "}
                  BMR <span className={MONO_INPUT_CLASS}>{formatCalories(autoReady.bmr)}</span>
                  {" × "}
                  <span className={MONO_INPUT_CLASS}>{autoReady.activityMultiplier}</span>
                  {autoReady.activityLevelSource === "default" ? " (activity not set)" : ""}
                </p>
              ) : (
                <p className="text-[11px] text-[#5c7a80]">
                  Add {autoEnergy.status === "insufficient" ? autoEnergy.missing.join(", ") : "metrics"} to
                  calculate this automatically.
                </p>
              )}

              {showBirthDateNudge && (
                <p className="text-[11px] text-[#c8923a]">
                  Add a birth date for a more accurate BMR — age is assumed 30 without one.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="settings-start-date">Started</Label>
              <Input
                id="settings-start-date"
                type="date"
                {...form.register("startDate")}
                className={cn(FOCUS_RING, "h-8 text-[13px]")}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="settings-phone">Phone</Label>
              <Input
                id="settings-phone"
                type="tel"
                placeholder="Not set"
                {...form.register("phone")}
                className={cn(FOCUS_RING, "h-8 text-[13px]")}
              />
              {form.formState.errors.phone && (
                <p className="text-[11px] text-[#c06060]">{form.formState.errors.phone.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="settings-check-in-day">Check-in day</Label>
              <Select
                value={form.watch("expectedCheckInDay")}
                onValueChange={(v) => form.setValue("expectedCheckInDay", v)}
              >
                <SelectTrigger id="settings-check-in-day" className={TRIGGER_CLASS}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-[6px] border border-[rgba(13,148,136,0.08)] bg-white p-1 shadow-lg">
                  <SelectItem value={UNSET} className={ITEM_CLASS}>
                    Any day
                  </SelectItem>
                  {DAY_OPTIONS.map((day) => (
                    <SelectItem key={day} value={day} className={cn(ITEM_CLASS, "capitalize")}>
                      {day}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-[#0d9488] text-white hover:bg-[#0b7f75]"
              disabled={isSaving}
            >
              {isSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
