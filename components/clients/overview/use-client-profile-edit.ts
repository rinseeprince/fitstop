"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { useUnits } from "@/contexts/units-context";
import { useCanonicalInput, useHeightInput } from "@/hooks/use-unit-inputs";
import { formatWeight } from "@/utils/unit-conversions";
import { computeEnergyPair } from "@/services/client-energy-calc";
import type { Client } from "@/types/check-in";
import type { ClientGoal } from "@/types/client-goals";

/**
 * The client details form, behind the details sheet.
 *
 * It has been three surfaces: a "Client settings" modal, then inline editing
 * inside the Overview's two cards, now a 780px right sheet. The state has
 * always sat above the fields, which is why the move cost the form nothing —
 * the sheet mounts this the same way the cards consumed it.
 *
 * The form is react-hook-form + zodResolver per CONVENTIONS §3. Two families of
 * field are deliberately NOT in the zod schema: height, because it is composite
 * for an imperial viewer, and every unit-bearing weight, because
 * `useCanonicalInput`/`useHeightInput` own the conversion AND the
 * untouched-field guard that keeps a focus-through an exact no-op.
 *
 * The four writes below are NOT a transaction. See `submit`.
 */

export const UNSET = "unset";

const isoDate = (v: string) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v);

const profileFormSchema = z
  .object({
    // Mirrors updateClientSchema's bounds so the coach is told before
    // submitting rather than by a 400.
    name: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
    email: z.string().trim().email("Enter a valid email address"),
    gender: z.enum([UNSET, "male", "female", "other"]),
    dateOfBirth: z.string().refine(isoDate, { message: "Use a valid date" }),
    startDate: z.string().refine(isoDate, { message: "Use a valid date" }),
    phone: z.string().trim().max(30, "Phone must be less than 30 characters"),
    // Format-only, like goalDeadline: the past-date bound is enforced by the
    // route against the COACH's today, and `min` on the input is the
    // affordance. Empty means "no schedule".
    nextCheckInDue: z.string().refine(isoDate, { message: "Use a valid date" }),
    checkInFrequency: z.enum(["weekly", "biweekly", "monthly", "custom", "none"]),
    workActivityLevel: z.enum([
      "sedentary",
      "lightly_active",
      "moderately_active",
      "very_active",
      "extremely_active",
    ]),
    // The BASELINE body fat. Unitless, so unlike the weight beside it this is a
    // plain form field. The CURRENT body fat is deliberately absent: it is the
    // newest reading in the measurement log (see the note on `startWeight`
    // below), and the Journey's Log measurement is its writer.
    startingBodyFatPercentage: z
      .string()
      .refine((v) => v === "" || (Number(v) >= 3 && Number(v) <= 60), {
        message: "Body fat must be between 3% and 60%",
      }),
    // Goal fields. Goal WEIGHT is not here — it is unit-bearing, so
    // `useCanonicalInput` owns it and its untouched-field guard, exactly as
    // height is kept out for the same reason.
    goalBodyFatPercentage: z
      .string()
      .refine((v) => v === "" || (Number(v) >= 3 && Number(v) <= 60), {
        message: "Body fat must be between 3% and 60%",
      }),
    goalDeadline: z.string().refine(isoDate, { message: "Use a valid date" }),
    goalStartDate: z.string().refine(isoDate, { message: "Use a valid date" }),
  })
  // Mirrors the same rule on `updateGoalsSchema`, so the coach is told before
  // submitting rather than by a 400. The API-side copy is the load-bearing one.
  .refine(
    (v) => !(v.goalStartDate && v.goalDeadline) || v.goalStartDate <= v.goalDeadline,
    { message: "Start date must be on or before the deadline", path: ["goalStartDate"] }
  );

type ProfileFormValues = z.infer<typeof profileFormSchema>;

