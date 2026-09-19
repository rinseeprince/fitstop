import { describe, expect, it } from "vitest";
import type { Active, ClientRect, DroppableContainer } from "@dnd-kit/core";
import {
  destinationFor,
  destinationOf,
  dropChangesSession,
  exerciseDropCollision,
  itemDropId,
  memberDropId,
  railDropId,
  sameDestination,
  type ExerciseDragData,
  type ExerciseDropData,
} from "./exercise-drop";
import { STRAIGHT_SETS } from "@/utils/exercise-groups";
import { defaultExerciseDraftFromCatalog } from "./program-builder-model";
import type { ExerciseGroupDraft, SessionDraft } from "./program-builder-types";

// The list as the collision sees it: a standalone card (0-40), a superset's
// block (50-200) whose rail (80-200) holds two cards (80-130, 140-190), then a
// standalone card (210-250). Everything spans x 0-300; the rail starts at x 14.
const rect = (top: number, bottom: number, left = 0, right = 300): ClientRect => ({
  top,
  bottom,
  left,
  right,
  height: bottom - top,
  width: right - left,
});

type Droppable = { id: string; data: ExerciseDropData; rect: ClientRect };
const LIST: Droppable[] = [
  { id: itemDropId("grp-a"), data: { type: "item", index: 0, linked: false }, rect: rect(0, 40) },
  { id: itemDropId("grp-ss"), data: { type: "item", index: 1, linked: true }, rect: rect(50, 200) },
  { id: railDropId("grp-ss"), data: { type: "rail", groupUid: "grp-ss" }, rect: rect(80, 200, 14) },
  { id: memberDropId("ex-b"), data: { type: "member", groupUid: "grp-ss", index: 0 }, rect: rect(80, 130, 14) },
  { id: memberDropId("ex-c"), data: { type: "member", groupUid: "grp-ss", index: 1 }, rect: rect(140, 190, 14) },
  { id: itemDropId("grp-d"), data: { type: "item", index: 2, linked: false }, rect: rect(210, 250) },
];

function collide(drag: ExerciseDragData, x: number, y: number) {
  const droppableContainers = LIST.map(
    (d) => ({ id: d.id, data: { current: d.data } }) as unknown as DroppableContainer,
  );
  const droppableRects = new Map(LIST.map((d) => [d.id, d.rect]));
  return exerciseDropCollision({
    active: { id: "drag", data: { current: drag } } as unknown as Active,
    collisionRect: rect(0, 0),
    droppableContainers,
    droppableRects,
    pointerCoordinates: { x, y },
  });
}

const EXERCISE: ExerciseDragData = { type: "exercise", exerciseUid: "ex-a" };
const GROUP: ExerciseDragData = { type: "group", groupUid: "grp-d" };

describe("exerciseDropCollision", () => {
  it("lands an exercise before or after a card in a rail, inside that group", () => {
    expect(destinationOf(collide(EXERCISE, 100, 90))).toEqual({ kind: "group", groupUid: "grp-ss", index: 0 });
    expect(destinationOf(collide(EXERCISE, 100, 120))).toEqual({ kind: "group", groupUid: "grp-ss", index: 1 });
    expect(destinationOf(collide(EXERCISE, 100, 185))).toEqual({ kind: "group", groupUid: "grp-ss", index: 2 });
  });

  it("lands an exercise in a rail's gap beside the nearest card there", () => {
    expect(destinationOf(collide(EXERCISE, 100, 134))).toEqual({ kind: "group", groupUid: "grp-ss", index: 1 });
    expect(destinationOf(collide(EXERCISE, 100, 197))).toEqual({ kind: "group", groupUid: "grp-ss", index: 2 });
  });

  it("lands an exercise over a group's heading before the group, standalone", () => {
    expect(destinationOf(collide(EXERCISE, 100, 60))).toEqual({ kind: "session", index: 1 });
    // Beside the rail, level with its cards, is still the group's block, not its rail.
    expect(destinationOf(collide(EXERCISE, 5, 150))).toEqual({ kind: "session", index: 1 });
  });

  it("lands an exercise before or after a standalone card, and between items beside the nearest", () => {
    expect(destinationOf(collide(EXERCISE, 100, 10))).toEqual({ kind: "session", index: 0 });
    expect(destinationOf(collide(EXERCISE, 100, 30))).toEqual({ kind: "session", index: 1 });
    expect(destinationOf(collide(EXERCISE, 100, 245))).toEqual({ kind: "session", index: 3 });
    // Below the last card, out of the list: after it.
    expect(destinationOf(collide(EXERCISE, 100, 400))).toEqual({ kind: "session", index: 3 });
    // In the gap under the group's block: after the group.
    expect(destinationOf(collide(EXERCISE, 100, 204))).toEqual({ kind: "session", index: 2 });
  });

  it("lands a dragged group only among the session's groups, whatever it is over", () => {
    expect(destinationOf(collide(GROUP, 100, 90))).toEqual({ kind: "session", index: 1 });
    expect(destinationOf(collide(GROUP, 100, 185))).toEqual({ kind: "session", index: 2 });
    expect(destinationOf(collide(GROUP, 100, 10))).toEqual({ kind: "session", index: 0 });
  });

  it("finds nothing without a pointer or a drag", () => {
    const droppableRects = new Map(LIST.map((d) => [d.id, d.rect]));
    expect(
      exerciseDropCollision({
        active: { id: "drag", data: { current: EXERCISE } } as unknown as Active,
        collisionRect: rect(0, 0),
        droppableContainers: [],
        droppableRects,
        pointerCoordinates: null,
      }),
    ).toEqual([]);
    expect(destinationOf(null)).toBeNull();
  });
});

