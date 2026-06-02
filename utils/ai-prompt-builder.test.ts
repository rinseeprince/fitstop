import { describe, it, expect } from "vitest";
import { buildCheckInAnalysisPrompt } from "./ai-prompt-builder";
import type { CheckInWithDetails, CheckInTrainingEventDetail } from "@/types/check-in";

// Minimal current check-in: only the fields the Training block / header read.
function checkIn(overrides: Partial<CheckInWithDetails> = {}): CheckInWithDetails {
  return {
    id: "ci-1",
    clientId: "client-1",
    status: "pending",
    createdAt: "2026-04-13T10:00:00Z",
    updatedAt: "2026-04-13T10:00:00Z",
    ...overrides,
  } as CheckInWithDetails;
}

// Slice out just the "Training:" section so assertions don't fray on the rest.
function trainingSection(prompt: string): string {
  const start = prompt.indexOf("\nTraining:\n");
  if (start === -1) return "";
  // The next section begins with a "\n**" header or "\nExercise Highlights".
  const rest = prompt.slice(start + 1);
  const end = rest.search(/\n(\*\*|Exercise Highlights:|Nutrition:)/);
  return end === -1 ? rest : rest.slice(0, end);
}

describe("buildCheckInAnalysisPrompt — training block (Session 6.2)", () => {
  it("renders N/M completed and distinguishes completed / skipped(reason) / not logged", () => {
    const details: CheckInTrainingEventDetail[] = [
      {
        eventId: "ev-1",
        date: "2026-04-07",
        sessionName: "Push Day",
        status: "completed",
        logStatus: "logged",
        notes: "felt strong",
        completionQuality: "full",
        trainingSessionId: "sess-1",
        sessionLogId: "log-1",
      },
      {
        eventId: "ev-2",
        date: "2026-04-09",
        sessionName: "Leg Day",
        status: "skipped",
        logStatus: "logged",
        notes: "sick",
        completionQuality: "skipped",
        trainingSessionId: "sess-2",
        sessionLogId: "log-2",
      },
      {
        eventId: "ev-3",
        date: "2026-04-11",
        sessionName: "Pull Day",
        status: "scheduled",
        logStatus: "not_logged",
        trainingSessionId: "sess-3",
        sessionLogId: null,
      },
    ];

    const prompt = buildCheckInAnalysisPrompt(
      checkIn({ workoutsCompleted: 99 }),
      [],
      "Jane",
      undefined,
      undefined,
      undefined,
      undefined,
      null,
      null,
      details,
    );
    const training = trainingSection(prompt);

    // 1 of 3 events is status === 'completed'.
    expect(training).toContain("- Sessions: 1/3 completed");
    // Completed renders "(completed)" and its note on the next line.
    expect(training).toContain("Push Day: (completed)");
    expect(training).toContain("Note: felt strong");
    // Skip renders the reason inline, NOT "(skipped)".
    expect(training).toContain("Leg Day: Skipped (reason: sick)");
    expect(training).not.toContain("Leg Day: (skipped)");
    // Unlogged event is flagged "not logged".
    expect(training).toContain("Pull Day: (scheduled, not logged)");
    // The legacy workout-count fallback is suppressed when details are present.
    expect(training).not.toContain("Workouts Completed: 99");
  });

  it("renders a bare 'Skipped' when a skipped event has no notes", () => {
    const details: CheckInTrainingEventDetail[] = [
      {
        eventId: "ev-1",
        date: "2026-04-07",
        sessionName: "Leg Day",
        status: "skipped",
        logStatus: "logged",
        completionQuality: "skipped",
        trainingSessionId: "sess-1",
        sessionLogId: "log-1",
      },
    ];

    const prompt = buildCheckInAnalysisPrompt(
      checkIn(),
      [],
      "Jane",
      undefined,
      undefined,
      undefined,
      undefined,
      null,
      null,
      details,
    );
    const training = trainingSection(prompt);

    expect(training).toContain("- Sessions: 0/1 completed");
    expect(training).toContain("Leg Day: Skipped");
    expect(training).not.toContain("reason:");
  });

  it("falls back to workoutsCompleted when trainingEventDetails is empty", () => {
    const prompt = buildCheckInAnalysisPrompt(
      checkIn({ workoutsCompleted: 4 }),
      [],
      "Jane",
      undefined,
      undefined,
      undefined,
      undefined,
      null,
      null,
      [],
    );
    const training = trainingSection(prompt);

    expect(training).toContain("- Workouts Completed: 4");
    expect(training).not.toContain("Sessions:");
  });

  it("falls back to workoutsCompleted when trainingEventDetails is absent", () => {
    const prompt = buildCheckInAnalysisPrompt(checkIn({ workoutsCompleted: 2 }), [], "Jane");
    const training = trainingSection(prompt);

    expect(training).toContain("- Workouts Completed: 2");
    expect(training).not.toContain("Sessions:");
  });
});

