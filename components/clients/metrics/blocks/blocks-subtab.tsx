"use client";

import { useMemo, useState } from "react";
import { useDialogSubject } from "@/hooks/use-dialog-subject";
import { useJourneyFocusBlock } from "@/hooks/use-journey-focus-block";
import {
  Archive,
  ArchiveRestore,
  Flag,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  journeyPlanTripParams,
  journeyTripParams,
  type ClientTab,
} from "@/lib/client-tabs";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { Skeleton } from "@/components/ui/skeleton";
import { FOCUS_RING } from "@/components/clients/training/program-builder/builder-tokens";
import { toast } from "sonner";
import type { ClientBlockView } from "@/lib/blocks/block-derivations";
import {
  deleteBlockRequest,
  deletePlanRequest,
  patchBlockArchived,
  putBlockChain,
  useBlockFacts,
  useClientBlocks,
  useClearBlockFacts,
  useInvalidateClientBlocks,
  useSeedClientBlocks,
} from "../hooks/use-client-blocks";
import type { ReplaceBlockChainInput } from "@/types/client-blocks";
import { useInvalidateTrainingData } from "@/hooks/use-calendar-events";
import { useInvalidateNutritionCalendar } from "@/hooks/use-nutrition-calendar-events";
import { useClearClientOverview } from "@/hooks/use-client-overview";
import { useClearAttentionFeed } from "@/hooks/use-attention-feed";
import { blockColor } from "./block-colors";
import { BlockCard } from "./block-card";
import { BlockForm, type BlockFormValues } from "./block-form";
import { buildAppendPayload, buildEditPayload } from "./block-chain-payload";
import { BlockTrimDialog, type BlockTrimQuestion } from "./block-trim-dialog";
import { DeleteBlockDialog } from "./delete-block-dialog";
import { DeletePlanDialog } from "./delete-plan-dialog";
import type { BlockPlanDeleteTarget } from "./block-timeline";

// The Journey tab's Blocks pane: the chain (decorated server-side in the
// CLIENT's timezone — state is never re-derived here) + per-block facts.
// Add, edit and delete all mount here.

/** A save the server answered with its trims: the question, and the payload
 *  the coach's yes re-sends unchanged. */
type PendingTrimSave = BlockTrimQuestion & { payload: ReplaceBlockChainInput };

/** The per-plan delete's outcome, in the dialog's own verb. */
function planDeleteOutcome(plan: BlockPlanDeleteTarget): string {
  const verb = plan.state === "active" ? "ended" : "removed";
  return plan.track === "training" ? `"${plan.name}" ${verb}` : `Targets ${verb}`;
}

const ROW_ICON_BUTTON =
  "rounded p-1 text-[#93b0b4] opacity-0 transition-colors focus-visible:opacity-100 group-hover/row:opacity-100";

type BlocksSubtabProps = {
  clientId: string;
  /** The round trip out of a fact, unset or set (7.3/7.4, H): "place one" and
   *  "update plan" open the program list, "edit plan" the plan editor on the
   *  plan it heads, "set targets" / "update targets" the targets drawer.
   *  Cross-tab navigation runs through the client page's handler — the one
   *  builder of a tab URL, which pushes the tab change. Absent = the empty
   *  states stay plain text and the set states carry no action. */
  onTabChange?: (tab: ClientTab, extraParams?: Record<string, string>) => void;
};

