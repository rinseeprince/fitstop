"use client"

import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { SelectableCard } from "./selectable-card"
import type { ClientIntake, CookingFrequency } from "@/types/client-intake"

type IntakeStep4Props = {
  data: Partial<ClientIntake>
  onChange: (fields: Partial<ClientIntake>) => void
  errors: Record<string, string>
}

const dietaryOptions = [
  "None",
  "Vegetarian",
  "Vegan",
  "Pescatarian",
  "Gluten-free",
  "Dairy-free",
  "Keto",
  "Halal",
  "Kosher",
  "Other",
]

const cookingOptions: { value: CookingFrequency; label: string }[] = [
  { value: "mostly_cook", label: "I mostly cook" },
  { value: "meal_prep", label: "I meal prep" },
  { value: "mix_of_both", label: "Mix of both" },
  { value: "mostly_eat_out", label: "I mostly eat out" },
]

export function IntakeStep4({ data, onChange, errors }: IntakeStep4Props) {
  const toggleDietary = (item: string) => {
    const current = data.dietaryRequirements || []
    if (item === "None") {
      onChange({ dietaryRequirements: current.includes("None") ? [] : ["None"] })
      return
    }
    const withoutNone = current.filter((d) => d !== "None")
    const next = withoutNone.includes(item)
      ? withoutNone.filter((d) => d !== item)
      : [...withoutNone, item]
    onChange({ dietaryRequirements: next })
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-1">Nutrition</h3>
        <p className="text-sm text-muted-foreground">
          Fill in what you can — everything here is optional
        </p>
      </div>

      {/* Dietary Requirements */}
      <div className="space-y-3">
        <Label>Any dietary requirements?</Label>
        <div className="grid grid-cols-2 gap-3">
          {dietaryOptions.map((item) => (
            <label
              key={item}
              className="flex items-center gap-3 rounded-lg border p-3 min-h-[44px] cursor-pointer"
            >
              <Checkbox
                checked={(data.dietaryRequirements || []).includes(item)}
                onCheckedChange={() => toggleDietary(item)}
              />
              <span className="text-sm">{item}</span>
            </label>
          ))}
        </div>
        {errors.dietaryRequirements && (
          <p className="text-sm text-destructive">{errors.dietaryRequirements}</p>
        )}
      </div>

      {/* Food Allergies */}
      <div className="space-y-2">
        <Label>Any food allergies or intolerances?</Label>
        <Input
          placeholder="e.g. nuts, shellfish, lactose"
          value={data.foodAllergies || ""}
          onChange={(e) => onChange({ foodAllergies: e.target.value })}
          className="min-h-[44px]"
        />
      </div>

      {/* Current Diet */}
      <div className="space-y-2">
        <Label>What does a typical day of eating look like?</Label>
        <Textarea
          placeholder="Describe your usual meals and snacks..."
          value={data.dietDescription || ""}
          onChange={(e) => onChange({ dietDescription: e.target.value })}
          rows={3}
          maxLength={500}
          className="resize-none"
        />
      </div>

      {/* Cooking Frequency */}
      <div className="space-y-2">
        <Label>How do you usually get your meals?</Label>
        <div className="grid grid-cols-2 gap-3">
          {cookingOptions.map((opt) => (
            <SelectableCard
              key={opt.value}
              selected={data.cookingFrequency === opt.value}
              onClick={() => onChange({ cookingFrequency: opt.value })}
            >
              <span className="text-sm font-medium">{opt.label}</span>
            </SelectableCard>
          ))}
        </div>
      </div>

      {/* Tracked Macros */}
      <div className="space-y-2">
        <Label>Have you tracked macros before?</Label>
        <div className="grid grid-cols-2 gap-3">
          <SelectableCard
            selected={data.hasTrackedMacrosBefore === true}
            onClick={() => onChange({ hasTrackedMacrosBefore: true })}
          >
            <span className="text-sm font-medium">Yes</span>
          </SelectableCard>
          <SelectableCard
            selected={data.hasTrackedMacrosBefore === false}
            onClick={() => onChange({ hasTrackedMacrosBefore: false })}
          >
            <span className="text-sm font-medium">No</span>
          </SelectableCard>
        </div>
      </div>

      {/* Meals Per Day */}
      <div className="space-y-2">
        <Label>How many meals do you eat per day?</Label>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onChange({ mealsPerDay: n })}
              className={`flex h-11 w-11 items-center justify-center rounded-lg border-2 text-sm font-semibold transition-all ${
                data.mealsPerDay === n
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border hover:border-primary/50"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Biggest Challenge */}
      <div className="space-y-2">
        <Label>Biggest nutrition challenge?</Label>
        <Textarea
          placeholder="What's the hardest part about eating well for you?"
          value={data.biggestNutritionChallenge || ""}
          onChange={(e) => onChange({ biggestNutritionChallenge: e.target.value })}
          rows={3}
          maxLength={500}
          className="resize-none"
        />
      </div>
    </div>
  )
}