/**
 * Seeds come from TWO records, deliberately. The profile fields are on `clients`;
 * the goal fields are on the live `client_goals` row, which is the only store
 * that can be trusted for them — and `goalStartDate` in particular must come
 * from the raw goal, never from a resolved `EffectiveGoal`, whose `startDate`
 * is coalesced to today. Seeding a form from that coalesced value would write
 * today's date into a field the coach never set.
 */
function toDefaults(client: Client, goal: ClientGoal | null): ProfileFormValues {
  return {
    name: client.name,
    email: client.email,
    gender: client.gender ?? UNSET,
    dateOfBirth: client.dateOfBirth ?? "",
    startDate: client.startDate ?? "",
    phone: client.phone ?? "",
    nextCheckInDue: client.nextCheckInDue ?? "",
    checkInFrequency: client.checkInFrequency ?? "weekly",
    // Sedentary is the default everywhere — the column default and the
    // calculator's fallback for NULL both agree, so there is no "not set".
    workActivityLevel: client.workActivityLevel ?? "sedentary",
    startingBodyFatPercentage:
      client.startingBodyFatPercentage != null
        ? String(client.startingBodyFatPercentage)
        : "",
    goalBodyFatPercentage:
      goal?.goalBodyFatPercentage != null ? String(goal.goalBodyFatPercentage) : "",
    goalDeadline: goal?.goalDeadline ?? "",
    goalStartDate: goal?.goalStartDate ?? "",
  };
}

async function sendJson(method: "PATCH" | "PUT", url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await res.json()) as { success?: boolean; error?: string };
  if (!res.ok || payload.success === false) {
    throw new Error(payload.error || "Failed to save changes");
  }
}

export type ClientProfileEdit = ReturnType<typeof useClientProfileEdit>;