describe("destinationFor", () => {
  it("never lands on a rail itself", () => {
    expect(destinationFor({ type: "rail", groupUid: "grp-ss" }, "before")).toBeNull();
  });
});

describe("dropChangesSession", () => {
  const ex = (uid: string) => ({ ...defaultExerciseDraftFromCatalog({ name: uid, exerciseId: null, exerciseType: null }), uid });
  const lone = (uid: string): ExerciseGroupDraft => ({ uid: `grp-${uid}`, ...STRAIGHT_SETS, exercises: [ex(uid)] });
  const session: SessionDraft = {
    uid: "sess",
    name: "S",
    focus: null,
    estimatedDurationMinutes: null,
    calorieSurplusPercentage: null,
    notes: null,
    sessionType: "training",
    groups: [
      lone("a"),
      { uid: "grp-ss", ...STRAIGHT_SETS, format: "circuit", rounds: 3, exercises: [ex("b"), ex("c")] },
      lone("d"),
    ],
  };

  const A: ExerciseDragData = { type: "exercise", exerciseUid: "a" };
  const D: ExerciseDragData = { type: "group", groupUid: "grp-d" };

  it("draws no line where a drop changes nothing", () => {
    expect(dropChangesSession(session, A, { kind: "session", index: 0 })).toBe(false);
    expect(dropChangesSession(session, A, { kind: "session", index: 1 })).toBe(false);
    expect(dropChangesSession(session, D, { kind: "session", index: 3 })).toBe(false);
    expect(dropChangesSession(session, D, { kind: "group", groupUid: "grp-ss", index: 0 })).toBe(false);
  });

  it("draws one where a drop moves something, or will be refused with a reason", () => {
    expect(dropChangesSession(session, A, { kind: "session", index: 3 })).toBe(true);
    expect(dropChangesSession(session, A, { kind: "group", groupUid: "grp-ss", index: 1 })).toBe(true);
    expect(dropChangesSession(session, D, { kind: "session", index: 0 })).toBe(true);
    expect(dropChangesSession(session, A, { kind: "group", groupUid: "grp-d", index: 0 })).toBe(true);
  });
});

describe("sameDestination", () => {
  it("compares kind, index and group", () => {
    expect(sameDestination({ kind: "session", index: 1 }, { kind: "session", index: 1 })).toBe(true);
    expect(sameDestination({ kind: "session", index: 1 }, { kind: "session", index: 2 })).toBe(false);
    expect(
      sameDestination({ kind: "group", groupUid: "a", index: 1 }, { kind: "group", groupUid: "b", index: 1 }),
    ).toBe(false);
    expect(sameDestination(null, null)).toBe(true);
    expect(sameDestination({ kind: "session", index: 1 }, null)).toBe(false);
  });
});
