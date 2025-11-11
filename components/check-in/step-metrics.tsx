"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { BodyMetrics } from "@/types/check-in";

type StepMetricsProps = {
  data: Partial<BodyMetrics>;
  onChange: (data: Partial<BodyMetrics>) => void;
  previousData?: Partial<BodyMetrics>;
};

export const StepMetrics = ({
  data,
  onChange,
  previousData,
}: StepMetricsProps) => {
  const [showMeasurements, setShowMeasurements] = useState(false);

  const renderComparison = (current?: number, previous?: number) => {
    if (!previous || !current) return null;
    const diff = current - previous;
    if (Math.abs(diff) < 0.1) return null;

    return (
      <span
        className={`text-xs font-medium ${
          diff > 0 ? "text-orange-600" : "text-green-600"
        }`}
      >
        {diff > 0 ? "+" : ""}
        {diff.toFixed(1)}
      </span>
    );
  };

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-semibold mb-1">Body Metrics</h3>
        <p className="text-sm text-muted-foreground">
          Track your progress (all fields optional)
        </p>
      </div>

      {/* Weight */}
      <div className="space-y-3">
        <Label htmlFor="weight">Weight</Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              id="weight"
              type="number"
              step="0.1"
              placeholder="Enter weight"
              value={data.weight || ""}
              onChange={(e) =>
                onChange({ ...data, weight: parseFloat(e.target.value) || undefined })
              }
              className="pr-20"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
              <button
                type="button"
                onClick={() => onChange({ ...data, weightUnit: "lbs" })}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  data.weightUnit === "lbs" || !data.weightUnit
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                lbs
              </button>
              <button
                type="button"
                onClick={() => onChange({ ...data, weightUnit: "kg" })}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  data.weightUnit === "kg"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                kg
              </button>
            </div>
          </div>
          {previousData?.weight && (
            <div className="flex items-center px-3 glass-card">
              <span className="text-xs text-muted-foreground mr-2">
                Last: {previousData.weight}
              </span>
              {renderComparison(data.weight, previousData.weight)}
            </div>
          )}
        </div>
      </div>

      {/* Body Fat % */}
      <div className="space-y-3">
        <Label htmlFor="bodyFat">Body Fat % (Optional)</Label>
        <div className="flex gap-2">
          <Input
            id="bodyFat"
            type="number"
            step="0.1"
            placeholder="e.g., 18.5"
            value={data.bodyFatPercentage || ""}
            onChange={(e) =>
              onChange({
                ...data,
                bodyFatPercentage: parseFloat(e.target.value) || undefined,
              })
            }
          />
          {previousData?.bodyFatPercentage && (
            <div className="flex items-center px-3 glass-card">
              <span className="text-xs text-muted-foreground mr-2">
                Last: {previousData.bodyFatPercentage}%
              </span>
              {renderComparison(
                data.bodyFatPercentage,
                previousData.bodyFatPercentage
              )}
            </div>
          )}
        </div>
      </div>

      {/* Measurements Toggle */}
      <Button
        type="button"
        variant="outline"
        onClick={() => setShowMeasurements(!showMeasurements)}
        className="w-full"
      >
        {showMeasurements ? (
          <>
            <ChevronUp className="w-4 h-4 mr-2" />
            Hide Measurements
          </>
        ) : (
          <>
            <ChevronDown className="w-4 h-4 mr-2" />
            Add Measurements
          </>
        )}
      </Button>

      {/* Measurements Grid */}
      {showMeasurements && (
        <div className="space-y-6 pt-4 border-t">
          <div className="flex justify-end">
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => onChange({ ...data, measurementUnit: "in" })}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  data.measurementUnit === "in" || !data.measurementUnit
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                inches
              </button>
              <button
                type="button"
                onClick={() => onChange({ ...data, measurementUnit: "cm" })}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  data.measurementUnit === "cm"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                cm
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { key: "waist", label: "Waist", prev: previousData?.waist },
              { key: "hips", label: "Hips", prev: previousData?.hips },
              { key: "chest", label: "Chest", prev: previousData?.chest },
              { key: "arms", label: "Arms", prev: previousData?.arms },
              { key: "thighs", label: "Thighs", prev: previousData?.thighs },
            ].map(({ key, label, prev }) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={key}>{label}</Label>
                <div className="flex gap-2">
                  <Input
                    id={key}
                    type="number"
                    step="0.1"
                    placeholder="0.0"
                    value={(data as any)[key] || ""}
                    onChange={(e) =>
                      onChange({
                        ...data,
                        [key]: parseFloat(e.target.value) || undefined,
                      })
                    }
                  />
                  {prev && (
                    <div className="flex items-center px-2 glass-card min-w-[80px]">
                      <span className="text-xs text-muted-foreground mr-1">
                        {prev}
                      </span>
                      {renderComparison((data as any)[key], prev)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
