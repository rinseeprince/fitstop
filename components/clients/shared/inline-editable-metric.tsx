"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, X, Pencil } from "lucide-react";

type InlineEditableMetricProps = {
  label: string;
  value: number | null | undefined;
  unit?: string;
  isManual?: boolean;
  placeholder?: string;
  onSave: (value: number) => Promise<void>;
  onResetToAuto?: () => Promise<void>;
  min?: number;
  max?: number;
  step?: number;
  formatDisplay?: (value: number) => string;
};

export function InlineEditableMetric({
  label,
  value,
  unit,
  isManual = false,
  placeholder = "Not set",
  onSave,
  onResetToAuto,
  min,
  max,
  step = 0.1,
  formatDisplay,
}: InlineEditableMetricProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value?.toString() || "");
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayValue = value
    ? formatDisplay
      ? formatDisplay(value)
      : value.toFixed(1)
    : placeholder;

  const handleEdit = () => {
    setEditValue(value?.toString() || "");
    setIsEditing(true);
    setError(null);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditValue(value?.toString() || "");
    setError(null);
  };

  const handleSave = async () => {
    const numValue = parseFloat(editValue);

    if (isNaN(numValue)) {
      setError("Please enter a valid number");
      return;
    }

    if (min !== undefined && numValue < min) {
      setError(`Value must be at least ${min}`);
      return;
    }

    if (max !== undefined && numValue > max) {
      setError(`Value must be at most ${max}`);
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await onSave(numValue);
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetToAuto = async () => {
    if (!onResetToAuto) return;

    setIsResetting(true);
    try {
      await onResetToAuto();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset");
    } finally {
      setIsResetting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      handleCancel();
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{label}</span>
        {isManual && (
          <Badge variant="secondary" className="text-xs">
            Manual
          </Badge>
        )}
      </div>

      {isEditing ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-9"
              step={step}
              min={min}
              max={max}
              autoFocus
            />
            {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
            <Button
              size="sm"
              variant="ghost"
              className="h-9 w-9 p-0"
              onClick={handleSave}
              disabled={isSaving}
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-9 w-9 p-0"
              onClick={handleCancel}
              disabled={isSaving}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      ) : (
        <div className="flex items-center gap-2 group">
          <button
            onClick={handleEdit}
            className="text-2xl font-bold hover:text-primary transition-colors flex items-center gap-2"
          >
            {displayValue}
            {unit && <span className="text-muted-foreground">{unit}</span>}
            <Pencil className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
          {isManual && onResetToAuto && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleResetToAuto}
              disabled={isResetting}
              className="text-xs h-7"
            >
              {isResetting ? "Resetting..." : "Reset to Auto"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