export function useClientProfileEdit(
  client: Client,
  onSaved: () => void,
  goal: ClientGoal | null
) {
  const { toast } = useToast();
  const { preference } = useUnits();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [customTdee, setCustomTdee] = useState("");
  const [isCustomTdee, setIsCustomTdee] = useState(false);
  // A START value re-bases every progress figure and overwrites a recorded
  // fact nothing else can recover, so it is confirmed before it is written.
  const [confirmStartOpen, setConfirmStartOpen] = useState(false);

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: toDefaults(client, goal),
  });

  const height = useHeightInput(preference, client.height);
  // Collected in the coach's unit, converted on submit. `commit` is
  // `isPristine ? seed : canonical` compared on the SEEDED STRING, which is what
  // makes a focus-through an exact no-op: 100 kg seeds an imperial coach as
  // "220.5" and re-parses to 100.017, so a form that re-parsed whatever sat in
  // the box would drift the stored goal on every save (CONVENTIONS §20).
  const goalWeight = useCanonicalInput(preference, goal?.goalWeight, "weight");
  // The BASELINE weight, same treatment as the goal weight: collected in the
  // coach's unit, guarded on the seeded string so a focus-through is an exact
  // no-op (CONVENTIONS §20). Saving it appends a reading dated on the start
  // date, which the derived baseline then reads.
  //
  // The CURRENT weight is not here. It is the newest reading in the
  // measurement log — the series the chart and the Physique page draw from —
  // and a value typed on a profile form would be a reading with no day of its
  // own. The sheet shows it read-only and sends the coach to Log a measurement,
  // which appends the row and recomputes the energy pair when it is the newest.
  const startWeight = useCanonicalInput(preference, client.startingWeight, "weight");

  // Re-seed whenever editing opens, so a cancelled edit never leaks into the
  // next one and a background revalidation cannot overwrite a live edit.
  const { reset } = form;
  const resetHeight = height.reset;
  const resetGoalWeight = goalWeight.reset;
  const resetStartWeight = startWeight.reset;
  useEffect(() => {
    if (isEditing) {
      reset(toDefaults(client, goal));
      resetHeight(client.height);
      resetGoalWeight(goal?.goalWeight);
      resetStartWeight(client.startingWeight);
      setIsCustomTdee(client.tdeeManualOverride === true);
      setCustomTdee(client.tdee != null ? String(Math.round(client.tdee)) : "");
    }
  }, [
    isEditing,
    client,
    goal,
    reset,
    resetHeight,
    resetGoalWeight,
    resetStartWeight,
  ]);

  // The live preview runs the SAME pure calculator the server writes with, so
  // what the coach is shown while typing cannot disagree with what is stored.
  const watched = form.watch();
  const autoEnergy = computeEnergyPair({
    weightKg: client.currentWeight,
    heightCm: height.commitCm ?? client.height,
    gender: watched.gender === UNSET ? undefined : watched.gender,
    bodyFatPercentage: client.currentBodyFatPercentage,
    dateOfBirth: watched.dateOfBirth === "" ? null : watched.dateOfBirth,
    activityLevel: watched.workActivityLevel,
  });
  const autoEnergyReady = autoEnergy.status === "ready" ? autoEnergy : null;

  const parsedCustomTdee = Number(customTdee);
  const customTdeeBelowBmr =
    isCustomTdee &&
    customTdee.trim() !== "" &&
    Number.isFinite(parsedCustomTdee) &&
    autoEnergyReady != null &&
    parsedCustomTdee < autoEnergyReady.bmr;

  // Surfaced only where it changes the answer: Katch-McArdle uses lean mass and
  // has no age term, so a missing birth date costs nothing on that path.
  const showBirthDateNudge =
    watched.dateOfBirth === "" && autoEnergyReady?.ageSource === "assumed_default";

  /**
   * Emptying a WEIGHT is refused, never silently ignored: neither weight column
   * is nullable through `updateClientSchema`, so there is no payload that
   * clears one, and a box the coach cleared that quietly kept its old value is
   * worse than an error.
   *
   * BODY FAT is clearable and deliberately absent from this guard. It is an
   * estimate, and a wrong one does not merely read wrong — `computeEnergyPair`
   * switches from Mifflin-St Jeor to Katch-McArdle whenever a body fat is
   * present, so a bad figure changes which formula produces the client's BMR.
   * Withdrawing it has to be expressible, not only replaceable with another
   * guess.
   */
  const clearedMeasurement = ((): string | null => {
    if (!startWeight.isPristine && startWeight.commit == null) return "start weight";
    // A recorded start body fat with its box emptied. A blank is not an edit
    // to the recorded start, so it is refused HERE, before the confirm — the
    // server refuses the removal (`ReadingRemovalUnavailableError`), and a
    // dialog asking a coach to confirm an outcome that cannot happen is noise.
    if (client.startingBodyFatPercentage != null && watched.startingBodyFatPercentage === "") {
      return "start body fat";
    }
    return null;
  })();

  /**
   * Which START values this save would REPLACE, as phrases for the confirm.
   * Empty means no confirm is needed.
   *
   * Filling a blank start value is deliberately NOT one of them. The dialog
   * exists because overwriting a recorded start destroys a fact nothing can
   * recover and re-bases every figure derived from it — setting the first one
   * destroys nothing, and a confirm headed "Change the recorded start?" over a
   * record that does not exist is a warning about an outcome that cannot
   * happen. The two cases this feature was asked for split exactly here: a
   * coach who FORGOT a start weight is not interrupted; a coach fixing one they
   * typed wrong is.
   */
  const startEdits: string[] = [];
  if (
    client.startingWeight != null &&
    !startWeight.isPristine &&
    startWeight.commit != null
  ) {
    const shown = formatWeight(startWeight.commit, preference);
    startEdits.push(`start weight becomes ${shown.value.toFixed(1)} ${shown.unit}`);
  }
  if (
    client.startingBodyFatPercentage != null &&
    watched.startingBodyFatPercentage !== "" &&
    watched.startingBodyFatPercentage !== toDefaults(client, goal).startingBodyFatPercentage
  ) {
    // An emptied box is not on this list: `clearedMeasurement` refuses it
    // before the confirm, so the dialog only ever names a replacement.
    startEdits.push(`start body fat becomes ${watched.startingBodyFatPercentage}%`);
  }

  const submit = async (values: ProfileFormValues) => {
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
        description: `TDEE can't be below BMR (${autoEnergyReady?.bmr} cal/day).`,
        variant: "destructive",
      });
      return;
    }
    // A goal weight can be changed but never removed: `updateGoalsSchema` has it
    // `.optional()` and NOT `.nullable()`, so there is no payload that clears it.
    // Emptying the box silently doing nothing would be the worse answer.
    if (!goalWeight.isPristine && goalWeight.commit == null) {
      toast({
        title: "Save failed",
        description: goalWeight.hasParseError
          ? "Enter a goal weight above 0, or put the previous value back."
          : "A goal weight can't be removed — change it instead.",
        variant: "destructive",
      });
      return;
    }
    if (clearedMeasurement) {
      toast({
        title: "Save failed",
        description: `A ${clearedMeasurement} can't be left blank — change it instead.`,
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    // Which writes have already committed when something later throws. These
    // four calls are NOT a transaction, so the error has to say what survived
    // rather than implying nothing did.
    let committed = false;
    try {
      const profile: Record<string, unknown> = {
        name: values.name,
        email: values.email,
        phone: values.phone,
        workActivityLevel: values.workActivityLevel,
      };
      if (values.gender !== UNSET) profile.gender = values.gender;
      // `commitCm` is the untouched seed unless the field was edited, so a save
      // that changed only the phone number cannot drift a stored 178 cm through
      // its rounded imperial display (5'10" parses back to 177.8).
      if (height.commitCm != null) profile.height = height.commitCm;
      if (values.startDate !== "") profile.startDate = values.startDate;
      if (values.dateOfBirth !== "") profile.dateOfBirth = values.dateOfBirth;

      // The two BASELINE measurements, each sent only when it actually changed —
      // the same seeded-string guard as height and goal weight, for the same
      // reason: display rounding is lossy, so re-sending an untouched box
      // would drift the stored value on every save. Both route server-side to
      // `recordClientStart`, the single writer that also moves the metric
      // entries dated on the start date.
      const seededNow = toDefaults(client, goal);
      if (!startWeight.isPristine) profile.startingWeight = startWeight.commit;
      // A blank never reaches here — `clearedMeasurement` refused it above —
      // so a changed box always holds a number.
      if (values.startingBodyFatPercentage !== seededNow.startingBodyFatPercentage) {
        profile.startingBodyFatPercentage = Number(values.startingBodyFatPercentage);
      }

      // Recomputes BMR/TDEE server-side because it carries energy inputs. The
      // override below is applied after, so a coach setting both in one save
      // ends with their typed number rather than the recompute.
      await sendJson("PATCH", `/api/clients/${client.id}`, profile);
      committed = true;

      const storedOverride = client.tdeeManualOverride === true;
      if (isCustomTdee && Number.isFinite(parsedCustomTdee) && parsedCustomTdee > 0) {
        await sendJson("PUT", `/api/clients/${client.id}/metrics`, { tdee: parsedCustomTdee });
      } else if (!isCustomTdee && storedOverride) {
        await sendJson("PUT", `/api/clients/${client.id}/metrics`, { tdeeManualOverride: false });
      }

      const nextDue = values.nextCheckInDue === "" ? null : values.nextCheckInDue;
      const dueChanged = nextDue !== (client.nextCheckInDue ?? null);
      const frequencyChanged = values.checkInFrequency !== seededNow.checkInFrequency;
      if (dueChanged || frequencyChanged) {
        // The check-in config schema requires frequency + reminder preferences
        // on every write, so whichever of the two was NOT edited is echoed back
        // verbatim — as are the reminder preferences, which this form never
        // shows. Dropping them would silently disable a client's reminders.
        //
        // `checkInFrequencyDays` rides along only while the frequency is still
        // `custom`: it is the interval `custom` means, and the sheet keeps that
        // option selectable precisely so a custom client is not rewritten to
        // weekly by a save that never touched the field.
        await sendJson("PATCH", `/api/clients/${client.id}/check-in-config`, {
          checkInFrequency: values.checkInFrequency,
          ...(values.checkInFrequency === "custom" && client.checkInFrequencyDays != null
            ? { checkInFrequencyDays: client.checkInFrequencyDays }
            : {}),
          nextCheckInDue: nextDue,
          reminderPreferences: client.reminderPreferences ?? {
            enabled: true,
            autoSend: false,
            sendBeforeHours: 24,
          },
        });
      }

      // The goal, LAST and only when it actually changed.
      //
      // **The change detection is load-bearing, not an optimisation.**
      // `updateGoals` supersedes-and-inserts on EVERY call with no change
      // detection of its own, so calling it unconditionally would mint a new
      // `client_goals` version and an audit event every time a coach edited a
      // phone number (invariant 7). Each field is compared against the value it
      // was SEEDED from; the weight compares through `commit`'s seeded-string
      // guard rather than an epsilon.
      const seeded = toDefaults(client, goal);
      const goalPayload: Record<string, number | string | null> = {};
      if (!goalWeight.isPristine) {
        goalPayload.goalWeight = goalWeight.commit;
      }
      if (values.goalBodyFatPercentage !== seeded.goalBodyFatPercentage) {
        goalPayload.goalBodyFatPercentage =
          values.goalBodyFatPercentage === "" ? null : Number(values.goalBodyFatPercentage);
      }
      if (values.goalDeadline !== seeded.goalDeadline) {
        goalPayload.goalDeadline = values.goalDeadline || null;
      }
      if (values.goalStartDate !== seeded.goalStartDate) {
        goalPayload.goalStartDate = values.goalStartDate || null;
      }
      if (Object.keys(goalPayload).length > 0) {
        await sendJson("PUT", `/api/clients/${client.id}/goals`, goalPayload);
      }

      onSaved();
      setIsEditing(false);
      toast({ title: "Client updated" });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Something went wrong";
      toast({
        // Four sequential writes, no transaction. Reporting a bare "Save failed"
        // after the client details already committed tells the coach to redo an
        // edit that is already stored.
        title: committed ? "Partly saved" : "Save failed",
        description: committed
          ? `The client details were saved, but the rest was not: ${reason}`
          : reason,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const save = form.handleSubmit(submit);

  /**
   * The rail's commit. Validates first, so a coach with an invalid field gets
   * the field error rather than a confirm followed by one; only then does a
   * START edit raise the dialog. `confirmStartEdit` re-enters through `save`
   * because the dialog is modal — nothing can have changed in between.
   */
  const requestSave = form.handleSubmit(async (values) => {
    if (startEdits.length > 0) {
      setConfirmStartOpen(true);
      return;
    }
    await submit(values);
  });

  return {
    // The confirm's sentence names the client, and the dialog mounts beside the
    // commit action rather than in a host — so no future host can mount the
    // editor and forget the guard on its most consequential field.
    clientName: client.name,
    isEditing,
    isSaving,
    start: () => setIsEditing(true),
    cancel: () => {
      setIsEditing(false);
      setConfirmStartOpen(false);
    },
    save,
    requestSave,
    startEdits,
    confirmStartOpen,
    setConfirmStartOpen,
    confirmStartEdit: () => {
      setConfirmStartOpen(false);
      void save();
    },
    form,
    height,
    goalWeight,
    startWeight,
    autoEnergy: autoEnergyReady,
    customTdee,
    setCustomTdee,
    isCustomTdee,
    setIsCustomTdee,
    customTdeeBelowBmr,
    showBirthDateNudge,
  };
}
