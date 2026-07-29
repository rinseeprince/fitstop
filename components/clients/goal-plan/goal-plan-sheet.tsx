"use client";

import { Loader2, Plus, Target } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { SegmentedControl } from "@/components/programs/shared/segmented-control";
import { InlineMono } from "@/components/clients/overview/overview-primitives";
import { formatDateOnlyShort } from "@/components/clients/overview/overview-format";
import { getTodayDateStringInTimezone } from "@/lib/date-helpers";
import { chainPhases, isPhaseElapsed } from "@/lib/goals/phase-chain";
import {
  FOCUS_RING,
  LABEL_CLASS,
  MONO,
  MONO_INPUT_CLASS,
  MONO_LABEL_CLASS,
  THUMB_CLASS,
} from "@/components/clients/training/program-builder/builder-tokens";
import { BlockRow } from "./block-row";
import { parseBlockRows, type WeightUnit } from "./goal-plan-model";
import { useGoalPlanForm } from "./use-goal-plan-form";
import type { Client } from "@/types/check-in";
import type { ClientGoal } from "@/types/client-goals";
import type { ClientPhase } from "@/services/client-phases-service";

const FIELD = "h-8 text-[13px]";

type GoalPlanSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: Client;
  goal: ClientGoal | null;
  phases: ClientPhase[];
  /**
   * The SAVED custom-macros flag, never the live generation-mode tab. REQUIRED so
   * a second mount cannot default it away: while it is on, the calculator never
   * runs and blocks drive nothing, and every enforcement point for that is
   * backend — so without this line the failure is displaced to a screen that
   * offers no explanation.
   */
  customMacrosEnabled: boolean;
  /** Revalidates the caller's own reads after a save. */
  onSaved: () => void;
};

/**
 * The coach's "Goal & plan" panel: the client's destination, and optionally the
 * route of named blocks that gets them there.
 *
 * **Two independent writes** (invariant 7). The goal goes to the goals PUT and
 * only when a goal field actually changed; the blocks go to the phases PUT. A
 * block rename must never mint a goal version, which is why this is not one form
 * submitting one body.
 *
 * The live readout renders from `chainPhases` / `projectPlan` — the SAME
 * functions the server writes with — so the coach's preview and the stored chain
 * cannot disagree about where a block lands.
 */
