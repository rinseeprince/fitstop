"use client"

import { useEffect, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SelectableCard } from "./selectable-card"
import { getDateString } from "@/lib/date-helpers"
import type { ClientIntake } from "@/types/client-intake"
import { useInvalidateUnitPreference, useUnits } from "@/contexts/units-context"
import { useCanonicalInput, useHeightInput } from "@/hooks/use-unit-inputs"
import { formatWeight, type UnitSystem } from "@/utils/unit-conversions"

type IntakeStep1Props = {
  data: Partial<ClientIntake>
  onChange: (fields: Partial<ClientIntake>) => void
  errors: Record<string, string>
}

const genderOptions = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
] as const

// ONE units control, and it writes the client's REAL preference.
//
// This used to be two independent toggles (cm/ft and kg/lbs) backed by
// localStorage, which made it the only place a pre-activation client could
// express a unit at all: app/client/layout.tsx sends a `pending_intake` client
// straight to this form and blocks every other route, so /client/settings is
// unreachable until their coach activates them. Deleting the toggle in favour
// of `useUnits()` alone would have stranded an imperial client typing kilograms
// into a form with no switch, because clients.unit_preference defaults to
// 'metric' (migration 141).
//
// So it stays — repointed at PATCH /api/client/settings, which is reachable
// pre-activation (getAuthenticatedClientId gates on clients.active, set true at
// creation, NOT on onboarding_status). That is the client setting their own
// preference, which is the whole point of the phase, and it means they arrive
// in the portal already in their unit instead of having it reset on them.

// Minimum 16 years old
const maxDob = new Date()
maxDob.setFullYear(maxDob.getFullYear() - 16)
const MAX_DOB_STRING = getDateString(maxDob)

export function IntakeStep1({ data, onChange, errors }: IntakeStep1Props) {
  const { preference } = useUnits()
  const invalidateUnitPreference = useInvalidateUnitPreference()
  const [isSavingUnit, setIsSavingUnit] = useState(false)
  const [unitError, setUnitError] = useState<string | null>(null)

  const height = useHeightInput(preference, data.height)
  const weight = useCanonicalInput(preference, data.currentWeight, "weight")
  const weightUnit = formatWeight(0, preference).unit

  // The parent re-creates onChange each render; a ref keeps the sync effects
  // below keyed on the VALUE changing rather than on the callback identity.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // Persisted immediately, not at submit: the fields below re-render in the new
  // unit the moment it changes, so a preference that only landed at the end of
  // the form would show the client one unit and store another.
  const chooseUnit = async (next: UnitSystem) => {
    if (next === preference || isSavingUnit) return
    setIsSavingUnit(true)
    setUnitError(null)
    try {
      const res = await fetch("/api/client/settings", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unitPreference: next }),
      })
      if (!res.ok) throw new Error("Failed to save units")
      await invalidateUnitPreference()
    } catch {
      setUnitError("Couldn't save your units. Please try again.")
    } finally {
      setIsSavingUnit(false)
    }
  }

  // The hooks own the display strings; the intake draft holds canonical cm/kg.
  // They seed once and on a unit change, never from these writes, so there is
  // no loop back into the fields.
  useEffect(() => {
    onChangeRef.current({ height: height.commitCm ?? undefined })
  }, [height.commitCm])
  useEffect(() => {
    onChangeRef.current({ currentWeight: weight.commit ?? undefined })
  }, [weight.commit])

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-1">About You</h3>
        <p className="text-sm text-muted-foreground">Basic info to get started</p>
      </div>

      {/* Units — one choice for the whole app, saved to this client's profile */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Which units do you use?</Label>
          <div className="flex rounded-lg border text-xs overflow-hidden">
            <button
              type="button"
              onClick={() => void chooseUnit("metric")}
              disabled={isSavingUnit}
              className={`px-3 py-1 ${preference === "metric" ? "bg-primary text-primary-foreground" : ""}`}
            >
              kg / cm
            </button>
            <button
              type="button"
              onClick={() => void chooseUnit("imperial")}
              disabled={isSavingUnit}
              className={`px-3 py-1 ${preference === "imperial" ? "bg-primary text-primary-foreground" : ""}`}
            >
              lbs / ft
            </button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          You can change this later in Settings.
        </p>
        {unitError && <p className="text-sm text-destructive">{unitError}</p>}
      </div>

      {/* Date of Birth */}
      <div className="space-y-2">
        <Label>When were you born?</Label>
        <Input
          type="date"
          value={data.dateOfBirth || ""}
          onChange={(e) => onChange({ dateOfBirth: e.target.value })}
          max={MAX_DOB_STRING}
          className="min-h-[44px]"
        />
        {errors.dateOfBirth && <p className="text-sm text-destructive">{errors.dateOfBirth}</p>}
      </div>

      {/* Gender */}
      <div className="space-y-2">
        <Label>How do you identify?</Label>
        <div className="grid grid-cols-2 gap-3">
          {genderOptions.map((opt) => (
            <SelectableCard
              key={opt.value}
              selected={data.gender === opt.value}
              onClick={() => onChange({ gender: opt.value })}
            >
              <span className="text-sm font-medium">{opt.label}</span>
            </SelectableCard>
          ))}
        </div>
        {errors.gender && <p className="text-sm text-destructive">{errors.gender}</p>}
      </div>

      {/* Height */}
      <div className="space-y-2">
        <Label htmlFor="intake-height">How tall are you?</Label>
        {height.system === "imperial" ? (
          <div className="flex gap-2">
            <Input
              id="intake-height"
              type="number"
              inputMode="numeric"
              placeholder="ft"
              value={height.fields.feet}
              onChange={(e) => height.setFeet(e.target.value)}
              className="min-h-[44px]"
            />
            <Input
              type="number"
              inputMode="numeric"
              aria-label="Height, inches"
              placeholder="in"
              value={height.fields.inches}
              onChange={(e) => height.setInches(e.target.value)}
              className="min-h-[44px]"
            />
          </div>
        ) : (
          <Input
            id="intake-height"
            type="number"
            inputMode="decimal"
            placeholder="e.g. 175"
            value={height.fields.cm}
            onChange={(e) => height.setCm(e.target.value)}
            className="min-h-[44px]"
          />
        )}
        {errors.height && <p className="text-sm text-destructive">{errors.height}</p>}
      </div>

      {/* Weight */}
      <div className="space-y-2">
        <Label htmlFor="intake-weight">
          What do you currently weigh? ({weightUnit})
        </Label>
        <Input
          id="intake-weight"
          type="number"
          inputMode="decimal"
          placeholder={preference === "imperial" ? "e.g. 165" : "e.g. 75"}
          value={weight.value}
          onChange={(e) => weight.setValue(e.target.value)}
          className="min-h-[44px]"
        />
        {errors.currentWeight && <p className="text-sm text-destructive">{errors.currentWeight}</p>}
      </div>

      {/* Body Fat % */}
      <div className="space-y-2">
        <Label>Body fat % (optional)</Label>
        <Input
          type="number"
          placeholder="e.g. 20"
          value={data.bodyFatPercentage || ""}
          onChange={(e) => onChange({ bodyFatPercentage: parseFloat(e.target.value) || undefined })}
          className="min-h-[44px]"
        />
        <p className="text-xs text-muted-foreground">If you know it — no worries if not</p>
        {errors.bodyFatPercentage && <p className="text-sm text-destructive">{errors.bodyFatPercentage}</p>}
      </div>
    </div>
  )
}
