import { describe, it, expect } from "vitest";
import { maskEmail } from "./mask-email";

describe("maskEmail", () => {
  it("hides the middle of the local part and keeps the domain", () => {
    expect(maskEmail("s.kalepa91+invite-smoke@gmail.com")).toBe("s•••e@gmail.com");
    expect(maskEmail("sam.smith@gmail.com")).toBe("s•••h@gmail.com");
  });

  it("never prints any more of the local part than its first and last letters", () => {
    const masked = maskEmail("alexandra@example.com");
    expect(masked).toBe("a•••a@example.com");
    expect(masked).not.toContain("lexandr");
  });

  it("keeps a one-letter local part's letter alone, and a two-letter one's ends", () => {
    expect(maskEmail("a@example.com")).toBe("a•••@example.com");
    expect(maskEmail("ab@example.com")).toBe("a•••b@example.com");
  });

  it("shows nothing of something that is not an address", () => {
    expect(maskEmail("not-an-address")).toBe("•••");
    expect(maskEmail("@example.com")).toBe("•••");
  });
});