export function GoalPlanSheet({
  open,
  onOpenChange,
  client,
  goal,
  phases,
  customMacrosEnabled,
  onSaved,
}: GoalPlanSheetProps) {
  const unit: WeightUnit = client.weightUnit ?? "lbs";
  const clientToday = getTodayDateStringInTimezone(client.timezone);

  const {
    form,
    blocks,
    addBlock,
    seeded,
    mode,
    setMode,
    rateInput,
    applyRate,
    derivedRate,
    projection,
    isSaving,
    hasOutstandingWrites,
    save,
  } = useGoalPlanForm({
    clientId: client.id,
    goal,
    phases,
    unit,
    clientToday,
    currentWeight: client.currentWeight,
    open,
    onSaved: () => {
      onSaved();
      onOpenChange(false);
    },
  });

  const values = form.watch();
  const rows = parseBlockRows(values.blocks);
  const chained = chainPhases(values.startDate || clientToday, rows);
  const anyElapsed = chained.some((c) => isPhaseElapsed(c, clientToday));
  const readOnlyRoute = !seeded.conforming;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!isSaving) onOpenChange(next);
      }}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 bg-white p-0 sm:w-[780px] sm:max-w-full"
      >
        <SheetHeader className="flex-row items-center gap-3 space-y-0 border-b border-[rgba(13,148,136,0.08)] px-5 py-3.5">
          <span className={cn(THUMB_CLASS, "h-8 w-8")}>
            <Target className="h-4 w-4" strokeWidth={1.5} />
          </span>
          <div className="min-w-0">
            <SheetTitle className="text-[15px] font-semibold tracking-[-0.01em] text-[#0c1a1e]">
              Goal &amp; plan
            </SheetTitle>
            <SheetDescription className={cn(MONO_LABEL_CLASS, "normal-case tracking-normal")}>
              {client.name}
            </SheetDescription>
          </div>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
          {/* ---------------- Destination ---------------- */}
          <SectionLabel label="Destination" />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="gp-start">Plan starts</Label>
              <Input
                id="gp-start"
                type="date"
                disabled={anyElapsed}
                {...form.register("startDate")}
                className={cn(FOCUS_RING, FIELD)}
              />
              {anyElapsed && (
                <p className="text-[11px] text-[#93b0b4]">
                  Locked — a block has already finished.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gp-weight">Target weight</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="gp-weight"
                  inputMode="decimal"
                  placeholder="Maintenance"
                  {...form.register("goalWeight")}
                  className={cn(MONO_INPUT_CLASS, FOCUS_RING, FIELD, "flex-1")}
                />
                <span className={cn(MONO, "text-[12px] text-[#93b0b4]")}>{unit}</span>
              </div>
              {form.formState.errors.goalWeight && (
                <p className="text-[11px] text-[#c06060]">
                  {form.formState.errors.goalWeight.message}
                </p>
              )}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="gp-bodyfat">Target body fat</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="gp-bodyfat"
                  inputMode="decimal"
                  placeholder="Not set"
                  {...form.register("goalBodyFat")}
                  className={cn(MONO_INPUT_CLASS, FOCUS_RING, FIELD, "flex-1")}
                />
                <span className={cn(MONO, "text-[12px] text-[#93b0b4]")}>%</span>
              </div>
              {form.formState.errors.goalBodyFat && (
                <p className="text-[11px] text-[#c06060]">
                  {form.formState.errors.goalBodyFat.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <span className={LABEL_CLASS}>Pace</span>
              <SegmentedControl
                fullWidth
                options={[
                  { value: "deadline", label: "By date" },
                  { value: "rate", label: "By rate" },
                ]}
                value={mode}
                onChange={(v) => setMode(v as typeof mode)}
              />
            </div>
          </div>

          <div className="mt-3 space-y-1.5">
            {mode === "deadline" ? (
              <>
                <Label htmlFor="gp-deadline">Target date</Label>
                <Input
                  id="gp-deadline"
                  type="date"
                  {...form.register("deadline")}
                  className={cn(FOCUS_RING, FIELD, "w-[200px]")}
                />
                <p className={cn(MONO_LABEL_CLASS, "normal-case tracking-normal")}>
                  {derivedRate != null
                    ? `${derivedRate} ${unit}/wk to get there`
                    : "—"}
                </p>
              </>
            ) : (
              <>
                <Label htmlFor="gp-rate">Rate</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="gp-rate"
                    inputMode="decimal"
                    placeholder="-0.5"
                    value={rateInput}
                    onChange={(e) => applyRate(e.target.value)}
                    className={cn(MONO_INPUT_CLASS, FOCUS_RING, FIELD, "w-[120px]")}
                  />
                  <span className={cn(MONO, "text-[12px] text-[#93b0b4]")}>{unit}/wk</span>
                </div>
                <p className={cn(MONO_LABEL_CLASS, "normal-case tracking-normal")}>
                  {values.deadline
                    ? `Arrives ${formatDateOnlyShort(values.deadline)}`
                    : "—"}
                </p>
              </>
            )}
          </div>

          {/* ---------------- Route ---------------- */}
          <div className="mt-6">
            <SectionLabel
              label="Route"
              meta={rows.length > 0 ? `${rows.length} blocks` : undefined}
            />
          </div>

          {customMacrosEnabled && (
            <p className="mb-3 rounded-[6px] border border-[rgba(245,158,11,0.2)] bg-[rgba(245,158,11,0.07)] px-3 py-2 text-xs text-[#d97706]">
              Custom macros are on, so these blocks are not driving this client&apos;s
              nutrition. The numbers you typed on the nutrition plan are.
            </p>
          )}

          {readOnlyRoute ? (
            <p className="text-xs text-[#5a7d82]">
              These blocks were not created here and their dates cannot be rebuilt from
              lengths, so they are read-only. Editing them would silently move them.
            </p>
          ) : (
            <>
              {blocks.fields.length === 0 ? (
                <p className="text-xs text-[#5a7d82]">
                  No blocks. The client follows one steady rate for the whole plan — add
                  blocks to break it into named stretches.
                </p>
              ) : (
                <div className="space-y-1">
                  <div className="grid grid-cols-[1fr_72px_96px_28px] gap-2 px-2">
                    <span className={LABEL_CLASS}>Block</span>
                    <span className={LABEL_CLASS}>Weeks</span>
                    <span className={LABEL_CLASS}>{unit}/wk</span>
                    <span />
                  </div>
                  {blocks.fields.map((field, index) => (
                    <BlockRow
                      key={field.id}
                      index={index}
                      form={form}
                      unit={unit}
                      startsOn={chained[index]?.startsOn ?? clientToday}
                      endsOn={chained[index]?.endsOn ?? clientToday}
                      elapsed={
                        chained[index] != null &&
                        isPhaseElapsed(chained[index], clientToday)
                      }
                      onRemove={
                        // Only an unsaved row. Removing a persisted one re-chains
                        // the plan and needs Task 3.2's confirm.
                        values.blocks[index]?.id ? undefined : () => blocks.remove(index)
                      }
                    />
                  ))}
                </div>
              )}

              {blocks.fields.length < 12 && (
                <button
                  type="button"
                  onClick={addBlock}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-[6px] border border-dashed border-[rgba(13,148,136,0.25)] py-2 text-xs font-medium text-[#5a7d82] transition-colors hover:border-[#0d9488] hover:bg-[rgba(13,148,136,0.05)] hover:text-[#0a5c55]"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                  Add block
                </button>
              )}

              {typeof form.formState.errors.blocks?.message === "string" && (
                <p className="mt-2 text-[11px] text-[#c06060]">
                  {form.formState.errors.blocks.message}
                </p>
              )}
            </>
          )}

          {/* The live readout. Information, never a blocker — a deliberately
              conservative plan is a legitimate coaching call. */}
          {projection && (
            <div className="mt-4 rounded-[6px] border border-[rgba(13,148,136,0.08)] bg-[rgba(13,148,136,0.05)] px-3 py-2">
              <p className={cn(MONO_LABEL_CLASS, "normal-case tracking-normal")}>
                {projection.totalWeeks} weeks · {formatDateOnlyShort(projection.startsOn)} –{" "}
                {formatDateOnlyShort(projection.endsOn)}
                {projection.projectedWeight != null &&
                  ` · projects ${projection.projectedWeight} ${unit}`}
              </p>
              {projection.verdict && (
                <p className="mt-0.5 text-xs text-[#5a7d82]">
                  {projection.verdict.kind === "reached" ? (
                    "On track for the target."
                  ) : projection.verdict.kind === "short" ? (
                    <>
                      Falls short by
                      <InlineMono>
                        {projection.verdict.amount.toFixed(1)} {unit}
                      </InlineMono>
                      .
                    </>
                  ) : (
                    <>
                      Overshoots by
                      <InlineMono>
                        {projection.verdict.amount.toFixed(1)} {unit}
                      </InlineMono>
                      .
                    </>
                  )}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[rgba(13,148,136,0.08)] px-5 py-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            className="bg-[#0d9488] text-white hover:bg-[#0b7f75]"
            onClick={() => void save()}
            // Enabled on OUTSTANDING WRITES, not on isDirty: a pristine form whose
            // goal column disagrees with its blocks has a real write to retry
            // (the self-heal), and isDirty would disable exactly that save.
            disabled={isSaving || !hasOutstandingWrites}
          >
            {isSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
