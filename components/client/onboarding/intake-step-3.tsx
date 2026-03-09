"use client"

import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { SelectableCard } from "./selectable-card"


import type {
  ClientIntake,
  WorkActivityLevel,
  TrainingTimePreference,
  TrainingLocation,
} from "@/types/client-intake"

type IntakeStep3Props = {
  data: Partial<ClientIntake>
  onChange: (fields: Partial<ClientIntake>) => void
  errors: Record<string, string>
}

const activityOptions: { value: WorkActivityLevel; label: string; desc: string }[] = [
  { value: "sedentary", label: "Sedentary", desc: "Desk job, mostly sitting" },
  { value: "lightly_active", label: "Lightly Active", desc: "Some walking, light activity" },
  { value: "moderately_active", label: "Moderate", desc: "On your feet regularly" },
  { value: "very_active", label: "Very Active", desc: "Physical job, lots of movement" },
  { value: "extremely_active", label: "Extremely Active", desc: "Hard labour or very physical" },
]

const timeOptions: { value: TrainingTimePreference; label: string }[] = [
  { value: "morning", label: "Morning" },
  { value: "midday", label: "Midday" },
  { value: "evening", label: "Evening" },
  { value: "flexible", label: "Flexible" },
]

const locationOptions: { value: TrainingLocation; label: string }[] = [
  { value: "commercial_gym", label: "Commercial Gym" },
  { value: "home_gym", label: "Home Gym" },
  { value: "home_no_equipment", label: "Home (No Equipment)" },
  { value: "outdoor", label: "Outdoor" },
  { value: "mixed", label: "Mixed" },
]

const equipmentList = [
  "Dumbbells", "Barbell", "Pull-up Bar", "Resistance Bands",
  "Bench", "Kettlebell", "Cable Machine", "Squat Rack",
]

const durationOptions = [30, 45, 60, 75, 90, 120]

const showEquipment = (loc?: TrainingLocation) =>
  loc === "home_gym" || loc === "mixed"

export function IntakeStep3({ data, onChange, errors }: IntakeStep3Props) {
  const toggleEquipment = (item: string) => {
    const current = data.availableEquipment || []
    const next = current.includes(item)
      ? current.filter((e) => e !== item)
      : [...current, item]
    onChange({ availableEquipment: next })
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-1">Your Lifestyle</h3>
        <p className="text-sm text-muted-foreground">Help us understand your routine</p>
      </div>

      {/* Work Activity */}
      <div className="space-y-2">
        <Label>How active is your day-to-day?</Label>
        <div className="space-y-2">
          {activityOptions.map((opt) => (
            <SelectableCard
              key={opt.value}
              selected={data.workActivityLevel === opt.value}
              onClick={() => onChange({ workActivityLevel: opt.value })}
              className="w-full flex-row items-center justify-start gap-3 text-left"
            >
              <div>
                <p className="text-sm font-medium">{opt.label}</p>
                <p className="text-xs text-muted-foreground">{opt.desc}</p>
              </div>
            </SelectableCard>
          ))}
        </div>
        {errors.workActivityLevel && <p className="text-sm text-destructive">{errors.workActivityLevel}</p>}
      </div>

      {/* Training Days */}
      <div className="space-y-2">
        <Label>How many days per week can you train?</Label>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onChange({ daysPerWeek: d })}
              className={`flex h-11 w-11 items-center justify-center rounded-lg border-2 text-sm font-semibold transition-all ${
                data.daysPerWeek === d
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border hover:border-primary/50"
              }`}
            >
              {d}
            </button>
          ))}
        </div>
        {errors.daysPerWeek && <p className="text-sm text-destructive">{errors.daysPerWeek}</p>}
      </div>

      {/* Training Time */}
      <div className="space-y-2">
        <Label>When do you prefer to train?</Label>
        <div className="grid grid-cols-2 gap-3">
          {timeOptions.map((opt) => (
            <SelectableCard
              key={opt.value}
              selected={data.trainingTimePreference === opt.value}
              onClick={() => onChange({ trainingTimePreference: opt.value })}
            >
              <span className="text-sm font-medium">{opt.label}</span>
            </SelectableCard>
          ))}
        </div>
        {errors.trainingTimePreference && <p className="text-sm text-destructive">{errors.trainingTimePreference}</p>}
      </div>

      {/* Training Location */}
      <div className="space-y-2">
        <Label>Where do you train?</Label>
        <div className="grid grid-cols-2 gap-3">
          {locationOptions.map((opt) => (
            <SelectableCard
              key={opt.value}
              selected={data.trainingLocation === opt.value}
              onClick={() => {
                const updates: Partial<ClientIntake> = { trainingLocation: opt.value }
                if (!showEquipment(opt.value)) updates.availableEquipment = []
                onChange(updates)
              }}
            >
              <span className="text-sm font-medium">{opt.label}</span>
            </SelectableCard>
          ))}
        </div>
        {errors.trainingLocation && <p className="text-sm text-destructive">{errors.trainingLocation}</p>}
      </div>

      {/* Equipment (conditional) */}
      {showEquipment(data.trainingLocation) && (
        <div className="space-y-3">
          <Label>What equipment do you have access to?</Label>
          <div className="grid grid-cols-2 gap-3">
            {equipmentList.map((item) => (
              <label
                key={item}
                className="flex items-center gap-3 rounded-lg border p-3 min-h-[44px] cursor-pointer"
              >
                <Checkbox
                  checked={(data.availableEquipment || []).includes(item)}
                  onCheckedChange={() => toggleEquipment(item)}
                />
                <span className="text-sm">{item}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Session Duration */}
      <div className="space-y-2">
        <Label>How long are your sessions? (optional)</Label>
        <div className="flex flex-wrap gap-2">
          {durationOptions.map((min) => (
            <button
              key={min}
              type="button"
              onClick={() => onChange({ sessionDurationMinutes: min })}
              className={`rounded-lg border-2 px-4 py-2 text-sm font-medium transition-all min-h-[44px] ${
                data.sessionDurationMinutes === min
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border hover:border-primary/50"
              }`}
            >
              {min} min
            </button>
          ))}
        </div>
        {errors.sessionDurationMinutes && <p className="text-sm text-destructive">{errors.sessionDurationMinutes}</p>}
      </div>
    </div>
  )
}
