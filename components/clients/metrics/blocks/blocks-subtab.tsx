"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  Flag,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { journeyTripParams, type ClientTab } from "@/lib/client-tabs";
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
  syncBlockEvents,
  useBlockFacts,
  useClientBlocks,
  useClearBlockFacts,
  useInvalidateClientBlocks,
  useSeedClientBlocks,
} from "../hooks/use-client-blocks";
import { formatBlockDate } from "@/lib/blocks/block-format";
import { useInvalidateTrainingData } from "@/hooks/use-calendar-events";
import { useInvalidateNutritionCalendar } from "@/hooks/use-nutrition-calendar-events";
import { useClearClientOverview } from "@/hooks/use-client-overview";
import { useClearAttentionFeed } from "@/hooks/use-attention-feed";
import { blockColor } from "./block-colors";
import { BlockCard } from "./block-card";
import { BlockForm, type BlockFormValues } from "./block-form";
import { buildAppendPayload, buildEditPayload } from "./block-chain-payload";
import {
  BlockEventsDialog,
  type BlockEventsChoice,
  type BlockEventsPrompt,
} from "./block-events-dialog";
import {
  DeleteBlockDialog,
  type BlockDeleteChoice,
} from "./delete-block-dialog";
import { DeletePlanDialog } from "./delete-plan-dialog";
import type { BlockPlanDeleteTarget } from "./block-timeline";

// The Journey tab's Blocks pane: the chain (decorated server-side in the
// CLIENT's timezone — state is never re-derived here) + per-block facts.
// Add, edit and delete all mount here.

/** The one description line the completed save carries, if it needs one. */
function calendarOutcome(choice: BlockEventsChoice): string | undefined {
  return choice.calendar === "clear" ? "The days that left are clear." : undefined;
}

/** The per-plan delete's outcome, in the dialog's own verb. */
function planDeleteOutcome(plan: BlockPlanDeleteTarget): string {
  const verb = plan.state === "active" ? "ended" : "removed";
  return plan.track === "training" ? `"${plan.name}" ${verb}` : `Targets ${verb}`;
}

const ROW_ICON_BUTTON =
  "rounded p-1 text-[#93b0b4] opacity-0 transition-colors focus-visible:opacity-100 group-hover/row:opacity-100";

type BlocksSubtabProps = {
  clientId: string;
  /** The round trip out of a fact, unset or set (7.3/7.4, H): "place one" /
   *  "set targets" and "update plan" / "update targets" all go the same way.
   *  Cross-tab navigation must run through the client page's handler —
   *  activeTab is state seeded from ?tab= at mount only. Absent = the empty
   *  states stay plain text and the set states carry no action. */
  onTabChange?: (tab: ClientTab, extraParams?: Record<string, string>) => void;
};

