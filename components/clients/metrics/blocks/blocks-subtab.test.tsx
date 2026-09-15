import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { BlocksSubtab } from "./blocks-subtab";
import type { ClientBlockView } from "@/lib/blocks/block-derivations";
import type { BlockPlanDeleteTarget } from "./block-timeline";

// The two delete confirms' shape (CONVENTIONS §7 → "No frame disagrees", rule
// 5). Radix re-renders a closing card from live props through its exit
// animation, which jsdom never plays, so the fading frame is asserted as the
// props the card receives: a close flips `open` and leaves the subject, the
// next open replaces it, and a success closes with the spinner still set.

const api = vi.hoisted(() => ({
  deleteBlockRequest: vi.fn(),
  deletePlanRequest: vi.fn(),
}));

function makeBlock(overrides: Partial<ClientBlockView>): ClientBlockView {
  return {
    id: "blk-1",
    name: "Cut 2",
    focus: null,
    startsOn: "2026-08-01",
    endsOn: "2026-09-30",
    archivedAt: null,
    weeks: 9,
    state: "current",
    weekOfTotal: null,
    ...overrides,
  };
}

// Both delete-able: a past block carries Archive instead of Trash.
const BLOCKS = [
  makeBlock({}),
  makeBlock({ id: "blk-2", name: "Build 1", startsOn: "2026-10-01", endsOn: "2026-10-31", state: "future" }),
];

