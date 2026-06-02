import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CheckInWithDetails, CheckInTrainingEventDetail } from "@/types/check-in";

// Mock the OpenAI SDK: capture the create() call so we can assert the request
// shape (model, max_tokens) and the per-request timeout option. vi.hoisted keeps
// the mock fn available inside the (hoisted) vi.mock factory.
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));
vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      chat = { completions: { create: mockCreate } };
    },
  };
});

import { generateCheckInSummary } from "./ai-service";

// Minimal check-in: only the fields the prompt header / training block read.
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

describe("ai-service — generateCheckInSummary (Session 6.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "" } }],
    });
  });

  it("calls OpenAI with gpt-4o, max_tokens 2000, and a 25000ms timeout", async () => {
    await generateCheckInSummary(checkIn({ workoutsCompleted: 3 }), [], "Jane");

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const [request, options] = mockCreate.mock.calls[0];
    expect(request.model).toBe("gpt-4o");
    expect(request.max_tokens).toBe(2000);
    expect(options).toEqual({ timeout: 25000 });
  });

  it("composes with an exercise-summary Map appended to the prompt", async () => {
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
      ["log-1", ["Bench Press — 3 sets, top 100x5 @ RPE 8"]],
    ]);

    await generateCheckInSummary(
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
      summaries,
    );

    const [request] = mockCreate.mock.calls[0];
    const userMessage = request.messages.find((m: { role: string }) => m.role === "user");
    expect(userMessage.content).toContain("Bench Press — 3 sets, top 100x5 @ RPE 8");
  });

  it("composes gracefully when the exercise-summary Map is empty", async () => {
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

    await expect(
      generateCheckInSummary(
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
        new Map(),
      ),
    ).resolves.toBeDefined();

    const [request] = mockCreate.mock.calls[0];
    const userMessage = request.messages.find((m: { role: string }) => m.role === "user");
    // Per-event 6.2 detail still present; no exercise lines.
    expect(userMessage.content).toContain("Push Day: (completed)");
    expect(userMessage.content).not.toContain("top ");
  });
});