export function BlocksSubtab({
  clientId,
  onTabChange,
}: BlocksSubtabProps) {
  const { blocks, clientToday, isLoading, isError } = useClientBlocks(clientId);
  // The return trip lands on ?block=<id> and it WINS over the default (the
  // current block): the coach came back to the one they were setting up. The
  // hook consumes the one-shot and strips it.
  const focusBlockId = useJourneyFocusBlock();
  const {
    facts,
    isLoading: factsLoading,
    isError: factsError,
  } = useBlockFacts(clientId);
  const invalidateBlocks = useInvalidateClientBlocks();
  // Every write returns the chain it just produced. Seeding it lands the new
  // list and the closing form in ONE render, which is the only way the frame
  // between them disappears rather than swapping which stale state shows.
  const seedBlocks = useSeedClientBlocks();
  // The facts are derived from the calendars, so anything that rewrites those
  // makes them wrong — and they render a definite answer, so a stale entry
  // states something false rather than merely being late.
  const clearBlockFacts = useClearBlockFacts();
  // A save that trims plans, and every delete, rewrite training_events and move
  // the nutrition versions' ends, which the computed nutrition month view is
  // priced from, so this screen owes both calendar areas their invalidator as
  // well as its own.
  const invalidateTrainingData = useInvalidateTrainingData();
  const invalidateNutritionCalendar = useInvalidateNutritionCalendar();
  const clearClientOverview = useClearClientOverview();
  const clearAttentionFeed = useClearAttentionFeed();
  const [showAddForm, setShowAddForm] = useState(false);
  // Coach-curated views (Session 3.7): "journey" = everything unarchived —
  // a live program's finished phases included; "archive" = what the coach
  // has filed away. A pure render filter: the chain contracts (echo, shift
  // math, add-form anchor) always operate on the FULL chain.
  const [view, setView] = useState<"journey" | "archive">("journey");
  const [editingId, setEditingId] = useState<string | null>(null);
  // Each confirm's subject outlives its close: Radix re-renders a closing card
  // from live state, so the fading card still names what it named (CONVENTIONS
  // §7 → "No frame disagrees").
  const blockDeleteDialog = useDialogSubject<ClientBlockView>();
  const [isDeletingBlock, setIsDeletingBlock] = useState(false);
  // The one question a save that trims plans raises, over the open form.
  const trimDialog = useDialogSubject<PendingTrimSave>();
  const [isTrimming, setIsTrimming] = useState(false);
  // The per-plan delete (C3): the timeline row the coach picked, behind the
  // destructive confirm.
  const planDeleteDialog = useDialogSubject<BlockPlanDeleteTarget>();
  const [isDeletingPlan, setIsDeletingPlan] = useState(false);

  // A success closes a confirm with its in-flight flag still set, so the card
  // fades out on the frame it closed on; the next open clears the flag in the
  // same update that shows the new subject.
  const openBlockDelete = (block: ClientBlockView) => {
    setIsDeletingBlock(false);
    blockDeleteDialog.show(block);
  };
  const openTrimQuestion = (pending: PendingTrimSave) => {
    setIsTrimming(false);
    trimDialog.show(pending);
  };
  const openPlanDelete = (plan: BlockPlanDeleteTarget) => {
    setIsDeletingPlan(false);
    planDeleteDialog.show(plan);
  };

  const factsById = useMemo(
    () => new Map(facts.map((fact) => [fact.blockId, fact])),
    [facts]
  );

  /** A save landed: the add form or the edit form closes with it. */
  const closeForm = (kind: BlockTrimQuestion["kind"]) => {
    if (kind === "add") setShowAddForm(false);
    else setEditingId(null);
  };

  /**
   * The coach's yes: the same save, re-sent with `confirmTrims`. The server
   * trims the plans, then writes the block, and answers with the chain — which
   * is seeded in the same tick the form and the question close, so the list
   * never shows under a closed form without the block.
   */
  const confirmTrims = async () => {
    const pending = trimDialog.subject;
    if (!pending) return;
    setIsTrimming(true);
    try {
      const result = await putBlockChain(clientId, {
        ...pending.payload,
        confirmTrims: true,
      });
      if ("trims" in result) {
        openTrimQuestion({ ...pending, trims: result.trims });
        return;
      }
      void seedBlocks(clientId, result.saved);
      closeForm(pending.kind);
      // `isTrimming` stays set: the next open clears it (openTrimQuestion).
      trimDialog.close();
      toast.success(
        `"${pending.blockName}" ${pending.kind === "add" ? "added" : "updated"}`,
        { description: "The plans were trimmed to fit." }
      );
    } catch (error) {
      // The question stays OPEN: it is the retry. The trims land before the
      // block does, and a trimmed plan already fits, so the same save re-sent
      // finishes whatever failed.
      toast.error("Save failed", {
        description: error instanceof Error ? error.message : "Could not save the block",
      });
      setIsTrimming(false);
    } finally {
      // Trims may have landed on either path: the calendars, the facts, the
      // Overview and the feed are all derived from the plans they moved
      // (CONVENTIONS §7).
      void invalidateBlocks(clientId);
      void invalidateTrainingData(clientId);
      void invalidateNutritionCalendar(clientId);
      void clearBlockFacts(clientId);
      void clearClientOverview(clientId);
      void clearAttentionFeed();
    }
  };

  /**
   * Delete a block and its plans: the running plan on each track ends
   * yesterday, a queued one is removed, then the row goes.
   */
  const handleDeleteConfirm = async (block: ClientBlockView) => {
    setIsDeletingBlock(true);
    try {
      const remaining = await deleteBlockRequest(clientId, block.id);
      // Same reason as the add: the dialog closing against a stale list shows
      // the deleted row for a frame, and deleting the LAST block shows it and
      // then the empty state.
      void seedBlocks(clientId, remaining);
      // `isDeletingBlock` stays set: the open clears it (openBlockDelete).
      blockDeleteDialog.close();
      // The plans went with it, from both calendars, so both areas are owed
      // their invalidator or the Training and Nutrition tabs keep showing days
      // that are gone (CONVENTIONS §7).
      void invalidateTrainingData(clientId);
      void invalidateNutritionCalendar(clientId);
      void clearBlockFacts(clientId);
      toast.success(`"${block.name}" deleted`);
      void invalidateBlocks(clientId);
      void clearClientOverview(clientId);
      void clearAttentionFeed();
    } catch (error) {
      toast.error("Delete failed", {
        description: error instanceof Error ? error.message : "Could not delete the block",
      });
      // The card stays open as the retry, so its buttons come back now.
      setIsDeletingBlock(false);
    }
  };

  /**
   * End or remove ONE plan from a block card's timeline — the training
   * per-plan DELETE or the nutrition per-version DELETE, each ending a running
   * plan at yesterday and removing a queued one. Deleting a plan never touches
   * another, and nothing regrows: a queued plan's dates go empty and the coach
   * fills them from the card or the calendar.
   */
  const handleDeletePlanConfirm = async (plan: BlockPlanDeleteTarget) => {
    setIsDeletingPlan(true);
    try {
      await deletePlanRequest(clientId, plan.track, plan.id);
      // `isDeletingPlan` stays set: the open clears it (openPlanDelete).
      planDeleteDialog.close();
      // The delete rewrote a calendar — the upcoming sessions, or a version's
      // window the nutrition days are computed from — so both calendar areas
      // are owed their invalidator, and the facts, the Overview and the feed
      // are derived from the plan tables (CONVENTIONS §7).
      void invalidateTrainingData(clientId);
      void invalidateNutritionCalendar(clientId);
      void clearBlockFacts(clientId);
      void clearClientOverview(clientId);
      void clearAttentionFeed();
      toast.success(planDeleteOutcome(plan));
    } catch (error) {
      toast.error("Delete failed", {
        description:
          error instanceof Error
            ? error.message
            : plan.track === "training"
              ? "Could not delete the plan"
              : "Could not delete the targets",
      });
      // The card stays open as the retry, so its buttons come back now.
      setIsDeletingPlan(false);
    }
  };

  /**
   * Every add and edit is one chain PUT. A save that draws or shortens a block
   * over days holding a plan comes back with its trims instead — nothing is
   * stored — and the question opens over the form, which keeps its values.
   */
  const saveChain = async (
    question: Omit<BlockTrimQuestion, "trims">,
    buildPayload: () => ReplaceBlockChainInput
  ) => {
    try {
      const payload = buildPayload();
      const result = await putBlockChain(clientId, payload);
      if ("trims" in result) {
        openTrimQuestion({ ...question, trims: result.trims, payload });
        return;
      }
      // Seed + close in the same tick: React batches them, so the coach goes
      // from form to list with nothing in between. The empty state is gated on
      // `blocks.length === 0` and the forms on their own state, so ANY frame
      // where only one of the two has changed shows something wrong.
      void seedBlocks(clientId, result.saved);
      closeForm(question.kind);
      toast.success(`"${question.blockName}" ${question.kind === "add" ? "added" : "updated"}`);
      void invalidateBlocks(clientId);
      void clearClientOverview(clientId);
      void clearAttentionFeed();
    } catch (error) {
      toast.error("Save failed", {
        description: error instanceof Error ? error.message : "Could not save the block",
      });
    }
  };

  const handleAdd = (values: BlockFormValues) =>
    saveChain({ kind: "add", blockName: values.name }, () =>
      buildAppendPayload(blocks, {
        name: values.name,
        // Add mode always requires both dates — a block owns its own window.
        startsOn: values.startsOn as string,
        endsOn: values.endsOn as string,
        focus: values.focus,
      })
    );

  // A drawn block's start is fixed and its end never moves later (the form
  // caps its Ends field at the stored end, and the chain PUT refuses both), so
  // an edit is a rename, a new focus, or a shorter end.
  const handleEdit = (block: ClientBlockView, values: BlockFormValues) =>
    saveChain({ kind: "save", blockName: values.name }, () =>
      buildEditPayload(blocks, block.id, {
        name: values.name,
        focus: values.focus,
        endsOn: values.endsOn,
      }).payload
    );

  const handleArchive = async (block: ClientBlockView, archived: boolean) => {
    try {
      const updated = await patchBlockArchived(clientId, block.id, archived);
      // An archive moves the row between two filtered views, so a stale list
      // leaves it in the one it just left.
      void seedBlocks(clientId, updated);
      void invalidateBlocks(clientId);
      void clearClientOverview(clientId);
      void clearAttentionFeed();
      toast.success(archived ? `"${block.name}" archived` : `"${block.name}" restored`);
    } catch (error) {
      toast.error(archived ? "Archive failed" : "Restore failed", {
        description: error instanceof Error ? error.message : "Could not update the block",
      });
    }
  };

  // The rail meta describes the JOURNEY: archived phases belong to closed
  // eras and count for nothing here; the archive view carries no meta at all.
  const unarchived = blocks.filter((block) => block.archivedAt == null);
  const journeyWeeks = unarchived.reduce((sum, block) => sum + block.weeks, 0);
  const meta =
    view === "journey" && unarchived.length > 0
      ? `${unarchived.length} ${unarchived.length === 1 ? "block" : "blocks"} · ${journeyWeeks} weeks`
      : undefined;

  // Colour by FULL-chain position, then filter — archiving a block must
  // never repaint the survivors (colour follows the entity, not its rank).
  const entries = useMemo(
    () => blocks.map((block, index) => ({ block, color: blockColor(index) })),
    [blocks]
  );
  const archivedCount = blocks.filter((block) => block.archivedAt != null).length;
  const visibleEntries = entries.filter((entry) =>
    view === "archive"
      ? entry.block.archivedAt != null
      : entry.block.archivedAt == null
  );

  const addForm = (
    <BlockForm
      mode={{
        kind: "add",
        appendAfterEndsOn: blocks[blocks.length - 1]?.endsOn ?? null,
      }}
      minStart={clientToday}
      onSubmit={handleAdd}
      onCancel={() => setShowAddForm(false)}
    />
  );

  return (
    <div>
      <SectionLabel
        label="Blocks"
        meta={meta}
        actions={
          !isLoading && !isError ? (
            <div className="flex items-center gap-1">
              {view === "journey" && (
                <button
                  type="button"
                  aria-label="Add a block"
                  title="Add a block"
                  onClick={() => setShowAddForm((prev) => !prev)}
                  className="rounded p-1 text-[#93b0b4] transition-colors hover:text-[#0d9488]"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              )}
              {blocks.length > 0 &&
                // Icon toggle (owner-directed over the earlier dropdown):
                // Archive opens the archive; the pane's journey mark (Flag,
                // the empty state's icon) leads back. Count rides the title.
                (view === "journey" ? (
                  <button
                    type="button"
                    aria-label="View archive"
                    title={`View archive (${archivedCount})`}
                    onClick={() => setView("archive")}
                    className={cn(
                      "rounded p-1 text-[#93b0b4] transition-colors hover:text-[#0d9488]",
                      FOCUS_RING
                    )}
                  >
                    <Archive className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label="Back to journey"
                    title="Back to journey"
                    onClick={() => setView("journey")}
                    className={cn(
                      "rounded p-1 text-[#93b0b4] transition-colors hover:text-[#0d9488]",
                      FOCUS_RING
                    )}
                  >
                    <Flag className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                ))}
            </div>
          ) : undefined
        }
      />

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-[42px] w-full rounded-[6px]" />
          <Skeleton className="h-[42px] w-full rounded-[6px]" />
        </div>
      ) : isError ? (
        <p className="py-12 text-center text-[13px] text-[#93b0b4]">
          Failed to load blocks.
        </p>
      ) : blocks.length === 0 ? (
        showAddForm ? (
          addForm
        ) : (
          <div className="rounded-[6px] bg-white px-5 py-12 text-center">
            <Flag
              className="mx-auto h-8 w-8 text-[#93b0b4] opacity-50"
              strokeWidth={1.5}
            />
            <p className="mt-2 text-sm text-[#5a7d82]">No blocks yet</p>
            <p className="mt-1 text-xs text-[#93b0b4]">
              Blocks are named stretches of this client&apos;s journey — a cut,
              a build, a deload — with the training and nutrition of each.
            </p>
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-[6px] bg-[#0d9488] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#0b7f75]"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
              Add a block
            </button>
          </div>
        )
      ) : (
        <div className="space-y-2">
          {visibleEntries.length === 0 && (
            <p className="py-8 text-center text-[13px] text-[#93b0b4]">
              {view === "archive"
                ? "Nothing archived yet."
                : "All blocks are archived."}
            </p>
          )}
          {visibleEntries.map(({ block, color }) => {
            if (block.id === editingId) {
              return (
                <BlockForm
                  key={`edit-${block.id}`}
                  mode={{
                    kind: "edit",
                    block,
                    minEnd: block.state === "current" ? clientToday : null,
                  }}
                  minStart={clientToday}
                  onSubmit={(values) => handleEdit(block, values)}
                  onCancel={() => setEditingId(null)}
                />
              );
            }
            return (
              <BlockCard
                key={block.id}
                block={block}
                color={color}
                facts={factsById.get(block.id)}
                factsLoading={factsLoading}
                factsError={factsError}
                defaultOpen={
                  focusBlockId ? block.id === focusBlockId : block.state === "current"
                }
                onPlaceProgram={
                  onTabChange
                    ? () =>
                        onTabChange("training", {
                          training: "plans",
                          ...journeyTripParams("apply", block.id),
                        })
                    : undefined
                }
                onEditPlan={
                  onTabChange
                    ? (planId) =>
                        onTabChange("training", {
                          training: "plans",
                          ...journeyPlanTripParams(planId, block.id),
                        })
                    : undefined
                }
                onSetNutrition={
                  onTabChange
                    ? () =>
                        onTabChange("nutrition", {
                          nutrition: "plans",
                          ...journeyTripParams("edit", block.id),
                        })
                    : undefined
                }
                onDeletePlan={openPlanDelete}
                rowAction={
                  <>
                    <button
                      type="button"
                      aria-label={`Edit ${block.name}`}
                      title="Edit block"
                      onClick={() => setEditingId(block.id)}
                      className={cn(ROW_ICON_BUTTON, "hover:text-[#0d9488]", FOCUS_RING)}
                    >
                      <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                    {view === "archive" ? (
                      <button
                        type="button"
                        aria-label={`Restore ${block.name}`}
                        title="Restore to journey"
                        onClick={() => void handleArchive(block, false)}
                        className={cn(ROW_ICON_BUTTON, "mr-2 hover:text-[#0d9488]", FOCUS_RING)}
                      >
                        <ArchiveRestore className="h-3.5 w-3.5" strokeWidth={1.5} />
                      </button>
                    ) : block.state === "past" ? (
                      <button
                        type="button"
                        aria-label={`Archive ${block.name}`}
                        title="Archive block"
                        onClick={() => void handleArchive(block, true)}
                        className={cn(ROW_ICON_BUTTON, "mr-2 hover:text-[#0d9488]", FOCUS_RING)}
                      >
                        <Archive className="h-3.5 w-3.5" strokeWidth={1.5} />
                      </button>
                    ) : (
                      // Destructive rightmost, per the rail order rule.
                      <button
                        type="button"
                        aria-label={`Delete ${block.name}`}
                        title="Delete block"
                        onClick={() => openBlockDelete(block)}
                        className={cn(ROW_ICON_BUTTON, "mr-2 hover:text-[#c06060]", FOCUS_RING)}
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                      </button>
                    )}
                  </>
                }
              />
            );
          })}
          {/* Appends at the chain's end, so the form sits where the block will. */}
          {view === "journey" && showAddForm && addForm}
        </div>
      )}

      <BlockTrimDialog
        open={trimDialog.open}
        question={trimDialog.subject}
        isSaving={isTrimming}
        onCancel={trimDialog.close}
        onConfirm={() => void confirmTrims()}
      />

      <DeleteBlockDialog
        open={blockDeleteDialog.open}
        block={blockDeleteDialog.subject}
        isDeleting={isDeletingBlock}
        onCancel={blockDeleteDialog.close}
        onConfirm={(block) => void handleDeleteConfirm(block)}
      />

      <DeletePlanDialog
        open={planDeleteDialog.open}
        plan={planDeleteDialog.subject}
        isDeleting={isDeletingPlan}
        onCancel={planDeleteDialog.close}
        onConfirm={(plan) => void handleDeletePlanConfirm(plan)}
      />
    </div>
  );
}
