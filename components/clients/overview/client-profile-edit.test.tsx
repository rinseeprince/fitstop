import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ClientScheduleCard } from "./client-schedule-card";
import { ClientStatusCard } from "./client-status-card";
import { EditRailActions } from "./inline-edit-fields";
import { useClientProfileEdit } from "./use-client-profile-edit";
import { resolveEffectiveGoal, toClientGoalInput } from "@/lib/goals/resolve-effective-goal";
import type { ClientGoal } from "@/types/client-goals";
import type { Client } from "@/types/check-in";
import type { UnitSystem } from "@/utils/unit-conversions";

const preference = { current: "metric" as UnitSystem };
vi.mock("@/contexts/units-context", () => ({
  useUnits: () => ({
    preference: preference.current,
    isLoading: false,
    error: undefined,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

function makeClient(overrides: Partial<Client> = {}): Client {
  return {
    id: "client-1",
    coachId: "coach-1",
    name: "Alex Doe",
    email: "alex@example.com",
    active: true,
    includeActivityBurn: true,
    surplusAsCarbs: false,
    timezone: "UTC",
    unitPreference: "metric",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    height: 178,
    phone: "555",
    ...overrides,
  } as Client;
}

/**
 * The real hook driving the real card — editing is inline now, so the harness
 * is the surface a coach actually uses rather than a dialog in isolation.
 */
function Harness({ client, goal }: { client: Client; goal: ClientGoal | null }) {
  const edit = useClientProfileEdit(client, vi.fn(), goal);
  return (
    <>
      <EditRailActions edit={edit} />
      <ClientScheduleCard
        client={client}
        checkInTiming={null}
        isTimingLoading={false}
        edit={edit}
      />
      <ClientStatusCard
        client={client}
        goal={resolveEffectiveGoal({
          clientGoal: toClientGoalInput(goal, client),
          today: "2026-08-13",
        })}
        goalStartDate={goal?.goalStartDate ?? null}
        training={null}
        upcomingTraining={null}
        onOpenMetrics={vi.fn()}
        edit={edit}
      />
    </>
  );
}

function makeGoal(overrides: Partial<ClientGoal> = {}): ClientGoal {
  return {
    id: "goal-1",
    clientId: "client-1",
    goalWeight: 82,
    goalDeadline: "2026-12-01",
    setBy: "coach-1",
    effectiveFrom: "2026-01-01T00:00:00Z",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

async function openEditor(client = makeClient(), goal: ClientGoal | null = makeGoal()) {
  render(<Harness client={client} goal={goal} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /edit client details/i }));
  return user;
}

/** The PATCH to /api/clients/[id] — the client-details write. */
function profilePatch(spy: ReturnType<typeof mockFetchOk>) {
  const call = spy.mock.calls.find(
    ([url, init]) => init?.method === "PATCH" && /\/api\/clients\/[^/]+$/.test(String(url))
  );
  return call ? (JSON.parse(call[1]?.body as string) as Record<string, unknown>) : null;
}

/** The PUT to /goals, if the save issued one. */
function goalPut(spy: ReturnType<typeof mockFetchOk>) {
  const call = spy.mock.calls.find(([url]) => String(url).endsWith("/goals"));
  return call ? (JSON.parse(call[1]?.body as string) as Record<string, unknown>) : null;
}

function mockFetchOk() {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ success: true }),
  } as Response);
}

describe("inline client profile editing", () => {
  beforeEach(() => {
    preference.current = "metric";
    cleanup();
  });

  afterEach(() => vi.restoreAllMocks());

  // REGRESSION, carried over from the dialog this replaced: that dialog shipped
  // with an infinite render loop ("Maximum update depth exceeded") which made
  // height uneditable, because its re-seed effect depended on `height.reset`,
  // which useHeightInput rebuilt every render. Every isolated hook test passed —
  // renderHook never puts a callback in a dependency array. Mounting IS the test.
  it("mounts and settles without a render loop", async () => {
    await openEditor();
    expect(screen.getByLabelText("Phone")).toBeInTheDocument();
  });

  it("shows the value when idle and an input once editing starts", async () => {
    render(<Harness client={makeClient()} goal={makeGoal()} />);
    expect(screen.queryByLabelText("Phone")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /edit client details/i }));

    expect(screen.getByLabelText("Phone")).toBeInTheDocument();
  });

  // ACTIVATION sets the start date; only then is there anything to correct.
  // An editable field before that was worse than useless — the activation
  // dialog prefills its own box with today and always sends it, so a date set
  // in advance was silently replaced the moment the coach activated.
  describe("the start date", () => {
    it("is not editable while the client is still being set up", async () => {
      await openEditor(
        makeClient({ onboardingStatus: "setup_in_progress", startDate: undefined })
      );
      expect(screen.queryByLabelText("Start date")).not.toBeInTheDocument();
      expect(screen.getByText("Set on activation")).toBeInTheDocument();
    });

    it("becomes editable once they are active", async () => {
      await openEditor(
        makeClient({ onboardingStatus: "active", startDate: "2026-08-21" })
      );
      expect(screen.getByLabelText("Start date")).toBeInTheDocument();
    });

    it("stays editable while they are paused — they were activated once", async () => {
      await openEditor(
        makeClient({ onboardingStatus: "paused", startDate: "2026-08-21" })
      );
      expect(screen.getByLabelText("Start date")).toBeInTheDocument();
    });
  });

  it("cancel leaves editing without saving", async () => {
    const fetchSpy = mockFetchOk();
    const user = await openEditor();

    await user.type(screen.getByLabelText("Phone"), "123");
    await user.click(screen.getByRole("button", { name: /discard changes/i }));

    expect(screen.queryByLabelText("Phone")).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  describe("a metric coach", () => {
    it("shows one centimetre field seeded from the stored height", async () => {
      await openEditor();
      expect(screen.getByLabelText("Height")).toHaveValue("178");
    });
  });

  describe("an imperial coach", () => {
    beforeEach(() => {
      preference.current = "imperial";
    });

    it("shows feet and inches, seeded from the same stored centimetres", async () => {
      await openEditor();
      expect(screen.getByLabelText("Height feet")).toHaveValue("5");
      expect(screen.getByLabelText("Height inches")).toHaveValue("10");
    });

    // The 452 cm landmine, inverted: the field is pre-populated, so a save that
    // touched only the phone number used to rewrite the height. 5'10" parses
    // back to 177.8, so committing the re-parsed value would drift it.
    it("does not send a drifted height when only the phone number changed", async () => {
      const fetchSpy = mockFetchOk();
      const user = await openEditor();

      await user.type(screen.getByLabelText("Phone"), "123");
      await user.click(screen.getByRole("button", { name: /save client details/i }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
      const body = JSON.parse(
        fetchSpy.mock.calls[0][1]?.body as string
      ) as Record<string, unknown>;

      expect(body.height).toBe(178);
      expect(body).not.toHaveProperty("heightUnit");
    });

    it("converts an edited feet/inches height back to centimetres", async () => {
      const fetchSpy = mockFetchOk();
      const user = await openEditor();

      const feet = screen.getByLabelText("Height feet");
      await user.clear(feet);
      await user.type(feet, "6");
      await user.click(screen.getByRole("button", { name: /save client details/i }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
      const body = JSON.parse(
        fetchSpy.mock.calls[0][1]?.body as string
      ) as { height: number };

      // 6'10" = 208.28 cm. The point is that it converted at all.
      expect(body.height).toBeCloseTo(208.28, 2);
    });
  });

  // The four measurement cells. START is the recorded baseline — a correction
  // to a fact nothing can re-take — so it is confirmed before it is written.
  // CURRENT is an ordinary measurement and is not.
  describe("start and current measurements", () => {
    const MEASURED = makeClient({
      startingWeight: 90,
      currentWeight: 86,
      startingBodyFatPercentage: 24,
      currentBodyFatPercentage: 21,
    });

    it("does not rewrite an untouched measurement", async () => {
      // Display rounding is lossy, so re-sending a pre-populated box would
      // drift the stored value on EVERY save — the §20 rule that made the
      // seeded-string guard load-bearing for height and goal weight.
      const fetchSpy = mockFetchOk();
      const user = await openEditor(MEASURED);

      await user.type(screen.getByLabelText("Phone"), "123");
      await user.click(screen.getByRole("button", { name: /save client details/i }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
      const body = profilePatch(fetchSpy);
      expect(body).not.toHaveProperty("startingWeight");
      expect(body).not.toHaveProperty("currentWeight");
      expect(body).not.toHaveProperty("startingBodyFatPercentage");
      expect(body).not.toHaveProperty("currentBodyFatPercentage");
    });

    it("FILLS a blank start weight with no confirm — nothing is overwritten", async () => {
      // The "forgot to add one" case. The dialog guards a REPLACEMENT; there is
      // no recorded start to change, so interrupting would warn about an
      // outcome that cannot happen.
      const fetchSpy = mockFetchOk();
      const user = await openEditor(makeClient({ currentWeight: 86 }));

      const field = screen.getByLabelText("Start weight");
      await user.type(field, "90");
      await user.click(screen.getByRole("button", { name: /save client details/i }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
      expect(profilePatch(fetchSpy)?.startingWeight).toBe(90);
      expect(
        screen.queryByRole("button", { name: /update start/i })
      ).not.toBeInTheDocument();
    });

    it("saves a CURRENT weight with no confirm", async () => {
      const fetchSpy = mockFetchOk();
      const user = await openEditor(MEASURED);

      const field = screen.getByLabelText("Current weight");
      await user.clear(field);
      await user.type(field, "85");
      await user.click(screen.getByRole("button", { name: /save client details/i }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
      expect(profilePatch(fetchSpy)?.currentWeight).toBe(85);
      expect(
        screen.queryByRole("button", { name: /update start/i })
      ).not.toBeInTheDocument();
    });

    it("CONFIRMS a start weight before writing it, and writes nothing if cancelled", async () => {
      const fetchSpy = mockFetchOk();
      const user = await openEditor(MEASURED);

      const field = screen.getByLabelText("Start weight");
      await user.clear(field);
      await user.type(field, "92");
      await user.click(screen.getByRole("button", { name: /save client details/i }));

      // The dialog names the new value, so the coach confirms the number they
      // are about to bake into every progress figure.
      await screen.findByText(/start weight to 92.0 kg/i);
      expect(fetchSpy).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: /^cancel$/i }));
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("writes the start weight once confirmed", async () => {
      const fetchSpy = mockFetchOk();
      const user = await openEditor(MEASURED);

      const field = screen.getByLabelText("Start weight");
      await user.clear(field);
      await user.type(field, "92");
      await user.click(screen.getByRole("button", { name: /save client details/i }));
      await user.click(await screen.findByRole("button", { name: /update start/i }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
      const body = profilePatch(fetchSpy);
      expect(body?.startingWeight).toBe(92);
      // Correcting the baseline does not move the current measurement.
      expect(body).not.toHaveProperty("currentWeight");
    });

    it("converts an edited start weight back to kilograms", async () => {
      preference.current = "imperial";
      const fetchSpy = mockFetchOk();
      const user = await openEditor(MEASURED);

      const field = screen.getByLabelText("Start weight");
      await user.clear(field);
      await user.type(field, "200");
      await user.click(screen.getByRole("button", { name: /save client details/i }));
      await user.click(await screen.findByRole("button", { name: /update start/i }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
      expect(profilePatch(fetchSpy)?.startingWeight).toBeCloseTo(90.72, 2);
    });

    it("refuses to empty a stored measurement rather than silently keeping it", async () => {
      // None of the four columns is nullable through updateClientSchema, so
      // there is no payload that clears one. A cleared box that quietly kept
      // its old value is worse than an error.
      const fetchSpy = mockFetchOk();
      const user = await openEditor(MEASURED);

      await user.clear(screen.getByLabelText("Current weight"));
      await user.click(screen.getByRole("button", { name: /save client details/i }));

      await waitFor(() =>
        expect(screen.queryByLabelText("Current weight")).toBeInTheDocument()
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("confirms a start BODY FAT the same way", async () => {
      const fetchSpy = mockFetchOk();
      const user = await openEditor(MEASURED);

      const field = screen.getByLabelText("Start body fat percentage");
      await user.clear(field);
      await user.type(field, "26");
      await user.click(screen.getByRole("button", { name: /save client details/i }));

      await screen.findByText(/start body fat to 26%/i);
      await user.click(screen.getByRole("button", { name: /update start/i }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
      expect(profilePatch(fetchSpy)?.startingBodyFatPercentage).toBe(26);
    });
  });

  // Task 0b.4 — the goal is edited here now, not in the nutrition drawer.
  describe("the goal", () => {
    // THE load-bearing one. `updateGoals` supersedes-and-inserts on EVERY call
    // with no change detection of its own, so calling it unconditionally would
    // mint a new client_goals version and an audit event every time a coach
    // edited a phone number (invariant 7).
    it("is not written at all when nothing about it changed", async () => {
      const fetchSpy = mockFetchOk();
      const user = await openEditor();

      await user.type(screen.getByLabelText("Phone"), "123");
      await user.click(screen.getByRole("button", { name: /save client details/i }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
      expect(goalPut(fetchSpy)).toBeNull();
    });

    it("sends only the field that changed", async () => {
      const fetchSpy = mockFetchOk();
      const user = await openEditor();

      const deadline = screen.getByLabelText("Goal deadline");
      await user.clear(deadline);
      await user.type(deadline, "2027-03-01");
      await user.click(screen.getByRole("button", { name: /save client details/i }));

      await waitFor(() => expect(goalPut(fetchSpy)).not.toBeNull());
      expect(goalPut(fetchSpy)).toEqual({ goalDeadline: "2027-03-01" });
    });

    it("clears an emptied deadline with an explicit null", async () => {
      const fetchSpy = mockFetchOk();
      const user = await openEditor();

      await user.clear(screen.getByLabelText("Goal deadline"));
      await user.click(screen.getByRole("button", { name: /save client details/i }));

      await waitFor(() => expect(goalPut(fetchSpy)).not.toBeNull());
      expect(goalPut(fetchSpy)).toEqual({ goalDeadline: null });
    });

    // Native bounds, so the impossible days are unclickable rather than offered
    // and then rejected. The route refuses a past deadline and the schema
    // refuses one before the start; both are expressed as one `min`.
    it("greys out days before today on the deadline", async () => {
      await openEditor(makeClient(), makeGoal({ goalStartDate: undefined }));

      const today = new Date();
      const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
        today.getDate()
      ).padStart(2, "0")}`;
      expect(screen.getByLabelText("Goal deadline")).toHaveAttribute("min", iso);
    });

    it("greys out days before the goal start when that is later than today", async () => {
      await openEditor(makeClient(), makeGoal({ goalStartDate: "2099-01-01" }));

      expect(screen.getByLabelText("Goal deadline")).toHaveAttribute("min", "2099-01-01");
    });

    // A goal that began three weeks ago is a real thing to record, and the route
    // puts no bound on it — greying out a legitimate day is the same defect in
    // the other direction.
    it("leaves the goal start unbounded", async () => {
      await openEditor();

      expect(screen.getByLabelText("Goal start date")).not.toHaveAttribute("min");
    });

    it("refuses a start date after the deadline, before sending anything", async () => {
      const fetchSpy = mockFetchOk();
      const user = await openEditor();

      const start = screen.getByLabelText("Goal start date");
      await user.clear(start);
      await user.type(start, "2027-01-01"); // deadline is 2026-12-01
      await user.click(screen.getByRole("button", { name: /save client details/i }));

      // zodResolver blocks the submit, so NOTHING is written — not even the
      // profile PATCH that would otherwise have gone first.
      await waitFor(() => expect(screen.getByLabelText("Goal start date")).toBeInTheDocument());
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    describe("an imperial coach", () => {
      beforeEach(() => {
        preference.current = "imperial";
      });

      // The §20 no-op. 82 kg seeds as "180.8" and re-parses to 82.00568, so a
      // form that re-parsed whatever sat in the box would drift the stored goal
      // on every unrelated save. `commit` compares the SEEDED STRING instead.
      it("does not rewrite an untouched goal weight", async () => {
        const fetchSpy = mockFetchOk();
        const user = await openEditor();

        await user.type(screen.getByLabelText("Phone"), "123");
        await user.click(screen.getByRole("button", { name: /save client details/i }));

        await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
        expect(goalPut(fetchSpy)).toBeNull();
      });

      it("converts an edited goal weight back to kilograms", async () => {
        const fetchSpy = mockFetchOk();
        const user = await openEditor();

        const weight = screen.getByLabelText("Goal weight");
        await user.clear(weight);
        await user.type(weight, "176.4");
        await user.click(screen.getByRole("button", { name: /save client details/i }));

        await waitFor(() => expect(goalPut(fetchSpy)).not.toBeNull());
        // 176.4 lb = 80.0 kg. The point is that it converted at all.
        expect(goalPut(fetchSpy)?.goalWeight as number).toBeCloseTo(80, 1);
      });
    });
  });
});
