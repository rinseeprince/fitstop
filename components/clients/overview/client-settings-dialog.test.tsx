import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ClientSettingsDialog } from "./client-settings-dialog";
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

function open(client = makeClient()) {
  return render(
    <ClientSettingsDialog
      client={client}
      open
      onOpenChange={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
}

describe("ClientSettingsDialog", () => {
  beforeEach(() => {
    preference.current = "metric";
    cleanup();
  });

  afterEach(() => vi.restoreAllMocks());

  // REGRESSION. This dialog shipped with an infinite render loop
  // ("Maximum update depth exceeded") that made height uneditable: its
  // re-seed-on-open effect depended on `height.reset`, which useHeightInput
  // rebuilt on every render. Every isolated hook test passed — renderHook never
  // puts a callback in a dependency array — so nothing caught it until the
  // dialog was actually opened in a browser. Mounting it IS the test.
  it("mounts and settles without a render loop", () => {
    expect(() => open()).not.toThrow();
    expect(screen.getByText("Client settings")).toBeInTheDocument();
  });

  it("stays mounted while the height fields are edited", async () => {
    open();
    const user = userEvent.setup();
    const cm = screen.getByLabelText("Height");

    await user.clear(cm);
    await user.type(cm, "180");

    expect(cm).toHaveValue("180");
  });

  describe("a metric coach", () => {
    it("shows one centimetre field seeded from the stored height", () => {
      open();
      expect(screen.getByLabelText("Height")).toHaveValue("178");
      expect(screen.queryByLabelText("Height, inches")).toBeNull();
    });
  });

  describe("an imperial coach", () => {
    beforeEach(() => {
      preference.current = "imperial";
    });

    // 178 cm is 5'10" — feet and inches, never "70 in".
    it("shows feet and inches, seeded from the same stored centimetres", () => {
      open();
      expect(screen.getByLabelText("Height")).toHaveValue("5");
      expect(screen.getByLabelText("Height, inches")).toHaveValue("10");
    });

    // The 452 cm landmine, inverted: the field is pre-populated, so a save that
    // touched only the phone number used to rewrite the height. 5'10" parses
    // back to 177.8, so committing the re-parsed value would drift it.
    it("does not send height when only the phone number changed", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        } as Response);

      open();
      const user = userEvent.setup();
      await user.type(screen.getByLabelText("Phone"), "123");
      await user.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
      const body = JSON.parse(
        fetchSpy.mock.calls[0][1]?.body as string,
      ) as Record<string, unknown>;

      expect(body.height).toBe(178);
      expect(body).not.toHaveProperty("heightUnit");
    });

    it("converts an edited feet/inches height back to centimetres", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        } as Response);

      open();
      const user = userEvent.setup();
      const feet = screen.getByLabelText("Height");
      await user.clear(feet);
      await user.type(feet, "6");
      await user.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
      const body = JSON.parse(
        fetchSpy.mock.calls[0][1]?.body as string,
      ) as { height: number };

      // 6'10" = 208.28 cm. The point is that it converted at all.
      expect(body.height).toBeCloseTo(208.28, 2);
    });
  });
});
