"use client";

import { useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Flag,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionLabel } from "@/components/programs/shared/section-label";
import { Skeleton } from "@/components/ui/skeleton";
import { FOCUS_RING } from "@/components/clients/training/program-builder/builder-tokens";
import { useToast } from "@/hooks/use-toast";
import { useUnits } from "@/contexts/units-context";
import { formatWeight } from "@/utils/unit-conversions";
import { computeDeleteShift } from "@/lib/blocks/block-chain";
import { derivePace, type ClientBlockView } from "@/lib/blocks/block-derivations";
import {
  deleteBlockRequest,
  patchBlockArchived,
  putBlockChain,
  useBlockFacts,
  useClientBlocks,
  useInvalidateClientBlocks,
} from "../hooks/use-client-blocks";
import { blockColor } from "./block-colors";
import { deriveBlockWeightFacts } from "./block-weight";
import { BlockCard } from "./block-card";
import { BlockForm, type BlockFormValues } from "./block-form";
import {
  buildAppendPayload,
  buildEditPayload,
  computeEditShift,
} from "./block-chain-payload";
import { buildDeleteSentence, movedBlocksClause } from "./delete-block-sentence";
import { DeleteBlockDialog } from "./delete-block-dialog";
import type { MetricSummary } from "../metrics-view-types";

// The Journey tab's Blocks pane: the chain (decorated server-side in the
// CLIENT's timezone — state is never re-derived here) + per-block facts +
// the weight story from the SAME merged series as the chart and log beside
// it, so the numbers cannot disagree. Add, edit and delete all mount here.

const round1 = (n: number): number => Math.round(n * 10) / 10;

const ROW_ICON_BUTTON =
  "rounded p-1 text-[#93b0b4] opacity-0 transition-colors focus-visible:opacity-100 group-hover/row:opacity-100";

type BlocksSubtabProps = {
  clientId: string;
  /** The weight MetricSummary from useMergedMetrics (viewer units), or null
   *  while metrics load / when nothing is logged. */
  weightMetric: MetricSummary | null;
};

