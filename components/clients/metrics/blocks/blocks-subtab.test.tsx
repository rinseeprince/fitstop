import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { BlocksSubtab } from "./blocks-subtab";
import type { ClientBlockView } from "@/lib/blocks/block-derivations";
import type { BlockPlanDeleteTarget } from "./block-timeline";

// The confirms' shape (CONVENTIONS §7 → "No frame disagrees", rule 5). Radix
// re-renders a closing card from live props through its exit animation, which
// jsdom never plays, so the fading frame is asserted as the props the card
// receives: a close flips `open` and leaves the subject, the next open replaces
// it, and a success closes with the spinner still set.

const api = vi.hoisted(() => ({
  deleteBlockRequest: vi.fn(),
  deletePlanRequest: vi.fn(),
  putBlockChain: vi.fn(),
  seedBlocks: vi.fn(),
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
  useSeedClientBlocks: () => api.seedBlocks,
  useClearBlockFacts: () => vi.fn(),
  deleteBlockRequest: api.deleteBlockRequest,
  deletePlanRequest: api.deletePlanRequest,
  patchBlockArchived: vi.fn(),
  putBlockChain: api.putBlockChain,
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
// The form as its submission: the add form draws "Build", the edit form
// shortens its block to end 15 Oct.
vi.mock("./block-form", () => ({
  BlockForm: ({
    mode,
    onSubmit,
  }: {
    mode: { kind: "add" | "edit" };
    onSubmit: (values: Record<string, unknown>) => Promise<void>;
  }) => (
    <div data-testid={`${mode.kind}-form`}>
      <button
        type="button"
        onClick={() =>
          void onSubmit(
            mode.kind === "add"
              ? { name: "Build", startsOn: "2026-11-02", endsOn: "2026-11-29", focus: null }
              : { name: "Cut 2", endsOn: "2026-09-20", focus: null }
          )
        }
      >
        {`Submit the ${mode.kind} form`}
      </button>
    </div>
  ),
}));
// The confirms as data: what each receives is the frame it would paint.
vi.mock("./block-trim-dialog", () => ({
  BlockTrimDialog: ({
    open,
    question,
    isSaving,
    onCancel,
    onConfirm,
  }: {
    open: boolean;
    question: { kind: string; blockName: string; trims: { id: string }[] } | null;
    isSaving: boolean;
    onCancel: () => void;
    onConfirm: () => void;
  }) => (
    <div
      data-testid="trim-dialog"
      data-open={String(open)}
      data-subject={question ? `${question.kind}:${question.blockName}:${question.trims.map((t) => t.id).join(",")}` : ""}
      data-saving={String(isSaving)}
    >
      <button type="button" onClick={onCancel}>Cancel the question</button>
      <button type="button" onClick={onConfirm}>Say yes</button>
    </div>
  ),
}));
vi.mock("./delete-block-dialog", () => ({
  DeleteBlockDialog: ({
    open,
    block,
    isDeleting,
    onCancel,
    onConfirm,
  }: {
    open: boolean;
    block: ClientBlockView | null;
    isDeleting: boolean;
    onCancel: () => void;
    onConfirm: (block: ClientBlockView) => void;
  }) => (
    <div
      data-testid="delete-block-dialog"
      data-open={String(open)}
      data-subject={block?.id ?? ""}
      data-deleting={String(isDeleting)}
    >
      <button type="button" onClick={onCancel}>Cancel the block delete</button>
      <button type="button" onClick={() => block && onConfirm(block)}>Confirm the block delete</button>
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
/** Click, then let the request it awaits settle inside act. */
const clickAndSettle = (name: string) =>
  act(() => {
    screen.getByRole("button", { name }).click();
    return new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
const blockDialog = () => screen.getByTestId("delete-block-dialog").dataset;
const planDialog = () => screen.getByTestId("delete-plan-dialog").dataset;
const trimDialog = () => screen.getByTestId("trim-dialog").dataset;

beforeEach(() => {
  api.deleteBlockRequest.mockReset();
  api.deletePlanRequest.mockReset();
  api.putBlockChain.mockReset();
  api.seedBlocks.mockReset();
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

  it("deletes the block and its plans in one act: a success closes it on the frame it closed on, and the next open clears the spinner", async () => {
    const request = deferred<ClientBlockView[]>();
    api.deleteBlockRequest.mockReturnValueOnce(request.promise);
    render(<BlocksSubtab clientId="c1" />);

    click("Delete Cut 2");
    click("Confirm the block delete");
    expect(api.deleteBlockRequest).toHaveBeenCalledWith("c1", "blk-1");
    expect(blockDialog()).toMatchObject({ open: "true", subject: "blk-1", deleting: "true" });

    await act(async () => {
      request.resolve(BLOCKS.slice(1));
      await request.promise;
    });
    expect(blockDialog()).toMatchObject({ open: "false", subject: "blk-1", deleting: "true" });

    click("Delete Build 1");
    expect(blockDialog()).toMatchObject({ open: "true", subject: "blk-2", deleting: "false" });
  });

  it("a failure keeps it open as the retry, with its buttons back", async () => {
    const request = deferred<ClientBlockView[]>();
    api.deleteBlockRequest.mockReturnValueOnce(request.promise);
    render(<BlocksSubtab clientId="c1" />);

    click("Delete Cut 2");
    click("Confirm the block delete");
    await act(async () => {
      request.reject(new Error("nope"));
      await request.promise.catch(() => undefined);
    });
    expect(blockDialog()).toMatchObject({ open: "true", subject: "blk-1", deleting: "false" });
  });
});

// A save that draws or shortens a block over days holding a plan comes back
// with its trims: the question opens over the form, and the coach's yes
// re-sends the same save.
const SAVED = { blocks: BLOCKS, clientToday: "2026-09-14", planStartFloor: "2026-09-14" };
const TRIM = { track: "training", id: "p-power", name: "Power", startsOn: "2026-11-09", endsOn: "2026-12-20", newEndsOn: "2026-11-29" };

describe("BlocksSubtab — the one question a save that trims plans asks", () => {
  it("a save with nothing to trim lands at once: no question, the form closes onto the seeded list", async () => {
    api.putBlockChain.mockResolvedValueOnce({ saved: SAVED });
    render(<BlocksSubtab clientId="c1" />);

    click("Add a block");
    await clickAndSettle("Submit the add form");

    expect(api.seedBlocks).toHaveBeenCalledWith("c1", SAVED);
    expect(screen.queryByTestId("add-form")).toBeNull();
    expect(trimDialog()).toMatchObject({ open: "false", subject: "" });
  });

  it("a save that trims opens the question with the trims over the open form; Cancel closes it and saves nothing", async () => {
    api.putBlockChain.mockResolvedValueOnce({ trims: [TRIM] });
    render(<BlocksSubtab clientId="c1" />);

    click("Add a block");
    await clickAndSettle("Submit the add form");

    expect(trimDialog()).toMatchObject({ open: "true", subject: "add:Build:p-power", saving: "false" });
    expect(screen.getByTestId("add-form")).toBeDefined();
    expect(api.seedBlocks).not.toHaveBeenCalled();

    click("Cancel the question");
    expect(trimDialog()).toMatchObject({ open: "false", subject: "add:Build:p-power" });
    expect(screen.getByTestId("add-form")).toBeDefined();
    expect(api.putBlockChain).toHaveBeenCalledTimes(1);
  });

  it("yes re-sends the SAME save with confirmTrims, then closes the question and the form onto the seeded list", async () => {
    api.putBlockChain.mockResolvedValueOnce({ trims: [TRIM] });
    const confirm = deferred<{ saved: typeof SAVED }>();
    api.putBlockChain.mockReturnValueOnce(confirm.promise);
    render(<BlocksSubtab clientId="c1" />);

    click("Edit Cut 2");
    await clickAndSettle("Submit the edit form");
    const [, asked] = api.putBlockChain.mock.calls[0];
    expect(trimDialog()).toMatchObject({ open: "true", subject: "save:Cut 2:p-power" });

    click("Say yes");
    expect(api.putBlockChain).toHaveBeenLastCalledWith("c1", { ...asked, confirmTrims: true });
    expect(trimDialog()).toMatchObject({ open: "true", saving: "true" });

    await act(async () => {
      confirm.resolve({ saved: SAVED });
      await confirm.promise;
    });
    expect(api.seedBlocks).toHaveBeenCalledWith("c1", SAVED);
    expect(screen.queryByTestId("edit-form")).toBeNull();
    // The closing card keeps its trims and its spinner; the next open clears it.
    expect(trimDialog()).toMatchObject({ open: "false", subject: "save:Cut 2:p-power", saving: "true" });
  });

  it("a failed yes keeps the question open as the retry, with its buttons back, and the form behind it", async () => {
    api.putBlockChain.mockResolvedValueOnce({ trims: [TRIM] });
    api.putBlockChain.mockRejectedValueOnce(new Error("nope"));
    render(<BlocksSubtab clientId="c1" />);

    click("Add a block");
    await clickAndSettle("Submit the add form");
    await clickAndSettle("Say yes");

    expect(trimDialog()).toMatchObject({ open: "true", subject: "add:Build:p-power", saving: "false" });
    expect(screen.getByTestId("add-form")).toBeDefined();
    expect(api.seedBlocks).not.toHaveBeenCalled();
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
