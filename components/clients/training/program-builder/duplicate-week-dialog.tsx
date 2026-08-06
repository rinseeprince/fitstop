"use client";

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/programs/shared/segmented-control";
import { useExerciseCatalog } from "@/hooks/use-exercise-catalog";
import {
  buildScopePredicate,
  exerciseScopeKey,
  type ProgressionRule,
  type ProgressionScope,
} from "@/utils/progression-rules";
import { cn } from "@/lib/utils";
import {
  FOCUS_RING,
  LABEL_CLASS,
  MONO_INPUT_CLASS,
  MONO_LABEL_CLASS,
  TEXT_MUTED,
  TEXT_SECONDARY,
} from "./builder-tokens";
import { cloneWeek, progressWeek } from "./program-builder-model";
import { buildIsCompound, buildPreviewRows } from "./progression-preview-model";
import { ProgressionPreview } from "./progression-preview";
import type { WeekDraft } from "./program-builder-types";

// "Duplicate with progression": clone a week, apply one rule to the clone's
// working sets, preview the result, commit. The engine is pure, so the
// preview recomputes live per control change. Surplus % is deliberately NOT
// part of this feature (exec-plan: reconcile, don't merge) — sessions'
// calorieSurplusPercentage clones through verbatim and no control exists here.
type DuplicateWeekDialogProps = {
  week: WeekDraft; // parent mounts conditionally — never null while open
  canAddWeek: boolean;
  onCommit: (week: WeekDraft) => void;
  onClose: () => void;
};

type RuleKind = "load" | "reps" | "sets";
type ScopeKind = "all" | "compounds" | "selected";