/** The plan each stubbed card offers for the per-plan delete. */
const planOf = (block: ClientBlockView): BlockPlanDeleteTarget => ({
  track: "training",
  id: `plan-${block.id}`,
  name: `${block.name} program`,
  state: "active",
  startsOn: block.startsOn,
  endsOn: block.endsOn,
});

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/hooks/use-journey-focus-block", () => ({ useJourneyFocusBlock: () => null }));
vi.mock("@/hooks/use-calendar-events", () => ({ useInvalidateTrainingData: () => vi.fn() }));
vi.mock("@/hooks/use-nutrition-calendar-events", () => ({ useInvalidateNutritionCalendar: () => vi.fn() }));
vi.mock("@/hooks/use-client-overview", () => ({ useClearClientOverview: () => vi.fn() }));
vi.mock("@/hooks/use-attention-feed", () => ({ useClearAttentionFeed: () => vi.fn() }));
// Read lazily, at render: the factory is hoisted above the fixtures.
vi.mock("../hooks/use-client-blocks", () => ({
  useClientBlocks: () => ({
    blocks: BLOCKS,
    clientToday: "2026-09-14",
    planStartFloor: null,
    isLoading: false,
    isError: false,
  }),
  useBlockFacts: () => ({ facts: [], isLoading: false, isError: false }),
  useInvalidateClientBlocks: () => vi.fn(),
  useSeedClientBlocks: () => vi.fn(),
  useClearBlockFacts: () => vi.fn(),
  deleteBlockRequest: api.deleteBlockRequest,
  deletePlanRequest: api.deletePlanRequest,
  patchBlockArchived: vi.fn(),
  putBlockChain: vi.fn(),
  syncBlockEvents: vi.fn(),
}));
// The card is under its own tests, which pin which door calls which handler:
// here it is the row's actions, the timeline's per-plan delete, and the
// Training column's two handlers — the program list's, behind "place one" and
// an ended headline's "update plan", and the plan editor's, behind "edit
// plan" with the plan it heads.
vi.mock("./block-card", () => ({
  BlockCard: ({
    block,
    rowAction,
    onPlaceProgram,
    onEditPlan,
    onDeletePlan,
  }: {
    block: ClientBlockView;
    rowAction?: React.ReactNode;
    onPlaceProgram?: () => void;
    onEditPlan?: (planId: string) => void;
    onDeletePlan?: (plan: BlockPlanDeleteTarget) => void;
  }) => (
    <div>
      {rowAction}
      <button type="button" onClick={() => onDeletePlan?.(planOf(block))}>
        {`End ${block.name} program`}
      </button>
      {onPlaceProgram && (
        <button type="button" onClick={onPlaceProgram}>
          {`${block.name}: place one or update plan`}
        </button>
      )}
      {onEditPlan && (
        <button type="button" onClick={() => onEditPlan(planOf(block).id)}>
          {`${block.name}: edit plan`}
        </button>
      )}
    </div>
  ),
}));
vi.mock("./block-form", () => ({ BlockForm: () => null }));
vi.mock("./block-events-dialog", () => ({ BlockEventsDialog: () => null }));
// The confirms as data: what each receives is the frame it would paint.
vi.mock("./delete-block-dialog", () => ({
  DeleteBlockDialog: ({
    open,
    block,
    deleting,
    onCancel,
    onConfirm,
  }: {
    open: boolean;
    block: ClientBlockView | null;
    deleting: string | null;
    onCancel: () => void;
    onConfirm: (block: ClientBlockView, clearPlans: boolean) => void;
  }) => (
    <div
      data-testid="delete-block-dialog"
      data-open={String(open)}
      data-subject={block?.id ?? ""}
      data-deleting={deleting ?? ""}
    >
      <button type="button" onClick={onCancel}>Cancel the block delete</button>
      <button type="button" onClick={() => block && onConfirm(block, false)}>Confirm the block alone</button>
      <button type="button" onClick={() => block && onConfirm(block, true)}>Confirm the block and its plans</button>
    </div>
  ),
}));
vi.mock("./delete-plan-dialog", () => ({
  DeletePlanDialog: ({
    open,
    plan,
    isDeleting,
    onCancel,
    onConfirm,
  }: {
    open: boolean;
    plan: BlockPlanDeleteTarget | null;
    isDeleting: boolean;
    onCancel: () => void;
    onConfirm: (plan: BlockPlanDeleteTarget) => void;
  }) => (
    <div
      data-testid="delete-plan-dialog"
      data-open={String(open)}
      data-subject={plan?.id ?? ""}
      data-deleting={String(isDeleting)}
    >
      <button type="button" onClick={onCancel}>Cancel the plan delete</button>
      <button type="button" onClick={() => plan && onConfirm(plan)}>Confirm the plan delete</button>
    </div>
  ),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const click = (name: string) => act(() => screen.getByRole("button", { name }).click());
const blockDialog = () => screen.getByTestId("delete-block-dialog").dataset;
const planDialog = () => screen.getByTestId("delete-plan-dialog").dataset;

beforeEach(() => {
  api.deleteBlockRequest.mockReset();
  api.deletePlanRequest.mockReset();
});
afterEach(cleanup);

describe("BlocksSubtab — the block delete confirm", () => {
  it("Cancel closes it and leaves its block; the next open replaces the block", () => {
    render(<BlocksSubtab clientId="c1" />);
    expect(blockDialog()).toMatchObject({ open: "false", subject: "" });

    click("Delete Cut 2");
    expect(blockDialog()).toMatchObject({ open: "true", subject: "blk-1" });

    click("Cancel the block delete");
    expect(blockDialog()).toMatchObject({ open: "false", subject: "blk-1" });

    click("Delete Build 1");
    expect(blockDialog()).toMatchObject({ open: "true", subject: "blk-2" });
  });

  it.each([
    ["Confirm the block alone", false, "block"],
    ["Confirm the block and its plans", true, "plans"],
  ] as const)(
    "%s: a success closes it on the frame it closed on, and the next open clears the spinner",
    async (cta, clearPlans, choice) => {
      const request = deferred<ClientBlockView[]>();
      api.deleteBlockRequest.mockReturnValueOnce(request.promise);
      render(<BlocksSubtab clientId="c1" />);

      click("Delete Cut 2");
      click(cta);
      expect(api.deleteBlockRequest).toHaveBeenCalledWith("c1", "blk-1", clearPlans);
      expect(blockDialog()).toMatchObject({ open: "true", subject: "blk-1", deleting: choice });

      await act(async () => {
        request.resolve(BLOCKS.slice(1));
        await request.promise;
      });
      expect(blockDialog()).toMatchObject({ open: "false", subject: "blk-1", deleting: choice });

      click("Delete Build 1");
      expect(blockDialog()).toMatchObject({ open: "true", subject: "blk-2", deleting: "" });
    }
  );

  it("a failure keeps it open as the retry, with its buttons back", async () => {
    const request = deferred<ClientBlockView[]>();
    api.deleteBlockRequest.mockReturnValueOnce(request.promise);
    render(<BlocksSubtab clientId="c1" />);

    click("Delete Cut 2");
    click("Confirm the block and its plans");
    await act(async () => {
      request.reject(new Error("nope"));
      await request.promise.catch(() => undefined);
    });
    expect(blockDialog()).toMatchObject({ open: "true", subject: "blk-1", deleting: "" });
  });
});

describe("BlocksSubtab — the per-plan delete confirm", () => {
  it("Cancel closes it and leaves its plan; the next open replaces the plan", () => {
    render(<BlocksSubtab clientId="c1" />);
    expect(planDialog()).toMatchObject({ open: "false", subject: "" });

    click("End Cut 2 program");
    expect(planDialog()).toMatchObject({ open: "true", subject: "plan-blk-1" });

    click("Cancel the plan delete");
    expect(planDialog()).toMatchObject({ open: "false", subject: "plan-blk-1" });

    click("End Build 1 program");
    expect(planDialog()).toMatchObject({ open: "true", subject: "plan-blk-2" });
  });

  it("a success closes it on the frame it closed on, and the next open clears the spinner", async () => {
    const request = deferred<void>();
    api.deletePlanRequest.mockReturnValueOnce(request.promise);
    render(<BlocksSubtab clientId="c1" />);

    click("End Cut 2 program");
    click("Confirm the plan delete");
    expect(api.deletePlanRequest).toHaveBeenCalledWith("c1", "training", "plan-blk-1");
    expect(planDialog()).toMatchObject({ open: "true", subject: "plan-blk-1", deleting: "true" });

    await act(async () => {
      request.resolve();
      await request.promise;
    });
    expect(planDialog()).toMatchObject({ open: "false", subject: "plan-blk-1", deleting: "true" });

    click("End Build 1 program");
    expect(planDialog()).toMatchObject({ open: "true", subject: "plan-blk-2", deleting: "false" });
  });

  it("a failure keeps it open as the retry, with its buttons back", async () => {
    const request = deferred<void>();
    api.deletePlanRequest.mockReturnValueOnce(request.promise);
    render(<BlocksSubtab clientId="c1" />);

    click("End Cut 2 program");
    click("Confirm the plan delete");
    await act(async () => {
      request.reject(new Error("nope"));
      await request.promise.catch(() => undefined);
    });
    expect(planDialog()).toMatchObject({ open: "true", subject: "plan-blk-1", deleting: "false" });
  });
});

// The Training column's doors, as the address each lands on: one tab change
// through the client page's handler, carrying the trip back to the block.
describe("BlocksSubtab — the Training column's doors", () => {
  it("edit plan lands on the plan editor on that plan, with the trip back to its block", () => {
    const onTabChange = vi.fn();
    render(<BlocksSubtab clientId="c1" onTabChange={onTabChange} />);

    click("Build 1: edit plan");
    expect(onTabChange).toHaveBeenCalledTimes(1);
    expect(onTabChange).toHaveBeenCalledWith("training", {
      training: "plans",
      plan: "plan-blk-2",
      returnTo: "journey",
      returnBlock: "blk-2",
    });
  });

  it("place one and update plan land on the program list, with the apply trip", () => {
    const onTabChange = vi.fn();
    render(<BlocksSubtab clientId="c1" onTabChange={onTabChange} />);

    click("Cut 2: place one or update plan");
    expect(onTabChange).toHaveBeenCalledTimes(1);
    expect(onTabChange).toHaveBeenCalledWith("training", {
      training: "plans",
      apply: "1",
      returnTo: "journey",
      returnBlock: "blk-1",
    });
  });
});
