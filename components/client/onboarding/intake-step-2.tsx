"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { SelectableCard } from "./selectable-card"
import {
  TrendingDown,
  Dumbbell,
  Activity,
  Target,
  Calendar,
  Shield,
} from "lucide-react"
import { useEffect, useRef } from "react"
import type { ClientIntake, PrimaryGoal } from "@/types/client-intake"
import { getTodayDateString } from "@/lib/date-helpers"
import { useUnits } from "@/contexts/units-context"
import { useCanonicalInput } from "@/hooks/use-unit-inputs"
import { formatWeight } from "@/utils/unit-conversions"

// `client_intake.target_weight` is canonical KILOGRAMS. The label here read a
// hardcoded "(kg)" while step 1 let the client enter their weight in pounds —
// so an imperial client typed 155 meaning pounds into a box asking for
// kilograms, one screen after entering 165 lbs correctly.

type IntakeStep2Props = {
  data: Partial<ClientIntake>
  onChange: (fields: Partial<ClientIntake>) => void
  errors: Record<string, string>
}

const goalOptions: { value: PrimaryGoal; label: string; icon: React.ElementType }[] = [
  { value: "lose_weight", label: "Lose Weight", icon: TrendingDown },
  { value: "build_muscle", label: "Build Muscle", icon: Dumbbell },
  { value: "recomposition", label: "Body Recomp", icon: Activity },
  { value: "general_fitness", label: "General Fitness", icon: Target },
  { value: "event_prep", label: "Event Prep", icon: Calendar },
  { value: "maintain", label: "Maintain", icon: Shield },
]

const needsTargetWeight = (goal?: PrimaryGoal) =>
  goal === "lose_weight" || goal === "build_muscle"

export function IntakeStep2({ data, onChange, errors }: IntakeStep2Props) {
  const { preference } = useUnits()
  const weightUnit = formatWeight(0, preference).unit
  const targetWeight = useCanonicalInput(preference, data.targetWeight, "weight")

  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    onChangeRef.current({ targetWeight: targetWeight.commit ?? undefined })
  }, [targetWeight.commit])

  const resetTargetWeight = targetWeight.reset
  const handleGoalChange = (goal: PrimaryGoal) => {
    const updates: Partial<ClientIntake> = { primaryGoal: goal }
    if (!needsTargetWeight(goal)) {
      updates.targetWeight = undefined
      // Clear the box too, or switching to "Maintain" and back would re-show a
      // number the draft no longer holds.
      resetTargetWeight(null)
    }
    onChange(updates)
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-1">Your Goals</h3>
        <p className="text-sm text-muted-foreground">What are you working towards?</p>
      </div>

      {/* Primary Goal */}
      <div className="space-y-2">
        <Label>What&apos;s your main goal?</Label>
        <div className="grid grid-cols-2 gap-3">
          {goalOptions.map(({ value, label, icon: Icon }) => (
            <SelectableCard
              key={value}
              selected={data.primaryGoal === value}
              onClick={() => handleGoalChange(value)}
              className="py-5"
            >
              <Icon className="h-6 w-6" />
              <span className="text-sm font-medium">{label}</span>
            </SelectableCard>
          ))}
        </div>
        {errors.primaryGoal && <p className="text-sm text-destructive">{errors.primaryGoal}</p>}
      </div>

      {/* Conditional: Target Weight */}
      {needsTargetWeight(data.primaryGoal) && (
        <div className="space-y-2">
          <Label htmlFor="intake-target-weight">
            What&apos;s your target weight? ({weightUnit})
          </Label>
          <Input
            id="intake-target-weight"
            type="number"
            inputMode="decimal"
            placeholder={preference === "imperial" ? "e.g. 155" : "e.g. 70"}
            value={targetWeight.value}
            onChange={(e) => targetWeight.setValue(e.target.value)}
            className="min-h-[44px]"
          />
          {errors.targetWeight && <p className="text-sm text-destructive">{errors.targetWeight}</p>}
        </div>
      )}

      {/* Goal Body Fat % (optional) */}
      <div className="space-y-2">
        <Label>Goal body fat %? (optional)</Label>
        <Input
          type="number"
          placeholder="e.g. 12"
          value={data.goalBodyFatPercentage || ""}
          onChange={(e) => onChange({ goalBodyFatPercentage: parseFloat(e.target.value) || undefined })}
          className="min-h-[44px]"
          step="0.1"
          min="3"
          max="60"
        />
        {errors.goalBodyFatPercentage && <p className="text-sm text-destructive">{errors.goalBodyFatPercentage}</p>}
      </div>

      {/* Goal Deadline */}
      <div className="space-y-2">
        <Label>Any target date in mind? (optional)</Label>
        <Input
          type="date"
          value={data.goalDeadline || ""}
          onChange={(e) => onChange({ goalDeadline: e.target.value })}
          min={getTodayDateString()}
          className="min-h-[44px]"
        />
        {errors.goalDeadline && <p className="text-sm text-destructive">{errors.goalDeadline}</p>}
      </div>

      {/* Goal Description */}
      <div className="space-y-2">
        <Label>Describe your goal</Label>
        <Textarea
          placeholder="In your own words, what does success look like?"
          value={data.goalDescription || ""}
          onChange={(e) => onChange({ goalDescription: e.target.value })}
          rows={3}
          maxLength={500}
          className="resize-none"
        />
        {errors.goalDescription && <p className="text-sm text-destructive">{errors.goalDescription}</p>}
      </div>

      {/* Motivation */}
      <div className="space-y-2">
        <Label>What&apos;s driving this goal?</Label>
        <Textarea
          placeholder="What's driving this goal right now?"
          value={data.motivation || ""}
          onChange={(e) => onChange({ motivation: e.target.value })}
          rows={3}
          maxLength={500}
          className="resize-none"
        />
        {errors.motivation && <p className="text-sm text-destructive">{errors.motivation}</p>}
      </div>
    </div>
  )
}
