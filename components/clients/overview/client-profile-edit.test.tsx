import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ClientScheduleCard } from "./client-schedule-card";
import { EditRailActions } from "./inline-edit-fields";
import { useClientProfileEdit } from "./use-client-profile-edit";
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
function Harness({ client }: { client: Client }) {
  const edit = useClientProfileEdit(client, vi.fn());
  return (
    <>
      <EditRailActions edit={edit} />
      <ClientScheduleCard
        client={client}
        checkInTiming={null}
        isTimingLoading={false}
        edit={edit}
      />
    </>
  );
}

async function openEditor(client = makeClient()) {
  render(<Harness client={client} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /edit client details/i }));
  return user;
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
    render(<Harness client={makeClient()} />);
    expect(screen.queryByLabelText("Phone")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /edit client details/i }));

    expect(screen.getByLabelText("Phone")).toBeInTheDocument();
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
});
