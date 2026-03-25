import { describe, it, expect } from "vitest";
import { hexToColor } from "../utils";

describe("hexToColor", () => {
  it("converts #000000 to [0, 0, 0]", () => {
    expect(hexToColor("#000000")).toEqual([0, 0, 0]);
  });

  it("converts #ffffff to [1, 1, 1]", () => {
    expect(hexToColor("#ffffff")).toEqual([1, 1, 1]);
  });

  it("converts #ff0000 to [1, 0, 0]", () => {
    expect(hexToColor("#ff0000")).toEqual([1, 0, 0]);
  });

  it("converts #00ff00 to [0, 1, 0]", () => {
    expect(hexToColor("#00ff00")).toEqual([0, 1, 0]);
  });

  it("converts #0000ff to [0, 0, 1]", () => {
    expect(hexToColor("#0000ff")).toEqual([0, 0, 1]);
  });

  it("converts typical highlight color #ff6b6b", () => {
    const [r, g, b] = hexToColor("#ff6b6b");
    expect(r).toBeCloseTo(1, 2);
    expect(g).toBeCloseTo(0.42, 2);
    expect(b).toBeCloseTo(0.42, 2);
  });

  it("handles uppercase #FF6B6B same as lowercase", () => {
    expect(hexToColor("#FF6B6B")).toEqual(hexToColor("#ff6b6b"));
  });
});
