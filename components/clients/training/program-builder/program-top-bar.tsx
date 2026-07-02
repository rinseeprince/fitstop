"use client";

import { ArrowLeft, Loader2, Pencil, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ProgramDraft } from "./program-builder-types";
import {
  FOCUS_RING,
  LABEL_CLASS,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TRAINING_CARD_BORDER,
} from "./builder-tokens";

// Builder header card (mockup `bheader`): back, inline-editable program name,
// auto-derived meta, the program-level default surplus %, delete-program, and
// the mode actions (Edit / Save program / Discard). The view⇄edit machine is
// kept deliberately (the mockup is always-edit): leaving edit mode IS the
// preview, and Save's dirty tracking hangs off it. No assign-to-client here
// (assignment lives in the client's planner, Phase 5).
type ProgramTopBarProps = {
  draft: ProgramDraft;
  mode: "view" | "edit";
  isSaving: boolean;
  isDirty: boolean;
  onBack: () => void;
  onEdit: () => void;
  onSave: () => void;
  // Drafts: delete the draft plan. Saved plans: re-seed from server.
  onDiscardDraft: () => void;
  onDiscardChanges: () => void;
  onDeleteProgram: () => void;
  onRename: (name: string) => void;
  onDefaultSurplusChange: (pct: number | null) => void;
};

export function ProgramTopBar({
  draft,
  mode,
  isSaving,
  isDirty,
  onBack,
  onEdit,
  onSave,
  onDiscardDraft,
  onDiscardChanges,
  onDeleteProgram,
  onRename,
  onDefaultSurplusChange,
}: ProgramTopBarProps) {
  const trainingCount = draft.weeks.reduce(
    (sum, w) => sum + w.days.filter((d) => !d.isRest).length,
    0,
  );
  // Mockup formula: always one decimal ("1.5 sessions/week").
  const perWeek = (trainingCount / draft.weeks.length).toFixed(1);

  return (
    <div
      className={cn(
        "mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[6px] bg-white p-4",
        TRAINING_CARD_BORDER,
      )}
    >
      <button
        type="button"
        aria-label="Back to programs"
        className="rounded p-1 text-[#93b0b4] transition-colors hover:text-[#5a7d82]"
        onClick={onBack}
      >
        <ArrowLeft className="h-5 w-5" strokeWidth={1.5} />
      </button>

      <div className="min-w-0 flex-1">
        {mode === "edit" ? (
          <Input
            // Uncontrolled + keyed so reseeding picks up a fresh name; commit
            // on blur (empty falls back rather than violating name min(1)).
            key={`name-${draft.id}`}
            defaultValue={draft.name}
            maxLength={100}
            aria-label="Program name"
            className={cn(
              "h-auto border-0 p-0 text-lg font-semibold shadow-none",
              TEXT_PRIMARY,
              FOCUS_RING,
            )}
            onBlur={(e) => {
              const value = e.target.value.trim() || "Untitled program";
              // Write the committed value back so the (uncontrolled) input
              // can never display blank while the draft holds the fallback.
              e.target.value = value;
              onRename(value);
            }}
          />
        ) : (
          <h2 className={cn("truncate text-lg font-semibold", TEXT_PRIMARY)}>
            {draft.name}
          </h2>
        )}
        <div className={cn("mt-0.5 flex items-center gap-2 text-xs", TEXT_SECONDARY)}>
          <span>
            {draft.weeks.length} {draft.weeks.length === 1 ? "week" : "weeks"}
          </span>
          <span>·</span>
          <span>
            <span className="font-mono-display">{perWeek}</span> sessions/week
          </span>
          {draft.status === "draft" && (
            <Badge
              variant="outline"
              className="border-[rgba(13,148,136,0.12)] text-[10px] text-[#5a7d82]"
            >
              Draft
            </Badge>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <label className={cn("flex items-center gap-1.5", LABEL_CLASS)}>
          Default calorie surplus
          <Input
            key={`surplus-${draft.id}-${mode}`}
            type="number"
            min={0}
            max={100}
            step={0.5}
            disabled={mode !== "edit"}
            // Blank means "no default" (null) — never coerce to a number.
            defaultValue={draft.defaultSurplusPercentage ?? ""}
            aria-label="Default calorie surplus percent"
            className={cn(
              "h-7 w-16 px-1.5 text-center font-mono text-xs",
              FOCUS_RING,
            )}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              if (raw === "") {
                onDefaultSurplusChange(null);
                return;
              }
              const parsed = Number(raw);
              const clamped = Number.isFinite(parsed)
                ? Math.min(100, Math.max(0, parsed))
                : null;
              onDefaultSurplusChange(clamped);
              e.target.value = clamped == null ? "" : String(clamped);
            }}
          />
          <span className="normal-case">%</span>
        </label>

        <div className="h-6 w-px bg-[rgba(13,148,136,0.08)]" />

        <button
          type="button"
          aria-label="Delete program"
          title="Delete program"
          disabled={isSaving}
          className="rounded-[6px] p-2 text-[#c06060] transition-colors hover:bg-[rgba(192,96,96,0.08)] disabled:opacity-50"
          onClick={onDeleteProgram}
        >
          <Trash2 className="h-4 w-4" strokeWidth={1.5} />
        </button>

        {mode === "view" ? (
          <Button
            variant="outline"
            className="border-[rgba(13,148,136,0.15)] text-[#5a7d82]"
            onClick={onEdit}
          >
            <Pencil className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} /> Edit
          </Button>
        ) : (
          <>
            {draft.status === "draft" ? (
              <Button
                variant="ghost"
                className="text-destructive hover:bg-red-50 hover:text-destructive"
                disabled={isSaving}
                onClick={onDiscardDraft}
              >
                Discard
              </Button>
            ) : (
              <Button
                variant="ghost"
                className="text-destructive hover:bg-red-50 hover:text-destructive"
                disabled={isSaving || !isDirty}
                onClick={onDiscardChanges}
              >
                Discard changes
              </Button>
            )}
            <Button
              className="bg-[#0d9488] text-white hover:bg-[#0b7f75]"
              disabled={isSaving}
              onClick={onSave}
            >
              {isSaving ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} />
              )}
              Save program
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
