import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const { back, coachHistory } = vi.hoisted(() => ({
  back: vi.fn(),
  coachHistory: { current: false },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ back }) }));
vi.mock("@/lib/coach-history", () => ({
  hasCoachHistory: () => coachHistory.current,
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
  back.mockClear();
  coachHistory.current = false;
});

describe("BackLink", () => {
  it("goes back on a plain click when a coach page precedes the entry", () => {
    coachHistory.current = true;
    render(
      <BackLink href="/clients" aria-label="Back">
        arrow
      </BackLink>
    );
    expect(clickAndRecord(screen.getByLabelText("Back"))).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("lets the link navigate to its parent when nothing in-app precedes it", () => {
    render(
      <BackLink href="/clients" aria-label="Back">
        arrow
      </BackLink>
    );
    const link = screen.getByLabelText("Back");
    expect(link).toHaveAttribute("href", "/clients");
    expect(clickAndRecord(link)).toBe(false);
    expect(back).not.toHaveBeenCalled();
  });

  it("leaves a modified click to the browser — a new tab opens the parent", () => {
    coachHistory.current = true;
    render(
      <BackLink href="/clients" aria-label="Back">
        arrow
      </BackLink>
    );
    expect(clickAndRecord(screen.getByLabelText("Back"), { metaKey: true })).toBe(false);
    expect(back).not.toHaveBeenCalled();
  });
});
