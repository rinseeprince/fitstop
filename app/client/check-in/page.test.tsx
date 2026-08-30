import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ClientCheckInPage from "./page";
import { DEFAULT_CHECK_IN_FORM_FIELDS } from "@/lib/check-in/form-fields";

const routerPushMock = vi.fn();
const routerBackMock = vi.fn();
const mutateMock = vi.fn();
const swrCall = vi.fn();
const useClientCheckInMock = vi.fn();
const useCheckInFormMock = vi.fn();
const submitCheckInMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock, back: routerBackMock }),
}));

vi.mock("swr", () => ({
  __esModule: true,
  default: (key: unknown, _fetcher: unknown, _opts: unknown) => swrCall(key),
  useSWRConfig: () => ({ mutate: mutateMock }),
}));

vi.mock("@/hooks/use-client-check-in", () => ({
  useClientCheckIn: () => useClientCheckInMock(),
}));

vi.mock("@/hooks/use-check-in-form", () => ({
  useCheckInForm: (_token: string, totalSteps: number) => {
    lastTotalSteps = totalSteps;
    return useCheckInFormMock();
  },
}));

vi.mock("@/components/check-in/step-subjective", () => ({
  StepSubjective: () => <div data-testid="step-subjective" />,
}));
vi.mock("@/components/check-in/step-metrics", () => ({
  StepMetrics: () => <div data-testid="step-metrics" />,
}));
vi.mock("@/components/check-in/step-photos", () => ({
  StepPhotos: () => <div data-testid="step-photos" />,
}));
vi.mock("@/components/check-in/step-training", () => ({
  StepTraining: () => <div data-testid="step-training" />,
}));
vi.mock("@/components/check-in/progress-indicator", () => ({
  ProgressIndicator: () => <div data-testid="progress-indicator" />,
}));
vi.mock("@/components/check-in/form-success", () => ({
  FormSuccess: () => <div data-testid="form-success" />,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/utils/daily-logs-aggregation", () => ({
  aggregateDailyLogs: () => ({ nutritionHitDays: 0, sessionsCompleted: 0 }),
}));

// Required, not optional: units-context imports auth-context, which constructs
// the browser Supabase client at module load and throws without env vars.
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({ preference: "metric", isLoading: false, error: null }),
}));


function setSWR({
  data,
  error,
  isLoading = false,
}: { data?: unknown; error?: unknown; isLoading?: boolean } = {}) {
  swrCall.mockImplementation(() => ({
    data,
    error,
    isLoading,
    mutate: vi.fn(),
  }));
}

function setClientCheckIn(
  overrides: Partial<{
    contextData: unknown;
    isLoadingContext: boolean;
    contextError: string | null;
    nextDueDate: string | null;
  }> = {},
) {
  useClientCheckInMock.mockReturnValue({
    contextData: null,
    isLoadingContext: false,
    contextError: null,
    nextDueDate: null,
    submitCheckIn: submitCheckInMock,
    ...overrides,
  });
}

let lastTotalSteps: number | undefined;

function setCheckInForm(currentStep = 1) {
  useCheckInFormMock.mockReturnValue({
    currentStep,
    formData: {},
    isSubmitting: false,
    setIsSubmitting: vi.fn(),
    updateFormData: vi.fn(),
    nextStep: vi.fn(),
    prevStep: vi.fn(),
    clearSavedData: vi.fn(),
  });
}

const baseContextData = {
  clientInfo: {
    id: "c1",
    name: "Alex",
    email: "a@x.com",
    coachName: "Coach",
    checkInFrequencyDays: 7,
  },
  trainingContext: undefined,
  nutritionContext: undefined,
  trainingPeriodStats: { sessionsCompleted: 0, sessionsPlanned: 0 },
  dailyLogs: [],
  periodStart: "2026-05-08",
  periodEnd: "2026-05-14",
  periodDays: 7,
  // C6a's additive key. Absent (an older client app, or a client whose coach
  // has never customised anything) resolves to all 14 fields — asserted below.
  form: { fields: [...DEFAULT_CHECK_IN_FORM_FIELDS], questions: [] },
};

/** The same context with only the named field keys asked. */
function contextWithFields(fields: string[], questions: { id: string; prompt: string }[] = []) {
  return { ...baseContextData, form: { fields, questions } };
}

