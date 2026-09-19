import { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { SessionDraft } from "../program-builder-types";

// The real chat hook over a stubbed route: what these prove is WHERE the
// conversation lives. A panel that owned its chat would remount empty when it
// moves between its two hosts; the provider above both keeps it.
const draft = { weeks: [] };
const mockDraftContext = {
  target: "library",
  clientId: null,
  placedPlanId: null,
  editableDays: null,
  mode: "edit",
  isSaving: false,
  assistantBusy: false,
  setAssistantBusy: vi.fn(),
  setMode: vi.fn(),
  getDraft: () => draft,
  getDirty: () => false,
  getRevision: () => 0,
  replaceDraft: vi.fn(),
  restoreDirty: vi.fn(),
  applyAssistantOps: vi.fn(),
};

vi.mock("../program-draft-provider", () => ({
  useProgramDraft: () => mockDraftContext,
}));
vi.mock("../exercise-picker", () => ({
  ExercisePicker: () => <div data-testid="exercise-picker" />,
}));
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));

import { AssistantDock } from "./assistant-dock";
import { AssistantProvider } from "./assistant-provider";
import { SessionEditorSheet } from "../session-editor-sheet";

const session: SessionDraft = {
  uid: "sess-1",
  name: "Push Day",
  focus: null,
  estimatedDurationMinutes: null,
  calorieSurplusPercentage: null,
  notes: null,
  sessionType: "training",
  groups: [],
};
const noop = () => undefined;
const sheetProps = {
  session,
  mode: "edit" as const,
  defaultSurplusPercentage: null,
  onUpdateSession: noop,
  onAddExercise: noop,
  onRemoveExercise: noop,
  onEditExercise: noop,
  onLinkExercises: noop,
  onUnlinkGroup: noop,
  onMoveExercise: noop,
  onMoveGroup: noop,
  onUpdateGroup: noop,
  onSpecEdit: noop,
  onSaveAsWorkout: noop,
  isSavingWorkout: false,
};

// ProgramBuilder's wiring: one provider above the session sheet and the dock.
function Builder() {
  const [sheetOpen, setSheetOpen] = useState(false);
  return (
    <AssistantProvider>
      <button type="button" onClick={() => setSheetOpen(true)}>
        Open session
      </button>
      <SessionEditorSheet {...sheetProps} open={sheetOpen} onClose={() => setSheetOpen(false)} />
      <AssistantDock sessionSheetOpen={sheetOpen} />
    </AssistantProvider>
  );
}

// A turn with no ops — nothing to apply — and a turn whose one op is
// destructive, which the hook holds as a preview to apply or dismiss.
const plainReply = {
  success: true,
  data: { assistantText: "Two more weeks added.", ops: [], skipped: [], stopReason: "end_turn" },
};
const destructiveReply = {
  success: true,
  data: {
    assistantText: "Review this first.",
    ops: [{ type: "remove_week", weekUid: "week-3", label: "Delete week 3" }],
    skipped: [],
    stopReason: "end_turn",
  },
};

const respondWith = (body: unknown) =>
  vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );

const panel = () => screen.getByRole("dialog", { name: "Program assistant" });
const sheet = () => screen.getByRole("dialog", { name: "Push Day" });

describe("AssistantProvider owns the conversation above both hosts", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("the transcript survives a session opening and closing, and the panel collapsing", async () => {
    vi.stubGlobal("fetch", respondWith(plainReply));
    render(<Builder />);
    fireEvent.click(screen.getByRole("button", { name: /open the program assistant/i }));
    fireEvent.click(screen.getByRole("button", { name: "Add 2 more weeks" }));
    expect(await screen.findByText("Two more weeks added.")).toBeInTheDocument();
    expect(screen.getByText("Add 2 more weeks")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Open session"));
    const hosted = within(sheet()).getByRole("dialog", { name: "Program assistant" });
    expect(within(hosted).getByText("Add 2 more weeks")).toBeInTheDocument();
    expect(within(hosted).getByText("Two more weeks added.")).toBeInTheDocument();

    fireEvent.click(within(sheet()).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "Push Day" })).toBeNull();
    expect(within(panel()).getByText("Two more weeks added.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collapse assistant" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /open the program assistant/i }));
    expect(within(panel()).getByText("Two more weeks added.")).toBeInTheDocument();
  });

  it("a pending preview survives a session opening and closing", async () => {
    vi.stubGlobal("fetch", respondWith(destructiveReply));
    render(<Builder />);
    fireEvent.click(screen.getByRole("button", { name: /open the program assistant/i }));
    fireEvent.click(screen.getByRole("button", { name: "Make the last week a deload" }));
    expect(await screen.findByText(/includes destructive edits/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Open session"));
    const hosted = within(sheet()).getByRole("dialog", { name: "Program assistant" });
    expect(within(hosted).getByText(/Delete week 3/)).toBeInTheDocument();
    expect(within(hosted).getByRole("button", { name: /apply all/i })).toBeInTheDocument();

    fireEvent.click(within(sheet()).getByRole("button", { name: "Done" }));
    expect(within(panel()).getByText(/Delete week 3/)).toBeInTheDocument();
    expect(within(panel()).getByRole("button", { name: /apply all/i })).toBeInTheDocument();
  });
});
