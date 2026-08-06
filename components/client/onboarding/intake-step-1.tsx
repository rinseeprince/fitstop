"use client"

import { useState, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SelectableCard } from "./selectable-card"
import { getDateString } from "@/lib/date-helpers"
import type { ClientIntake } from "@/types/client-intake"
import { formatHeight, kgToLbs, lbsToKg } from "@/utils/unit-conversions"

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

// Conversion goes through utils/unit-conversions.ts. This file used to carry a
// local 2.20462 — one of the four conflicting lbs<->kg constants that module
// exists to replace, and the least accurate of them. The display rounding stays
// here because it is a presentation choice, not a conversion.
//
// Both directions moved, not just display: the pair has to agree on a constant
// or the round trip is worse than either alone. The unit TOGGLE still reads
// localStorage rather than the viewer preference — that is Phase 4.
const cmToDisplay = (cm: number, unit: string) => {
  if (unit === "ft") {
    // formatHeight carries 12 inches into the next foot; the hand-rolled
    // modulo here could render 5'12".
    const h = formatHeight(cm, "imperial")
    return h.system === "imperial" ? { feet: h.feet, inches: h.inches } : { cm }
  }
  return { cm }
}

const toDisplayLbs = (kg: number) => Math.round(kgToLbs(kg) * 10) / 10
const toStoredKg = (lbs: number) => Math.round(lbsToKg(lbs) * 10) / 10

const VALID_HEIGHT_UNITS = ["cm", "ft"] as const
const VALID_WEIGHT_UNITS = ["kg", "lbs"] as const

// Minimum 16 years old
const maxDob = new Date()
maxDob.setFullYear(maxDob.getFullYear() - 16)
const MAX_DOB_STRING = getDateString(maxDob)

function readValidUnit<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const val = localStorage.getItem(key)
    return val && (allowed as readonly string[]).includes(val) ? val as T : fallback
  } catch (err) { console.warn("Failed to read localStorage key:", key, err); return fallback }
}

export function IntakeStep1({ data, onChange, errors }: IntakeStep1Props) {
  const [heightUnit, setHeightUnit] = useState(() => readValidUnit("intake-height-unit", VALID_HEIGHT_UNITS, "cm"))
  const [weightUnit, setWeightUnit] = useState(() => readValidUnit("intake-weight-unit", VALID_WEIGHT_UNITS, "kg"))
  // Local display values for ft/in
  const [ftVal, setFtVal] = useState("")
  const [inVal, setInVal] = useState("")

  // Sync ft/in display when switching to ft or on mount
  useEffect(() => {
    if (heightUnit === "ft" && data.height) {
      const { feet, inches } = cmToDisplay(data.height, "ft")
      setFtVal(String(feet))
      setInVal(String(inches))
    }
  }, [heightUnit, data.height])

  const toggleHeightUnit = (unit: typeof VALID_HEIGHT_UNITS[number]) => {
    setHeightUnit(unit)
    // eslint-disable-next-line no-empty
    try { localStorage.setItem("intake-height-unit", unit) } catch {}
  }

  const toggleWeightUnit = (unit: typeof VALID_WEIGHT_UNITS[number]) => {
    setWeightUnit(unit)
    // eslint-disable-next-line no-empty
    try { localStorage.setItem("intake-weight-unit", unit) } catch {}
  }

  const handleHeightCm = (val: string) => {
    const num = parseFloat(val)
    onChange({ height: isNaN(num) ? undefined : num })
  }

  const handleHeightFt = (feet: string, inches: string) => {
    setFtVal(feet)
    setInVal(inches)
    const f = parseInt(feet) || 0
    const i = parseInt(inches) || 0
    const cm = Math.round((f * 12 + i) * 2.54)
    onChange({ height: cm > 0 ? cm : undefined })
  }

  const handleWeight = (val: string) => {
    const num = parseFloat(val)
    if (isNaN(num)) { onChange({ currentWeight: undefined }); return }
    onChange({ currentWeight: weightUnit === "lbs" ? toStoredKg(num) : num })
  }

  const displayWeight = () => {
    if (!data.currentWeight) return ""
    return weightUnit === "lbs"
      ? String(toDisplayLbs(data.currentWeight))
      : String(data.currentWeight)
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-1">About You</h3>
        <p className="text-sm text-muted-foreground">Basic info to get started</p>
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
        <div className="flex items-center justify-between">
          <Label>How tall are you?</Label>
          <div className="flex rounded-lg border text-xs overflow-hidden">
            <button
              type="button"
              onClick={() => toggleHeightUnit("cm")}
              className={`px-3 py-1 ${heightUnit === "cm" ? "bg-primary text-primary-foreground" : ""}`}
            >
              cm
            </button>
            <button
              type="button"
              onClick={() => toggleHeightUnit("ft")}
              className={`px-3 py-1 ${heightUnit === "ft" ? "bg-primary text-primary-foreground" : ""}`}
            >
              ft
            </button>
          </div>
        </div>
        {heightUnit === "cm" ? (
          <Input
            type="number"
            placeholder="e.g. 175"
            value={data.height || ""}
            onChange={(e) => handleHeightCm(e.target.value)}
            className="min-h-[44px]"
          />
        ) : (
          <div className="flex gap-2">
            <Input
              type="number"
              placeholder="ft"
              value={ftVal}
              onChange={(e) => handleHeightFt(e.target.value, inVal)}
              className="min-h-[44px]"
            />
            <Input
              type="number"
              placeholder="in"
              value={inVal}
              onChange={(e) => handleHeightFt(ftVal, e.target.value)}
              className="min-h-[44px]"
            />
          </div>
        )}
        {errors.height && <p className="text-sm text-destructive">{errors.height}</p>}
      </div>

      {/* Weight */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>What do you currently weigh?</Label>
          <div className="flex rounded-lg border text-xs overflow-hidden">
            <button
              type="button"
              onClick={() => toggleWeightUnit("kg")}
              className={`px-3 py-1 ${weightUnit === "kg" ? "bg-primary text-primary-foreground" : ""}`}
            >
              kg
            </button>
            <button
              type="button"
              onClick={() => toggleWeightUnit("lbs")}
              className={`px-3 py-1 ${weightUnit === "lbs" ? "bg-primary text-primary-foreground" : ""}`}
            >
              lbs
            </button>
          </div>
        </div>
        <Input
          type="number"
          placeholder={weightUnit === "kg" ? "e.g. 75" : "e.g. 165"}
          value={displayWeight()}
          onChange={(e) => handleWeight(e.target.value)}
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