describe("ClientCheckInPage", () => {
  beforeEach(() => {
    routerPushMock.mockReset();
    routerBackMock.mockReset();
    mutateMock.mockReset();
    swrCall.mockReset();
    useClientCheckInMock.mockReset();
    useCheckInFormMock.mockReset();
    submitCheckInMock.mockReset();
    lastTotalSteps = undefined;
    setSWR({ data: { success: true, data: [] } });
    setClientCheckIn();
    setCheckInForm();
    cleanup();
  });

  it("renders the submission form (step 1) and past list heading when window is open", () => {
    setClientCheckIn({ contextData: baseContextData });
    setSWR({
      data: {
        success: true,
        data: [
          {
            id: "ci-1",
            clientId: "c1",
            status: "ai_processed",
            createdAt: "2026-05-01T12:00:00Z",
            weight: 175,
          },
        ],
      },
    });
    render(<ClientCheckInPage />);
    expect(screen.getByTestId("step-subjective")).toBeInTheDocument();
    expect(screen.getByText("Past check-ins")).toBeInTheDocument();
  });

  it("renders 'Next check-in opens on …' notice and no form when window is not_due", () => {
    setClientCheckIn({ contextError: "not_due", nextDueDate: "2026-05-22" });
    render(<ClientCheckInPage />);
    expect(screen.getByText("Not due yet")).toBeInTheDocument();
    expect(
      screen.getByText(/Next check-in opens on Friday, May 22/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("step-subjective")).not.toBeInTheDocument();
    expect(screen.getByText("Past check-ins")).toBeInTheDocument();
  });


  it("renders empty-state placeholder when past check-ins list is empty", () => {
    setClientCheckIn({ contextData: baseContextData });
    render(<ClientCheckInPage />);
    expect(screen.getByText("No check-ins yet")).toBeInTheDocument();
  });

  it("navigates to /client/check-in/<id> when a past row is clicked", async () => {
    const user = userEvent.setup();
    setClientCheckIn({ contextData: baseContextData });
    setSWR({
      data: {
        success: true,
        data: [
          {
            id: "ci-1",
            clientId: "c1",
            status: "ai_processed",
            createdAt: "2026-05-01T12:00:00Z",
            weight: 175,
          },
        ],
      },
    });
    render(<ClientCheckInPage />);
    // Click the date inside the card — the Card's onClick handles bubbled events.
    await user.click(screen.getByText("May 1, 2026"));
    expect(routerPushMock).toHaveBeenCalledWith("/client/check-in/ci-1");
  });

  it("calls mutate(PAST_CHECK_INS_SWR_KEY) after a successful submission", async () => {
    submitCheckInMock.mockResolvedValueOnce({ success: true });
    const user = userEvent.setup();
    setClientCheckIn({ contextData: baseContextData });
    setCheckInForm(4);
    render(<ClientCheckInPage />);
    await user.click(screen.getByRole("button", { name: /submit check-in/i }));
    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledWith("/api/client/check-ins?limit=10");
    });
  });

  it("gives a full form four steps and puts Submit on the last one", () => {
    setClientCheckIn({ contextData: baseContextData });
    setCheckInForm(4);
    render(<ClientCheckInPage />);

    expect(lastTotalSteps).toBe(4);
    expect(screen.getByTestId("step-training")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit check-in/i })).toBeInTheDocument();
  });

  it("drops the Photos step when the coach asks for no photos, and Training moves up", () => {
    // The whole point of rendering by step KIND: at position 3 an index-keyed
    // switch would render Photos, which this client is not asked for.
    setClientCheckIn({
      contextData: contextWithFields(["notes", "weight", "prs"]),
    });
    setCheckInForm(3);
    render(<ClientCheckInPage />);

    expect(lastTotalSteps).toBe(3);
    expect(screen.getByTestId("step-training")).toBeInTheDocument();
    expect(screen.queryByTestId("step-photos")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit check-in/i })).toBeInTheDocument();
  });

  it("leaves a two-step check-in when every field is off", () => {
    setClientCheckIn({ contextData: contextWithFields([]) });
    setCheckInForm(1);
    render(<ClientCheckInPage />);

    expect(lastTotalSteps).toBe(2);
    expect(screen.getByTestId("step-subjective")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next/i })).toBeInTheDocument();
  });

  it("falls back to the full form when the payload carries no `form` key", () => {
    const { form: _form, ...noForm } = baseContextData;
    setClientCheckIn({ contextData: noForm });
    setCheckInForm(1);
    render(<ClientCheckInPage />);

    expect(lastTotalSteps).toBe(4);
  });

  it("strips a disabled field out of the submission before it is sent", async () => {
    // A saved draft can predate the coach turning a field off. The server
    // strips too — this one keeps a base64 photo off the wire entirely.
    submitCheckInMock.mockResolvedValueOnce({ success: true });
    const user = userEvent.setup();
    setClientCheckIn({ contextData: contextWithFields(["notes"]) });
    useCheckInFormMock.mockReturnValue({
      currentStep: 2,
      formData: { notes: "Kept", prs: "Dropped", photoFront: "data:image/png;base64,x" },
      isSubmitting: false,
      setIsSubmitting: vi.fn(),
      updateFormData: vi.fn(),
      nextStep: vi.fn(),
      prevStep: vi.fn(),
      clearSavedData: vi.fn(),
    });
    render(<ClientCheckInPage />);

    await user.click(screen.getByRole("button", { name: /submit check-in/i }));

    await waitFor(() => expect(submitCheckInMock).toHaveBeenCalled());
    const sent = submitCheckInMock.mock.calls[0][0];
    expect(sent.notes).toBe("Kept");
    expect(sent.prs).toBeUndefined();
    expect(sent.photoFront).toBeUndefined();
  });

  it("drops an answer to a question this form no longer asks", async () => {
    submitCheckInMock.mockResolvedValueOnce({ success: true });
    const user = userEvent.setup();
    setClientCheckIn({
      contextData: contextWithFields(["notes"], [{ id: "q-1", prompt: "Still asked?" }]),
    });
    useCheckInFormMock.mockReturnValue({
      currentStep: 2,
      formData: {
        customAnswers: [
          { questionId: "q-1", answer: "yes" },
          { questionId: "q-gone", answer: "orphan" },
        ],
      },
      isSubmitting: false,
      setIsSubmitting: vi.fn(),
      updateFormData: vi.fn(),
      nextStep: vi.fn(),
      prevStep: vi.fn(),
      clearSavedData: vi.fn(),
    });
    render(<ClientCheckInPage />);

    await user.click(screen.getByRole("button", { name: /submit check-in/i }));

    await waitFor(() => expect(submitCheckInMock).toHaveBeenCalled());
    expect(submitCheckInMock.mock.calls[0][0].customAnswers).toEqual([
      { questionId: "q-1", answer: "yes" },
    ]);
  });
});