describe("buildCheckInAnalysisPrompt — exercise enrichment (Session 6.3)", () => {
  function build(
    details: CheckInTrainingEventDetail[],
    exerciseSummaries?: Map<string, string[]>,
  ): string {
    return trainingSection(
      buildCheckInAnalysisPrompt(
        checkIn(),
        [],
        "Jane",
        undefined,
        undefined,
        undefined,
        undefined,
        null,
        null,
        details,
        exerciseSummaries,
      ),
    );
  }

  it("emits the per-exercise lines for a completed session from the fixture Map", () => {
    const details: CheckInTrainingEventDetail[] = [
      {
        eventId: "ev-1",
        date: "2026-04-07",
        sessionName: "Push Day",
        status: "completed",
        logStatus: "logged",
        completionQuality: "full",
        trainingSessionId: "sess-1",
        sessionLogId: "log-1",
      },
    ];
    const summaries = new Map<string, string[]>([
      [
        "log-1",
        ["Bench Press — 4 sets, top 100x5 @ RPE 8", "Overhead Press — 3 sets, top 60x6"],
      ],
    ]);

    const training = build(details, summaries);

    expect(training).toContain("Push Day: (completed)");
    expect(training).toContain("Bench Press — 4 sets, top 100x5 @ RPE 8");
    expect(training).toContain("Overhead Press — 3 sets, top 60x6");
  });

  it("renders the swap header when performed differs from prescribed", () => {
    const details: CheckInTrainingEventDetail[] = [
      {
        eventId: "ev-1",
        date: "2026-04-07",
        sessionName: "Push Day",
        status: "completed",
        logStatus: "logged",
        completionQuality: "full",
        trainingSessionId: "sess-1",
        sessionLogId: "log-1",
        performedSessionName: "Pull Day",
      },
    ];
    const summaries = new Map<string, string[]>([
      ["log-1", ["Pull-up — 4 sets, top 0x10", "Row — 3 sets, top 80x8"]],
    ]);

    const training = build(details, summaries);

    // "Prescribed X · Performed Y — k exercises logged" with k = line count.
    expect(training).toContain("Prescribed Push Day · Performed Pull Day — 2 exercises logged");
  });

  it("does NOT render a swap header when performed equals prescribed", () => {
    const details: CheckInTrainingEventDetail[] = [
      {
        eventId: "ev-1",
        date: "2026-04-07",
        sessionName: "Push Day",
        status: "completed",
        logStatus: "logged",
        completionQuality: "full",
        trainingSessionId: "sess-1",
        sessionLogId: "log-1",
        performedSessionName: "Push Day",
      },
    ];

    const training = build(details, new Map([["log-1", ["Bench — 3 sets, top 100x5"]]]));

    expect(training).not.toContain("Prescribed");
    expect(training).not.toContain("Performed");
    expect(training).toContain("Bench — 3 sets, top 100x5");
  });

  it("renders the skip reason and NO exercise block for a skipped event", () => {
    const details: CheckInTrainingEventDetail[] = [
      {
        eventId: "ev-1",
        date: "2026-04-07",
        sessionName: "Leg Day",
        status: "skipped",
        logStatus: "logged",
        notes: "sick",
        completionQuality: "skipped",
        trainingSessionId: "sess-1",
        sessionLogId: "log-1",
      },
    ];
    // A Map entry exists for the skipped session, but it must be ignored.
    const summaries = new Map<string, string[]>([
      ["log-1", ["Squat — 5 sets, top 140x5"]],
    ]);

    const training = build(details, summaries);

    expect(training).toContain("Leg Day: Skipped (reason: sick)");
    expect(training).not.toContain("Squat — 5 sets, top 140x5");
  });

  it("composes gracefully with an empty Map (no exercise lines, 6.2 detail intact)", () => {
    const details: CheckInTrainingEventDetail[] = [
      {
        eventId: "ev-1",
        date: "2026-04-07",
        sessionName: "Push Day",
        status: "completed",
        logStatus: "logged",
        completionQuality: "full",
        trainingSessionId: "sess-1",
        sessionLogId: "log-1",
      },
    ];

    const training = build(details, new Map());

    expect(training).toContain("- Sessions: 1/1 completed");
    expect(training).toContain("Push Day: (completed)");
    // No exercise lines and no swap header.
    expect(training).not.toContain("top ");
    expect(training).not.toContain("Prescribed");
  });
});
