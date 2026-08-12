import type { ClientBlockView } from "@/lib/blocks/block-derivations";
import type { DeleteShiftOutcome } from "@/lib/blocks/block-chain";
import type { BlockDateChange } from "@/types/client-blocks";
import { formatBlockDate } from "./block-format";

// The delete confirm's ONE plain-sans sentence, built from the same pure
// computeDeleteShift outcome the DELETE route executes — the sentence the
// coach approves and the shift that runs cannot differ. Elapsed blocks never
// reach here (no delete affordance renders for them).

const weeksNoun = (weeks: number) => (weeks === 1 ? "week" : "weeks");

/** "Cut 2 moves to 29 Sep." / "…and Peak to 27 Oct." / "3 later blocks
 *  move earlier." — shared by the delete confirm and the edit form's
 *  push-forward preview (whose count verb is direction-neutral "move"). */
export function movedBlocksClause(
  moved: BlockDateChange[],
  manyVerb: string
): string | null {
  if (moved.length === 0) return null;
  if (moved.length === 1) {
    return `${moved[0].name} moves to ${formatBlockDate(moved[0].next.startsOn)}.`;
  }
  if (moved.length === 2) {
    return `${moved[0].name} moves to ${formatBlockDate(moved[0].next.startsOn)} and ${moved[1].name} to ${formatBlockDate(moved[1].next.startsOn)}.`;
  }
  return `${moved.length} later blocks ${manyVerb}.`;
}

export function buildDeleteSentence(
  chain: ClientBlockView[],
  deletedId: string,
  outcome: Extract<DeleteShiftOutcome, { kind: "removed" | "truncated" }>
): string {
  if (outcome.kind === "truncated") {
    // The deleted block keeps its lived days and ends yesterday; what the
    // coach needs to hear is what happens NEXT (the plan doc's copy).
    const index = chain.findIndex((block) => block.id === deletedId);
    const successor = index >= 0 ? chain[index + 1] : undefined;
    return successor
      ? `${successor.name} starts today.`
      : "The journey now ends yesterday.";
  }

  const remaining = chain.filter((block) => block.id !== deletedId);
  if (remaining.length === 0) {
    return "Removes the journey's only block.";
  }

  const shiftedById = new Map(
    outcome.changes.map((change) => [change.id, change.next])
  );
  const last = remaining[remaining.length - 1];
  const journeyEnd = shiftedById.get(last.id)?.endsOn ?? last.endsOn;
  const totalWeeks = remaining.reduce((sum, block) => sum + block.weeks, 0);

  const base = `The journey shortens to ${totalWeeks} ${weeksNoun(totalWeeks)} and ends ${formatBlockDate(journeyEnd)}.`;

  const clause = movedBlocksClause(outcome.changes, "move earlier");
  return clause ? `${base} ${clause}` : base;
}
