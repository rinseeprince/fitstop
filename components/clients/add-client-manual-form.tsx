"use client";

import { useEffect } from "react";
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
import { useUnits } from "@/contexts/units-context";
import { useCanonicalInput, useHeightInput } from "@/hooks/use-unit-inputs";
import { formatLength, formatWeight } from "@/utils/unit-conversions";
import type { CreateClientInput } from "@/lib/validations/client";

// Every number this form submits is CANONICAL — kilograms and centimetres —
// and the coach types in whichever units they prefer. The unit <Select>s that
// used to sit beside Height and Goal Weight are gone: they described the
// payload rather than the reader, so two coaches sharing a client could
// disagree about what the same stored number meant.

type AddClientManualFormProps = {
  form: UseFormReturn<CreateClientInput>;
  onSubmit: (data: CreateClientInput) => Promise<void>;
  onBack: () => void;
};

export function AddClientManualForm({ form, onSubmit, onBack }: AddClientManualFormProps) {
  const { preference } = useUnits();
  const weightUnit = formatWeight(0, preference).unit;
  const lengthUnit = formatLength(0, preference).unit;

  const height = useHeightInput(preference, form.getValues("height"));
  const currentWeight = useCanonicalInput(
    preference,
    form.getValues("currentWeight"),
    "weight",
  );
  const goalWeight = useCanonicalInput(
    preference,
    form.getValues("goalWeight"),
    "weight",
  );

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
  useEffect(() => {
    setValue("goalWeight", goalWeight.commit ?? undefined);
  }, [goalWeight.commit, setValue]);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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

        {/* Goal Metrics */}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormItem>
            <FormLabel>Goal weight ({weightUnit})</FormLabel>
            <FormControl>
              <Input
                inputMode="decimal"
                placeholder={preference === "imperial" ? "150" : "68"}
                value={goalWeight.value}
                onChange={(e) => goalWeight.setValue(e.target.value)}
              />
            </FormControl>
            {goalWeight.hasParseError && (
              <p className="text-xs text-[#c06060]">Enter a weight above 0</p>
            )}
          </FormItem>

          <FormField
            control={form.control}
            name="goalBodyFatPercentage"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Goal body fat %</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="15"
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

        <div className="flex gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={onBack}
            disabled={form.formState.isSubmitting}
          >
            Back
          </Button>
          <Button
            type="submit"
            className="flex-1"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? (
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
