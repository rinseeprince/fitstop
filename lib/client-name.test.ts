import { describe, it, expect } from "vitest";
import { getFirstName } from "./client-name";

describe("getFirstName", () => {
  it("takes the first whitespace-delimited token", () => {
    expect(getFirstName("Sam Kalepa")).toBe("Sam");
    expect(getFirstName("Sam")).toBe("Sam");
    expect(getFirstName("Mary Jane Watson")).toBe("Mary");
  });

  it("tolerates the whitespace a pasted name actually carries", () => {
    expect(getFirstName("  Sam  Kalepa ")).toBe("Sam");
    expect(getFirstName("Sam\tKalepa")).toBe("Sam");
  });

  it("returns null rather than an empty string when there is no name", () => {
    // The reason this is null and not "": `clients.name` is genuinely blank for
    // a client invited by email whose name was never filled in, and an empty
    // string renders "Visible to " / "Hey !". Null forces each call site to
    // answer the empty case with its own wording.
    expect(getFirstName("")).toBeNull();
    expect(getFirstName("   ")).toBeNull();
    expect(getFirstName(null)).toBeNull();
    expect(getFirstName(undefined)).toBeNull();
  });
});
