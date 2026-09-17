import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { WeekRow } from "./week-row";
import { makeRestWeek, type SessionDraft, type WeekDraft } from "./program-builder-types";

const blank = (uid: string, name: string): SessionDraft => ({
  uid,
  name,
  focus: null,
  estimatedDurationMinutes: null,
  calorieSurplusPercentage: null,
  notes: null,
  sessionType: "training",
  groups: [],
});

function makeWeek(): WeekDraft {
  const week = makeRestWeek(0);
  week.days[0] = { ...week.days[0], isRest: false, sessions: [blank("sess-1", "Push")] };
  return week;
}

function renderRow(props: Partial<Parameters<typeof WeekRow>[0]> = {}) {
  const week = props.week ?? makeWeek();
  const handlers = {
    onToggleCollapse: vi.fn(),
    onDuplicateWeek: vi.fn(),
    onDuplicateWeekWithProgression: vi.fn(),
    onDeleteWeek: vi.fn(),
    onOpenSession: vi.fn(),
    onRequestAddSession: vi.fn(),
    onRemoveSession: vi.fn(),
  };
  render(
    <DndContext>
      <SortableContext items={[week.uid]} strategy={verticalListSortingStrategy}>
        <WeekRow
          week={week}
          mode="edit"
          collapsed={false}
          canDelete
          defaultSurplusPercentage={null}
          {...handlers}
          {...props}
        />
      </SortableContext>
    </DndContext>,
  );
  return { week, handlers };
}

describe("WeekRow / WeekCard", () => {
  beforeEach(() => cleanup());

  it("renders the week chip, session-count frequency, and 7 day cells", () => {
    renderRow();
    expect(screen.getByText("W1")).toBeInTheDocument();
    // This week's training-session count, as the compact "N×" frequency.
    expect(screen.getByText("1×")).toBeInTheDocument();
    // 1 session cell + 6 rest cells.
    expect(screen.getByText("Push")).toBeInTheDocument();
    expect(screen.getAllByText("Rest")).toHaveLength(6);
  });

  it("counts sessions, not training days: a day holding two counts twice", () => {
    const week = makeWeek();
    week.days[3] = {
      ...week.days[3],
      isRest: false,
      sessions: [blank("sess-am", "AM run"), blank("sess-pm", "PM lift")],
    };
    renderRow({ week });
    expect(screen.getByText("3×")).toBeInTheDocument();
    expect(screen.getAllByText("Rest")).toHaveLength(5);
  });

  it("wires duplicate, duplicate-with-progression, and delete to the week uid", () => {
    const { week, handlers } = renderRow();
    fireEvent.click(screen.getByLabelText("Duplicate week 1"));
    expect(handlers.onDuplicateWeek).toHaveBeenCalledWith(week.uid);
    fireEvent.click(screen.getByLabelText("Duplicate week 1 with progression"));
    expect(handlers.onDuplicateWeekWithProgression).toHaveBeenCalledWith(week.uid);
    fireEvent.click(screen.getByLabelText("Delete week 1"));
    expect(handlers.onDeleteWeek).toHaveBeenCalledWith(week.uid);
  });

  it("disables delete when it is the last week (min-1)", () => {
    const { handlers } = renderRow({ canDelete: false });
    const del = screen.getByLabelText("Delete week 1");
    expect(del).toBeDisabled();
    fireEvent.click(del);
    expect(handlers.onDeleteWeek).not.toHaveBeenCalled();
  });

  it("collapse chevron toggles; collapsed rows render compact cells", () => {
    const { week, handlers } = renderRow();
    fireEvent.click(screen.getByLabelText("Collapse week"));
    expect(handlers.onToggleCollapse).toHaveBeenCalledWith(week.uid);

    cleanup();
    renderRow({ collapsed: true });
    // Collapsed: summary + duplicate/delete hidden, day cells show dashes.
    expect(screen.queryByText(/1 session · 6 rest/)).toBeNull();
    expect(screen.getAllByText("—")).toHaveLength(6);
  });

  it("view mode renders no grip, duplicate, progression, or delete", () => {
    renderRow({ mode: "view" });
    expect(screen.queryByLabelText("Drag week 1")).toBeNull();
    expect(screen.queryByLabelText("Duplicate week 1")).toBeNull();
    expect(screen.queryByLabelText("Duplicate week 1 with progression")).toBeNull();
    expect(screen.queryByLabelText("Delete week 1")).toBeNull();
  });
});
