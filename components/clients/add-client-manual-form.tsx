"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Loader2, UserPlus } from "lucide-react";
import { UseFormReturn } from "react-hook-form";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { GoalFields } from "@/components/clients/goals/goal-fields";
import { useGoalDraft, type GoalDraftErrors } from "@/components/clients/goals/use-goal-draft";
import { useUnits } from "@/contexts/units-context";
import { useCanonicalInput, useHeightInput } from "@/hooks/use-unit-inputs";
import { getTodayDateString } from "@/lib/date-helpers";
import { goalBody } from "@/lib/goals/goal-form";
import { formatLength, formatWeight } from "@/utils/unit-conversions";
import type { CreateClientInput } from "@/lib/validations/client";

// Every number this form submits is CANONICAL — kilograms and centimetres —
// and the coach types in whichever units they prefer. The client's first goal
// takes the goals sheet's fields (components/clients/goals/goal-fields.tsx)
// and starts on their today.

type AddClientManualFormProps = {
  form: UseFormReturn<CreateClientInput>;
  onSubmit: (data: CreateClientInput) => Promise<void>;
  onBack: () => void;
  /** The dialog's create in flight — it outlives a successful close, so the
   *  closing card keeps "Adding…" (components/add-client-dialog.tsx). */
  pending: boolean;
};

export function AddClientManualForm({ form, onSubmit, onBack, pending }: AddClientManualFormProps) {
  const { preference } = useUnits();
  const weightUnit = formatWeight(0, preference).unit;
  const lengthUnit = formatLength(0, preference).unit;

  const height = useHeightInput(preference, form.getValues("height"));
  const currentWeight = useCanonicalInput(
    preference,
    form.getValues("currentWeight"),
    "weight",
  );
  const goal = useGoalDraft({ preference, stored: null });
  const [goalErrors, setGoalErrors] = useState<GoalDraftErrors>({});

  // The RHF fields hold canonical values; these inputs hold the coach's display
  // string. Pushing the conversion through on each keystroke keeps zodResolver
  // validating the number that will actually be stored.
  const { setValue } = form;
  useEffect(() => {
    setValue("height", height.commitCm ?? undefined);
  }, [height.commitCm, setValue]);
  useEffect(() => {
    setValue("currentWeight", currentWeight.commit ?? undefined);
  }, [currentWeight.commit, setValue]);
  // The goal's own checks first — a target the type needs, or one that does not
  // read or is out of bounds, says so in the coach's unit — and only a checked
  // goal is sent, none while the type is "No goal"; then the form's checks.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    const checked = goal.type ? goal.toDraft({ asksStart: false }) : null;
    setGoalErrors(checked?.errors ?? {});
    if (checked?.errors) {
      event.preventDefault();
      return;
    }
    setValue("goal", checked ? goalBody(checked.draft) : undefined);
    void form.handleSubmit(onSubmit)(event);
  };

  return (
    <Form {...form}>
      <form onSubmit={submit} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name *</FormLabel>
              <FormControl>
                <Input
                  placeholder="John Doe"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email *</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  placeholder="john@example.com"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notes</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Add any notes about this client..."
                  rows={3}
                  {...field}
                  className="resize-none"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Static Profile Fields */}
        {height.system === "imperial" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormItem>
              <FormLabel>Height (ft)</FormLabel>
              <FormControl>
                <Input
                  inputMode="numeric"
                  placeholder="5"
                  value={height.fields.feet}
                  onChange={(e) => height.setFeet(e.target.value)}
                />
              </FormControl>
            </FormItem>
            <FormItem>
              <FormLabel>Height (in)</FormLabel>
              <FormControl>
                <Input
                  inputMode="numeric"
                  placeholder="11"
                  value={height.fields.inches}
                  onChange={(e) => height.setInches(e.target.value)}
                />
              </FormControl>
            </FormItem>
          </div>
        ) : (
          <FormItem>
            <FormLabel>Height ({lengthUnit})</FormLabel>
            <FormControl>
              <Input
                inputMode="decimal"
                placeholder="180"
                value={height.fields.cm}
                onChange={(e) => height.setCm(e.target.value)}
              />
            </FormControl>
          </FormItem>
        )}
        {height.hasParseError && (
          <p className="text-xs text-[#c06060]">Enter a height above 0</p>
        )}

        <FormField
          control={form.control}
          name="gender"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Gender</FormLabel>
              <Select
                onValueChange={field.onChange}
                defaultValue={field.value}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select gender" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="dateOfBirth"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Date of birth</FormLabel>
              <FormControl>
                <Input
                  type="date"
                  {...field}
                  value={field.value ?? ""}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Current Metrics */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Required on this path: it becomes the client's STARTING weight as
              well as their current one, so leaving it blank produced a client
              with no baseline for any progress figure and no BMR. The intake
              path enforces the same thing in its own questionnaire. */}
          <FormItem>
            <FormLabel>Current weight ({weightUnit})</FormLabel>
            <FormControl>
              <Input
                inputMode="decimal"
                placeholder={preference === "imperial" ? "180" : "82"}
                value={currentWeight.value}
                onChange={(e) => currentWeight.setValue(e.target.value)}
              />
            </FormControl>
            {currentWeight.hasParseError ? (
              <p className="text-xs text-[#c06060]">Enter a weight above 0</p>
            ) : (
              form.formState.errors.currentWeight && (
                <p className="text-xs text-[#c06060]">
                  {form.formState.errors.currentWeight.message}
                </p>
              )
            )}
          </FormItem>

          <FormField
            control={form.control}
            name="currentBodyFatPercentage"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Current body fat %</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="20"
                    {...field}
                    value={field.value ?? ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      field.onChange(value === "" ? undefined : parseFloat(value));
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div>
          <SectionLabel label="Goal" />
          <GoalFields
            draft={goal}
            errors={goalErrors}
            readings={{
              weight: currentWeight.canonical,
              bodyFat: form.watch("currentBodyFatPercentage") ?? null,
            }}
            asksStart={false}
            startMin={getTodayDateString()}
            deadlineMin={getTodayDateString()}
            allowNoGoal
            idPrefix="add-client-goal"
          />
        </div>

        <div className="flex gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={onBack}
            disabled={pending}
          >
            Back
          </Button>
          <Button
            type="submit"
            className="flex-1"
            disabled={pending}
          >
            {pending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Adding...
              </>
            ) : (
              <>
                <UserPlus className="w-4 h-4 mr-2" />
                Add Client
              </>
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
