import { MAIN_SECTIONS, moveTo, orderSections } from "@/lib/nav";

describe("sidebar order", () => {
  it("applies the saved order and keeps unknown sections in their default place", () => {
    expect(orderSections(MAIN_SECTIONS, [])).toEqual(MAIN_SECTIONS);
    expect(orderSections(["dashboard", "transactions", "accounts"], ["accounts", "dashboard"])).toEqual([
      "accounts",
      "dashboard",
      "transactions",
    ]);
  });

  it("moves an item down and up", () => {
    expect(moveTo(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
    expect(moveTo(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(moveTo(["a", "b", "c"], "b", "b")).toEqual(["a", "b", "c"]);
    expect(moveTo(["a", "b"], "x", "a")).toEqual(["a", "b"]);
  });
});
