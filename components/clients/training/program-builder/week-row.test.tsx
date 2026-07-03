import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { WeekRow } from "./week-row";
import { makeRestWeek, type WeekDraft } from "./program-builder-types";

function makeWeek(): WeekDraft {
  const week = makeRestWeek(0);
  week.days[0] = {
    ...week.days[0],
    isRest: false,
    session: {
      uid: "sess-1",
      name: "Push",
      focus: null,
      estimatedDurationMinutes: null,
      calorieSurplusPercentage: null,
      notes: null,
      sessionType: "training",
      exercises: [],
    },
  };
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
    onClearSlot: vi.fn(),
  };
  render(
    <DndContext>
      <SortableContext items={[week.uid]} strategy={verticalListSortingStrategy}>
        <WeekRow
          week={week}
          mode="edit"
          collapsed={false}
          canDelete
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

  it("renders the week number, sessions-vs-rest summary, and 7 day cells", () => {
    renderRow();
    expect(screen.getByText("Week 1")).toBeInTheDocument();
    expect(screen.getByText(/1 session · 6 rest/)).toBeInTheDocument();
    // 1 session cell + 6 rest cells.
    expect(screen.getByText("Push")).toBeInTheDocument();
    expect(screen.getAllByText("Rest")).toHaveLength(6);
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