export function BlocksSubtab({ clientId, weightMetric }: BlocksSubtabProps) {
  const { blocks, clientToday, isLoading, isError } = useClientBlocks(clientId);
  const {
    facts,
    isLoading: factsLoading,
    isError: factsError,
  } = useBlockFacts(clientId);
  const { preference } = useUnits();
  const { toast } = useToast();
  const invalidateBlocks = useInvalidateClientBlocks();
  const [showAddForm, setShowAddForm] = useState(false);
  // Coach-curated views (Session 3.7): "journey" = everything unarchived —
  // a live program's finished phases included; "archive" = what the coach
  // has filed away. A pure render filter: the chain contracts (echo, shift
  // math, add-form anchor) always operate on the FULL chain.
  const [view, setView] = useState<"journey" | "archive">("journey");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ClientBlockView | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const factsById = useMemo(
    () => new Map(facts.map((fact) => [fact.blockId, fact])),
    [facts]
  );

  // Previewed with the SAME pure helper and the SAME client-tz today the
  // DELETE route executes with, so the approved sentence and the executed
  // shift cannot differ.
  const deleteSentence = useMemo(() => {
    if (!deleteTarget || !clientToday) return null;
    const outcome = computeDeleteShift(blocks, deleteTarget.id, clientToday);
    if (!outcome || outcome.kind === "elapsed") return null;
    return buildDeleteSentence(blocks, deleteTarget.id, outcome);
  }, [blocks, deleteTarget, clientToday]);

  const handleDeleteConfirm = async (block: ClientBlockView) => {
    setIsDeleting(true);
    try {
      const result = await deleteBlockRequest(clientId, block.id);
      void invalidateBlocks(clientId);
      toast({
        title:
          result.mode === "truncated"
            ? `"${block.name}" now ends yesterday`
            : `"${block.name}" deleted`,
      });
      setDeleteTarget(null);
    } catch (error) {
      toast({
        title: "Delete failed",
        description:
          error instanceof Error ? error.message : "Could not delete the block",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleAdd = async (values: BlockFormValues) => {
    try {
      await putBlockChain(
        clientId,
        buildAppendPayload(
          blocks,
          {
            name: values.name,
            endsOn: values.endsOn as string, // add mode always requires an end
            focus: values.focus,
            targetWeightKg: values.targetWeightKg,
          },
          values.startsOn
        )
      );
      void invalidateBlocks(clientId);
      toast({ title: `"${values.name}" added` });
      setShowAddForm(false);
    } catch (error) {
      toast({
        title: "Save failed",
        description:
          error instanceof Error ? error.message : "Could not save the block",
        variant: "destructive",
      });
    }
  };

  const handleArchive = async (block: ClientBlockView, archived: boolean) => {
    try {
      await patchBlockArchived(clientId, block.id, archived);
      void invalidateBlocks(clientId);
      toast({
        title: archived ? `"${block.name}" archived` : `"${block.name}" restored`,
      });
    } catch (error) {
      toast({
        title: archived ? "Archive failed" : "Restore failed",
        description:
          error instanceof Error ? error.message : "Could not update the block",
        variant: "destructive",
      });
    }
  };

  const handleEdit = async (block: ClientBlockView, values: BlockFormValues) => {
    try {
      const { payload } = buildEditPayload(blocks, block.id, {
        name: values.name,
        focus: values.focus,
        targetWeightKg: values.targetWeightKg,
        endsOn: values.endsOn,
        startsOn: values.startsOn,
      });
      await putBlockChain(clientId, payload);
      void invalidateBlocks(clientId);
      toast({ title: `"${values.name}" updated` });
      setEditingId(null);
    } catch (error) {
      toast({
        title: "Save failed",
        description:
          error instanceof Error ? error.message : "Could not save the block",
        variant: "destructive",
      });
    }
  };

  const weightPoints = weightMetric?.points ?? [];
  const weightUnit =
    weightMetric?.unit ?? (preference === "imperial" ? "lbs" : "kg");

  const totalWeeks = blocks.reduce((sum, block) => sum + block.weeks, 0);
  const meta =
    blocks.length > 0
      ? `${blocks.length} ${blocks.length === 1 ? "block" : "blocks"} · ${totalWeeks} weeks`
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
      otherBlocksWeeks={totalWeeks}
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
              a build, a deload — with the training, nutrition and weight story
              of each.
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
                    // The anchor is the coach's to move only while NOTHING is
                    // lived: the chain's first block, still future.
                    startEditable:
                      blocks[0]?.id === block.id && block.state === "future",
                    minEnd: block.state === "current" ? clientToday : null,
                  }}
                  otherBlocksWeeks={totalWeeks - block.weeks}
                  shiftPreview={(endsOn) =>
                    movedBlocksClause(
                      computeEditShift(blocks, block.id, endsOn),
                      "move"
                    )
                  }
                  onSubmit={(values) => handleEdit(block, values)}
                  onCancel={() => setEditingId(null)}
                />
              );
            }
            const weight = deriveBlockWeightFacts(weightPoints, block);
            const targetDisplay =
              block.targetWeightKg != null
                ? round1(formatWeight(block.targetWeightKg, preference).value)
                : null;
            // The wire's client-tz today drives the pace fraction too — no
            // block math ever runs on the coach's device day.
            const pace =
              targetDisplay != null && clientToday != null
                ? derivePace({
                    startsOn: block.startsOn,
                    endsOn: block.endsOn,
                    targetWeight: targetDisplay,
                    startWeight: weight.start?.value ?? null,
                    currentWeight: weight.end?.value ?? null,
                    today: clientToday,
                  })
                : null;
            return (
              <BlockCard
                key={block.id}
                block={block}
                color={color}
                facts={factsById.get(block.id)}
                factsLoading={factsLoading}
                factsError={factsError}
                weight={weight}
                pace={pace}
                targetDisplay={targetDisplay}
                weightUnit={weightUnit}
                defaultOpen={block.state === "current"}
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

      <DeleteBlockDialog
        block={deleteTarget}
        sentence={deleteSentence}
        isDeleting={isDeleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={(block) => void handleDeleteConfirm(block)}
      />
    </div>
  );
}
