import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { CreateProgramDialog } from "./create-program-dialog";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

describe("CreateProgramDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("creates a program with the entered fields and opens the builder", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ planId: "plan-99" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CreateProgramDialog open onOpenChange={() => {}} />);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Glute Program" },
    });
    fireEvent.change(screen.getByLabelText("Focus"), {
      target: { value: "Glute hypertrophy" },
    });
    fireEvent.change(screen.getByLabelText("Calorie surplus %"), {
      target: { value: "15" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "4-day glute split" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create program" }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/dashboard/programs/plan-99");
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/training/saved-plans");
    const body = JSON.parse(String(init.body)) as {
      name: string;
      splitType: string | null;
      description: string | null;
      defaultSurplusPercentage: number | null;
      sessions: Array<{ isRest: boolean }>;
    };
    expect(body.name).toBe("Glute Program");
    expect(body.splitType).toBe("Glute hypertrophy");
    expect(body.description).toBe("4-day glute split");
    expect(body.defaultSurplusPercentage).toBe(15);
    expect(body.sessions).toHaveLength(7);
    expect(body.sessions.every((s) => s.isRest)).toBe(true);
  });

  it("cannot submit with an empty name (no request, no navigation)", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<CreateProgramDialog open onOpenChange={() => {}} />);

    const submit = screen.getByRole("button", { name: "Create program" });
    expect(submit).toHaveProperty("disabled", true);
    fireEvent.click(submit);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
