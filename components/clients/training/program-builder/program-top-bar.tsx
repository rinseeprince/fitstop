"use client";

import { ArrowLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useSavedPlanAssignments } from "@/hooks/use-saved-plan-assignments";
import type { ProgramDraft } from "./program-builder-types";
import { FOCUS_RING } from "./builder-tokens";

// Builder hero — a StatBand-style KPI band (same treatment as the library
// pages: bg #0f2027, celled layout, rgba-white mutes): Program (inline-
// editable name) · Assignments (live count) · Length · Default surplus
// (the input). ALL program actions (Edit/Delete/Discard/Save) live on the
// SCHEDULE divider (roadmap pattern). The view⇄edit machine is kept
// deliberately (the mockup is always-edit): leaving edit mode IS the
// preview, and Save's dirty tracking hangs off it. No assign-to-client here
// (assignment lives in the client's planner, Phase 5).
type ProgramTopBarProps = {
  draft: ProgramDraft;
  mode: "view" | "edit";
  onBack: () => void;
  onRename: (name: string) => void;
  onDefaultSurplusChange: (pct: number | null) => void;
};

const CELL_LABEL =
  "text-[10px] uppercase tracking-[0.06em] text-[rgba(255,255,255,0.35)] font-medium";
const CELL_SUB = "mt-1 font-mono-display text-[10px] text-[rgba(255,255,255,0.3)]";

export function ProgramTopBar({
  draft,
  mode,
  onBack,
  onRename,
  onDefaultSurplusChange,
}: ProgramTopBarProps) {
  const { assignments } = useSavedPlanAssignments();
  const assignmentCount =
    assignments?.perPlan.find((p) => p.savedPlanId === draft.id)?.count ?? null;

  const trainingCount = draft.weeks.reduce(
    (sum, w) => sum + w.days.filter((d) => !d.isRest).length,
    0,
  );
  // Mockup formula: always one decimal ("1.5 sessions/week").
  const perWeek = (trainingCount / draft.weeks.length).toFixed(1);

  return (
    <div className="mb-4 flex items-center rounded-[6px] bg-[#0f2027] p-5">
      <button
        type="button"
        aria-label="Back to programs"
        className="mr-4 rounded p-1 text-[rgba(255,255,255,0.45)] transition-colors hover:text-white"
        onClick={onBack}
      >
        <ArrowLeft className="h-5 w-5" strokeWidth={1.5} />
      </button>

      <div className="grid min-w-0 flex-1 grid-cols-[2fr_1fr_1fr_1.2fr]">
        {/* Program */}
        <div className="flex min-w-0 flex-col border-r border-[rgba(255,255,255,0.07)] pr-5">
          <span className={CELL_LABEL}>Program</span>
          {mode === "edit" ? (
            <Input
              // Uncontrolled + keyed so reseeding picks up a fresh name; commit
              // on blur (empty falls back rather than violating name min(1)).
              key={`name-${draft.id}`}
              defaultValue={draft.name}
              maxLength={100}
              aria-label="Program name"
              className={cn(
                "mt-1.5 h-auto border-0 bg-transparent p-0 text-[20px] font-bold leading-tight text-white shadow-none placeholder:text-[rgba(255,255,255,0.35)]",
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
            <span className="mt-1.5 truncate text-[20px] font-bold leading-tight text-white">
              {draft.name}
            </span>
          )}
          <span className={cn(CELL_SUB, "flex items-center gap-2")}>
            {perWeek} sessions/week
            {draft.status === "draft" && (
              <Badge
                variant="outline"
                className="border-[rgba(255,255,255,0.2)] px-1.5 py-0 text-[9px] text-[rgba(255,255,255,0.6)]"
              >
                Draft
              </Badge>
            )}
          </span>
        </div>

        {/* Assignments */}
        <div className="flex flex-col border-r border-[rgba(255,255,255,0.07)] px-5">
          <span className={CELL_LABEL}>Assignments</span>
          <span className="mt-1.5 font-mono-display text-[24px] font-bold leading-tight text-white">
            {assignmentCount ?? "—"}
          </span>
          <span className={CELL_SUB}>
            {assignmentCount === 1 ? "active client" : "active clients"}
          </span>
        </div>

        {/* Length */}
        <div className="flex flex-col border-r border-[rgba(255,255,255,0.07)] px-5">
          <span className={CELL_LABEL}>Length</span>
          <div className="mt-1.5 flex items-baseline gap-1">
            <span className="font-mono-display text-[24px] font-bold leading-tight text-white">
              {draft.weeks.length}
            </span>
            <span className="text-[10px] text-[rgba(255,255,255,0.3)]">
              {draft.weeks.length === 1 ? "wk" : "wks"}
            </span>
          </div>
          <span className={CELL_SUB}>
            {trainingCount} {trainingCount === 1 ? "session" : "sessions"}
          </span>
        </div>

        {/* Default surplus */}
        <div className="flex flex-col pl-5">
          <span className={CELL_LABEL}>Default calorie surplus</span>
          <div className="mt-1.5 flex items-center gap-1.5">
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
                "h-7 w-16 border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.06)] px-1.5 text-center font-mono text-xs text-white",
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
            <span className="text-[10px] text-[rgba(255,255,255,0.3)]">%</span>
          </div>
          <span className={CELL_SUB}>used when a session has none</span>
        </div>
      </div>
    </div>
  );
}
