import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { DsCardSummary, DsCardSummaryRow } from "./ds-card-summary";

describe("DsCardSummary", () => {
  beforeEach(() => cleanup());

  it("renders title and body children", () => {
    render(
      <DsCardSummary title="Training">
        <div>body content</div>
      </DsCardSummary>,
    );

    expect(screen.getByText("Training")).toBeInTheDocument();
    expect(screen.getByText("body content")).toBeInTheDocument();
  });
});

describe("DsCardSummaryRow", () => {
  beforeEach(() => cleanup());

  it("renders as an anchor with the given href when href is provided", () => {
    render(
      <DsCardSummaryRow
        href="/client/training?eventId=e1&date=2026-05-08"
        leadingText="Push Day A"
        trailingText="Not logged yet"
        hint="Tap to log"
      />,
    );

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute(
      "href",
      "/client/training?eventId=e1&date=2026-05-08",
    );
    expect(screen.getByText("Push Day A")).toBeInTheDocument();
    expect(screen.getByText("Not logged yet")).toBeInTheDocument();
    expect(screen.getByText("Tap to log")).toBeInTheDocument();
    expect(screen.getByTestId("ds-row-chevron")).toBeInTheDocument();
  });

  it("renders as a plain div when href is omitted (no link, no chevron)", () => {
    render(
      <DsCardSummaryRow leadingText="Rest day" trailingText="No training scheduled" />,
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByTestId("ds-row-chevron")).toBeNull();
    expect(screen.getByText("Rest day")).toBeInTheDocument();
    expect(screen.getByText("No training scheduled")).toBeInTheDocument();
  });

  it("omits trailingText when not provided", () => {
    render(<DsCardSummaryRow leadingText="Only line" />);

    expect(screen.getByText("Only line")).toBeInTheDocument();
    expect(screen.queryByText(/not logged/i)).toBeNull();
  });

  it("uses ariaLabel on the anchor when provided", () => {
    render(
      <DsCardSummaryRow
        href="/x"
        leadingText="x"
        ariaLabel="custom label"
      />,
    );

    expect(screen.getByRole("link", { name: "custom label" })).toBeInTheDocument();
  });
});
