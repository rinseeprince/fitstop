import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { state } = vi.hoisted(() => ({ state: { search: "" } }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(state.search),
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/components/client-portal/training/set-tracker", () => ({
  SetTracker: () => <div data-testid="set-tracker" />,
}));

vi.mock("@/components/client-portal/training/session-picker", () => ({
  SessionPicker: () => <div data-testid="session-picker" />,
}));

import ClientTrainingDetailPage from "./page";

describe("ClientTrainingDetailPage", () => {
  beforeEach(() => {
    state.search = "";
  });

  it("renders empty-state card when neither eventId nor date is present", () => {
    state.search = "";
    render(<ClientTrainingDetailPage />);
    expect(screen.getByText(/no workout selected/i)).toBeInTheDocument();
    expect(screen.queryByTestId("set-tracker")).not.toBeInTheDocument();
    expect(screen.queryByTestId("session-picker")).not.toBeInTheDocument();
  });

  it("renders the tracker when eventId is present", () => {
    state.search = "eventId=e1&date=2026-05-08";
    render(<ClientTrainingDetailPage />);
    expect(screen.getByTestId("set-tracker")).toBeInTheDocument();
  });

  it("renders the picker when date is present but eventId is missing", () => {
    state.search = "date=2026-05-08";
    render(<ClientTrainingDetailPage />);
    expect(screen.getByTestId("session-picker")).toBeInTheDocument();
    expect(screen.queryByTestId("set-tracker")).not.toBeInTheDocument();
  });
});