const parseAmount = (raw: string): number | null => {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const clampOnBlur = (raw: string, lo: number, hi: number, int: boolean): string => {
  const n = parseAmount(raw);
  if (n == null) return "";
  return String(Math.min(hi, Math.max(lo, int ? Math.round(n) : n)));
};

const AMOUNT_INPUT_CLASS = cn(MONO_INPUT_CLASS, "h-8 w-20 text-xs", FOCUS_RING);

export function DuplicateWeekDialog({
  week,
  canAddWeek,
  onCommit,
  onClose,
}: DuplicateWeekDialogProps) {
  const { exercises: catalog, isLoading: isCatalogLoading, error: catalogError } =
    useExerciseCatalog();

  const [ruleKind, setRuleKind] = useState<RuleKind>("load");
  const [loadMode, setLoadMode] = useState<"absolute" | "percent">("absolute");
  const [loadAmount, setLoadAmount] = useState("2.5");
  const [repsAmount, setRepsAmount] = useState("1");
  const [setsAmount, setSetsAmount] = useState("1");
  const [scopeKind, setScopeKind] = useState<ScopeKind>("all");

  const allExercises = week.days.flatMap((d) => d.session?.exercises ?? []);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    // "Pick exercises" starts all-checked; toggling works by identity key.
    () => new Set(allExercises.map(exerciseScopeKey)),
  );

  // Clone ONCE per mount: preview and commit share the same fresh-uid week
  // (clone-then-progress — re-cloning after progressing would stale the uids).
  const clone = useMemo(() => cloneWeek(week), [week]);
  const isCompound = useMemo(() => buildIsCompound(catalog), [catalog]);

  const amountRaw =
    ruleKind === "load" ? loadAmount : ruleKind === "reps" ? repsAmount : setsAmount;
  const amount = parseAmount(amountRaw);
  const rule: ProgressionRule | null =
    amount == null || amount === 0
      ? null
      : ruleKind === "load"
        ? { kind: "load", mode: loadMode, amount }
        : { kind: ruleKind, amount };

  const scope: ProgressionScope =
    scopeKind === "selected" ? { kind: "selected", keys: selectedKeys } : { kind: scopeKind };
  const result = rule
    ? progressWeek(clone, rule, buildScopePredicate(scope, isCompound))
    : null;
  const changedCount = result?.changedExerciseUids.size ?? 0;
  // With no effective rule the preview still renders (all "No change") — the
  // formatter only needs the rule KIND to pick which field to show.
  const displayRule: ProgressionRule =
    rule ??
    (ruleKind === "load"
      ? { kind: "load", mode: loadMode, amount: 0 }
      : { kind: ruleKind, amount: 0 });
  const previewDays = buildPreviewRows(
    week,
    result?.week ?? clone,
    result?.changedExerciseUids ?? new Set(),
    displayRule,
  );

  const compoundsDisabled = isCatalogLoading || catalogError != null || catalog.length === 0;
  const allRest = week.days.every((d) => !d.session);
  const hasExercises = allExercises.length > 0;

  const toggleKey = (key: string) =>
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // No-change degradation: committing without an effective rule is an exact
  // copy — result.week === clone when nothing changed, so this stays correct.
  const handleCommit = () => onCommit(result?.week ?? clone);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Duplicate Week {week.weekIndex + 1}</DialogTitle>
          <DialogDescription>
            Adds a copy of this week right after it. Pick how the new week should
            progress — this week and everything before it stay exactly as they are.
          </DialogDescription>
        </DialogHeader>

        {hasExercises ? (
          <div className="space-y-4 py-1">
            <div className="flex flex-col gap-1.5">
              <span className={LABEL_CLASS}>Progression</span>
              <SegmentedControl
                options={[
                  { value: "load", label: "Load" },
                  { value: "reps", label: "Reps" },
                  { value: "sets", label: "Sets" },
                ]}
                value={ruleKind}
                onChange={(v) => setRuleKind(v as RuleKind)}
              />
            </div>

            <div className="flex items-end gap-3">
              {ruleKind === "load" && (
                <>
                  <label className={cn("flex flex-col gap-1", LABEL_CLASS)}>
                    Load change per working set
                    <Input
                      type="number"
                      step={0.5}
                      value={loadAmount}
                      onChange={(e) => setLoadAmount(e.target.value)}
                      onBlur={(e) => setLoadAmount(clampOnBlur(e.target.value, -100, 100, false))}
                      className={AMOUNT_INPUT_CLASS}
                    />
                  </label>
                  <SegmentedControl
                    options={[
                      { value: "absolute", label: "kg" },
                      { value: "percent", label: "%" },
                    ]}
                    value={loadMode}
                    onChange={(v) => setLoadMode(v as "absolute" | "percent")}
                  />
                  <span className={cn("pb-2 text-[10px]", TEXT_MUTED)}>
                    Use a negative number for a deload.
                  </span>
                </>
              )}
              {ruleKind === "reps" && (
                <>
                  <label className={cn("flex flex-col gap-1", LABEL_CLASS)}>
                    Reps change per working set
                    <Input
                      type="number"
                      step={1}
                      value={repsAmount}
                      onChange={(e) => setRepsAmount(e.target.value)}
                      onBlur={(e) => setRepsAmount(clampOnBlur(e.target.value, -5, 5, true))}
                      className={AMOUNT_INPUT_CLASS}
                    />
                  </label>
                  <span className={cn("pb-2 text-[10px]", TEXT_MUTED)}>
                    Use a negative number for a deload.
                  </span>
                </>
              )}
              {ruleKind === "sets" && (
                <>
                  <label className={cn("flex flex-col gap-1", LABEL_CLASS)}>
                    Sets to add or remove
                    <Input
                      type="number"
                      step={1}
                      value={setsAmount}
                      onChange={(e) => setSetsAmount(e.target.value)}
                      onBlur={(e) => setSetsAmount(clampOnBlur(e.target.value, -5, 5, true))}
                      className={AMOUNT_INPUT_CLASS}
                    />
                  </label>
                  <span className={cn("pb-2 text-[10px]", TEXT_MUTED)}>
                    Negative removes working sets from the end — every exercise
                    keeps its first working set.
                  </span>
                </>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <span className={LABEL_CLASS}>Apply to</span>
              <SegmentedControl
                options={[
                  { value: "all", label: "All exercises" },
                  {
                    value: "compounds",
                    label: "Compounds only",
                    disabled: compoundsDisabled,
                    title: isCatalogLoading
                      ? "Loading your exercise list…"
                      : compoundsDisabled
                        ? "Your exercise list couldn't load, so compound lifts can't be detected."
                        : undefined,
                  },
                  { value: "selected", label: "Pick exercises" },
                ]}
                value={scopeKind}
                onChange={(v) => setScopeKind(v as ScopeKind)}
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className={LABEL_CLASS}>New week preview</span>
                <span className={MONO_LABEL_CLASS}>
                  {changedCount} of {allExercises.length}{" "}
                  {allExercises.length === 1 ? "exercise" : "exercises"} change
                </span>
              </div>
              <ProgressionPreview
                days={previewDays}
                showCheckboxes={scopeKind === "selected"}
                selectedKeys={selectedKeys}
                onToggleKey={toggleKey}
              />
              <p className={cn("mt-1.5 text-[10px]", TEXT_MUTED)}>
                Working sets only — warm-ups, special sets (AMRAP, drop, failure),
                session notes, and calorie surplus copy over unchanged.
              </p>
            </div>

            {changedCount === 0 && (
              <p className={cn("text-xs", TEXT_SECONDARY)}>
                This doesn&apos;t change anything — you&apos;ll get an exact copy.
              </p>
            )}
          </div>
        ) : (
          <p className={cn("py-2 text-sm", TEXT_SECONDARY)}>
            {allRest
              ? "This week is all rest days — the copy will match it exactly."
              : "No exercises in this week yet — you'll get an exact copy."}
          </p>
        )}

        {!canAddWeek && (
          <p className={cn("text-xs", TEXT_SECONDARY)}>
            This program is at its 52-week limit.
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleCommit}
            disabled={!canAddWeek}
            className="bg-[#0d9488] text-white hover:bg-[#0b7f75]"
          >
            Duplicate week
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
