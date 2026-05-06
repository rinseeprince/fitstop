import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("@/components/client-portal/training/set-tracker", () => ({
  SetTracker: () => <div data-testid="set-tracker" />,
}));

import ClientTrainingDetailPage from "./page";

describe("ClientTrainingDetailPage", () => {
  it("renders empty-state card when eventId is missing", () => {
    render(<ClientTrainingDetailPage />);
    expect(screen.getByText(/no workout selected/i)).toBeInTheDocument();
    expect(screen.queryByTestId("set-tracker")).not.toBeInTheDocument();
  });
});