export function BlocksSubtab({
  clientId,
  onTabChange,
}: BlocksSubtabProps) {
  const { blocks, clientToday, isLoading, isError } = useClientBlocks(clientId);
  const searchParams = useSearchParams();
  // The return trip lands on ?block=<id> and it WINS over the default (the
  // current block): the coach came back to the one they were setting up.
  const focusBlockId = searchParams.get("block");
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
  // The block sync rewrites training_events and moves the nutrition versions'
  // ends, which the computed nutrition month view is priced from, so this
  // screen owes both calendar areas their invalidator as well as its own.
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
  const [deleteTarget, setDeleteTarget] = useState<ClientBlockView | null>(null);
  // Which delete is running, not merely that one is: the spinner belongs on
  // the button that was pressed.
  const [deleting, setDeleting] = useState<BlockDeleteChoice | null>(null);
  // The per-plan delete (C3): the timeline row the coach picked, behind the
  // destructive confirm.
  const [deletePlanTarget, setDeletePlanTarget] = useState<BlockPlanDeleteTarget | null>(null);
  const [isDeletingPlan, setIsDeletingPlan] = useState(false);

  const factsById = useMemo(
    () => new Map(facts.map((fact) => [fact.blockId, fact])),
    [facts]
  );

  // Raised INSTEAD of a save whose end moved earlier. Nothing is stored until
  // the coach picks: both arms of the dialog complete the save, and dismissing
  // it abandons the edit with the form still open behind it, so a coach can
  // never end up with new dates and a question they walked away from.
  const [pendingEdit, setPendingEdit] = useState<{
    block: ClientBlockView;
    values: BlockFormValues;
    prompt: BlockEventsPrompt;
  } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  /**
   * The coach's answer completes the save: the dates first, the calendar
   * second, ONE toast at the end.
   *
   * The two are SEQUENTIAL, not atomic — the dates land through the chain PUT
   * and the calendar through its own POST — so the failure between them is a
   * real state and the toast says exactly that rather than "save failed".
   */
  const completeEdit = async (choice: BlockEventsChoice) => {
    if (!pendingEdit) return;
    const { block, values } = pendingEdit;
    setIsSyncing(true);

    let saved;
    try {
      saved = await saveBlockDates(block, values);
    } catch (error) {
      toast.error("Save failed", {
        description: error instanceof Error ? error.message : "Could not save the block",
      });
      setIsSyncing(false);
      return;
    }

    // The dates are stored from here on. Anything that fails below leaves them
    // saved, and the coach is told which half landed.
    try {
      if (choice.calendar === "clear") {
        await syncBlockEvents(clientId, block.id);
        // The clear rewrites both calendars, so both areas are owed their
        // invalidator (CONVENTIONS §7) — the blocks area alone leaves the
        // Training and Nutrition tabs showing yesterday's days with no error.
        void invalidateTrainingData(clientId);
        void invalidateNutritionCalendar(clientId);
        void clearBlockFacts(clientId);
      }

      // Seeded before the form and the dialog go, in the same tick, so the row
      // underneath never shows the old dates under a closed form.
      void seedBlocks(clientId, saved);
      toast.success(`"${values.name}" updated`, {
        description: calendarOutcome(choice),
      });
      setPendingEdit(null);
      setEditingId(null);
    } catch (error) {
      // The dialog deliberately stays OPEN: it is now the retry. The chain PUT
      // is idempotent (same dates) and the sync reconciles rather than replaying
      // a diff, so picking again is safe and finishes the half that failed.
      toast.error("The dates are saved, but the calendar wasn't updated", {
        description: error instanceof Error ? error.message : "Nothing on the calendar changed",
      });
    } finally {
      // The success path has already awaited it; this catches the failure path,
      // where the dates DID save and the row must show them.
      void invalidateBlocks(clientId);
      void clearClientOverview(clientId);
      void clearAttentionFeed();
      setIsSyncing(false);
    }
  };

  const handleDeleteConfirm = async (
    block: ClientBlockView,
    clearPlans: boolean
  ) => {
    setDeleting(clearPlans ? "plans" : "block");
    try {
      const remaining = await deleteBlockRequest(clientId, block.id, clearPlans);
      // Same reason as the add: the dialog closing against a stale list shows
      // the deleted row for a frame, and deleting the LAST block shows it and
      // then the empty state.
      void seedBlocks(clientId, remaining);
      setDeleteTarget(null);
      if (clearPlans) {
        // Same rule as the sync: this removed rows from both calendars, so both
        // areas are owed their invalidator or the Training and Nutrition tabs
        // keep showing days that are gone (CONVENTIONS §7).
        void invalidateTrainingData(clientId);
        void invalidateNutritionCalendar(clientId);
        void clearBlockFacts(clientId);
      }
      toast.success(clearPlans
          ? `"${block.name}" and their plans are gone`
          : `"${block.name}" deleted`);
      void invalidateBlocks(clientId);
      void clearClientOverview(clientId);
      void clearAttentionFeed();
    } catch (error) {
      toast.error("Delete failed", {
        description: error instanceof Error ? error.message : "Could not delete the block",
      });
    } finally {
      setDeleting(null);
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
      setDeletePlanTarget(null);
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
    } finally {
      setIsDeletingPlan(false);
    }
  };

  const handleAdd = async (values: BlockFormValues) => {
    try {
      const saved = await putBlockChain(
        clientId,
        buildAppendPayload(blocks, {
          name: values.name,
          // Add mode always requires both dates — a block owns its own window.
          startsOn: values.startsOn as string,
          endsOn: values.endsOn as string,
          focus: values.focus,
        })
      );
      // Seed + close in the same tick: React batches them, so the coach goes
      // from form to list with nothing in between. The empty state is gated on
      // `blocks.length === 0` and the form on `showAddForm`, so ANY frame where
      // only one of the two has changed shows something wrong.
      void seedBlocks(clientId, saved);
      setShowAddForm(false);
      toast.success(`"${values.name}" added`);
      void invalidateBlocks(clientId);
      void clearClientOverview(clientId);
      void clearAttentionFeed();
    } catch (error) {
      toast.error("Save failed", {
        description: error instanceof Error ? error.message : "Could not save the block",
      });
    }
  };

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

  /** The chain PUT for one edited block. Shared by both arms of Save. */
  const saveBlockDates = async (
    block: ClientBlockView,
    values: BlockFormValues
  ) => {
    const { payload } = buildEditPayload(blocks, block.id, {
      name: values.name,
      focus: values.focus,
      endsOn: values.endsOn,
      startsOn: values.startsOn,
    });
    return putBlockChain(clientId, payload);
  };

  const handleEdit = async (block: ClientBlockView, values: BlockFormValues) => {
    // Only a moved END changes which days the block owns going forward; a start
    // that moved has already been floored at today by the service. An end later
    // than stored never reaches the dialog — the form caps its Ends field at the
    // stored end and the chain PUT refuses it — so a changed end is a SHORTER
    // one, and the only question is what happens to the days that left.
    const nextEnd = values.endsOn ?? block.endsOn;

    // The end moved earlier: ask FIRST. The save happens inside whichever arm
    // the coach picks, so the X leaves them with their edit still in the form
    // and nothing stored — rather than dates saved and a question they never
    // answered.
    if (nextEnd < block.endsOn) {
      setPendingEdit({
        block,
        values,
        prompt: {
          blockName: values.name,
          newEndLabel: formatBlockDate(nextEnd),
        },
      });
      return;
    }

    try {
      const saved = await saveBlockDates(block, values);
      // Seed + close together, or the row renders the OLD name and dates for a
      // frame under a form that has already gone.
      void seedBlocks(clientId, saved);
      setEditingId(null);
      toast.success(`"${values.name}" updated`);
      void invalidateBlocks(clientId);
      void clearClientOverview(clientId);
      void clearAttentionFeed();
    } catch (error) {
      toast.error("Save failed", {
        description: error instanceof Error ? error.message : "Could not save the block",
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
                    // Every block owns its own window, so a future block's start
                    // is always the coach's to move. A block already under way
                    // keeps its start — moving it would re-label lived days.
                    startEditable: block.state === "future",
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
                onSetNutrition={
                  onTabChange
                    ? () =>
                        onTabChange("nutrition", {
                          nutrition: "plans",
                          ...journeyTripParams("edit", block.id),
                        })
                    : undefined
                }
                onDeletePlan={setDeletePlanTarget}
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
                        onClick={() => setDeleteTarget(block)}
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

      <BlockEventsDialog
        prompt={pendingEdit?.prompt ?? null}
        isWorking={isSyncing}
        onCancel={() => setPendingEdit(null)}
        onChoose={(choice) => void completeEdit(choice)}
      />

      <DeleteBlockDialog
        block={deleteTarget}
        deleting={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={(block, clearPlans) => void handleDeleteConfirm(block, clearPlans)}
      />

      <DeletePlanDialog
        plan={deletePlanTarget}
        isDeleting={isDeletingPlan}
        onCancel={() => setDeletePlanTarget(null)}
        onConfirm={(plan) => void handleDeletePlanConfirm(plan)}
      />
    </div>
  );
}
