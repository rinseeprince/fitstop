import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const { leave, coachHistory } = vi.hoisted(() => ({
  leave: vi.fn(),
  coachHistory: { current: false },
}));
vi.mock("@/lib/coach-history", () => ({
  hasEntryBeforePage: () => coachHistory.current,
  leaveCoachPage: leave,
}));
// jsdom cannot navigate; a plain anchor keeps the href observable.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { BackLink } from "./back-link";

/**
 * Whether the LINK's own handler prevented the click. Recorded at the document,
 * which hears the click after React's root listener has run, and prevented
 * there unconditionally so jsdom never tries to navigate.
 */
function clickAndRecord(element: HTMLElement, init?: MouseEventInit): boolean | null {
  let prevented: boolean | null = null;
  const record = (event: Event) => {
    prevented = event.defaultPrevented;
    event.preventDefault();
  };
  document.addEventListener("click", record);
  fireEvent.click(element, init);
  document.removeEventListener("click", record);
  return prevented;
}

beforeEach(() => {
  cleanup();
  leave.mockClear();
  coachHistory.current = false;
});

describe("BackLink", () => {
  it("leaves the page on a plain click when a coach page precedes it", () => {
    coachHistory.current = true;
    render(
      <BackLink href="/clients" aria-label="Back">
        arrow
      </BackLink>
    );
    expect(clickAndRecord(screen.getByLabelText("Back"))).toBe(true);
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it("lets the link navigate to its parent when the page began the count", () => {
    render(
      <BackLink href="/clients" aria-label="Back">
        arrow
      </BackLink>
    );
    const link = screen.getByLabelText("Back");
    expect(link).toHaveAttribute("href", "/clients");
    expect(clickAndRecord(link)).toBe(false);
    expect(leave).not.toHaveBeenCalled();
  });

  it("leaves a modified click to the browser — a new tab opens the parent", () => {
    coachHistory.current = true;
    render(
      <BackLink href="/clients" aria-label="Back">
        arrow
      </BackLink>
    );
    expect(clickAndRecord(screen.getByLabelText("Back"), { metaKey: true })).toBe(false);
    expect(leave).not.toHaveBeenCalled();
  });
});
