import type { ClientBlockView } from "@/lib/blocks/block-derivations";
import type {
  BlockChainEntryInput,
  ReplaceBlockChainInput,
} from "@/types/client-blocks";

// The add-block PUT payload: the stored chain echoed + the new row appended.
// The echo discipline is the service's elapsed-pin contract (Session 2):
// elapsed rows are pinned verbatim and OMIT `weeks` (a truncated block's day
// count is not whole weeks, so no weeks value could reproduce it);
// current/future rows echo their `weeks`, which reproduces their stored dates
// exactly — only elapsed blocks can be non-whole-weeks. Name, focus and
// target echo verbatim (nulls included) because the service echo-checks them.

export interface NewBlockEntry {
  name: string;
  weeks: number;
  focus: string | null;
  targetWeightKg: number | null;
}

export function buildAppendPayload(
  views: ClientBlockView[],
  entry: NewBlockEntry,
  /** Required for the FIRST block only — an existing chain anchors at its
   *  stored start (immovable while past blocks exist). */
  firstStartsOn?: string
): ReplaceBlockChainInput {
  const startsOn = views[0]?.startsOn ?? firstStartsOn;
  if (!startsOn) {
    throw new Error("The first block needs a start date");
  }

  const echoed: BlockChainEntryInput[] = views.map((view) => ({
    id: view.id,
    name: view.name,
    ...(view.state !== "past" ? { weeks: view.weeks } : {}),
    focus: view.focus,
    targetWeightKg: view.targetWeightKg,
  }));

  return {
    startsOn,
    blocks: [
      ...echoed,
      {
        name: entry.name,
        weeks: entry.weeks,
        focus: entry.focus,
        targetWeightKg: entry.targetWeightKg,
      },
    ],
  };
}
